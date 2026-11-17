import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkout } from "@/routes/checkout.js";
import { withMocks } from "../utils/with-mocks.js";
import { resetFezCache } from "@/utils/fez.js";

const mockTx = {
  productVariant: {
    updateMany: vi.fn(),
  },
  order: {
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  payment: {
    create: vi.fn(),
  },
  cartItem: {
    deleteMany: vi.fn(),
  },
};

const mockPrisma = {
  user: { findUnique: vi.fn() },
  cart: { findUnique: vi.fn() },
  address: { create: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(mockTx)),
};

const mockSupabase = { auth: { getUser: vi.fn() } };

const authedUser = { id: "u1", supabaseId: "user-id", role: "CUSTOMER" };
const ENV = { FLAT_SHIPPING_FEE: "1500", CARD_FEE_PERCENT: "2" };

function mockAsAuthedUser() {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: "user-id", email: "customer@example.com" } },
    error: null,
  } as any);
  mockPrisma.user.findUnique.mockResolvedValueOnce(authedUser as any);
}

function cartWith(items: any[]) {
  return { id: "cart-1", userId: "u1", items };
}

function cartItem(overrides: any = {}) {
  return {
    id: "ci1",
    cartId: "cart-1",
    pricingType: "carton",
    quantity: 1,
    productVariant: {
      id: "v1",
      unitsPerCarton: 12,
      cartonPrice: "21000",
      piecePrice: "2000",
      stockLevel: 50,
      product: { id: "p1", name: "Indomie" },
    },
    ...overrides,
  };
}

const validBody = {
  paymentMethod: "COD",
  contact: { email: "ada@example.com", phone: "+234 812 3456 789" },
  shippingAddress: {
    fullName: "Ada N",
    phone: "+234 812 3456 789",
    street: "25 City Drive",
    city: "Victoria Island",
    state: "Lagos",
    lga: "Eti-Osa",
    country: "Nigeria",
  },
};

function createdOrder(overrides: any = {}) {
  return {
    id: "o1",
    orderNumber: 42,
    status: "PENDING_PAYMENT",
    totalAmount: "22500",
    subtotal: "21000",
    shippingFee: "1500",
    paymentFee: "0",
    discount: "0",
    paymentMethod: "COD",
    contactEmail: "ada@example.com",
    contactPhone: "+234 812 3456 789",
    companyName: null,
    notes: null,
    trackingNumber: null,
    shippingAddress: validBody.shippingAddress,
    createdAt: new Date(),
    items: [],
    ...overrides,
  };
}

function post(body: unknown) {
  return withMocks(checkout, { prisma: mockPrisma, supabase: mockSupabase }).request(
    "/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-token",
      },
      body: JSON.stringify(body),
    },
    ENV
  );
}

function getQuote(query = "") {
  return withMocks(checkout, { prisma: mockPrisma, supabase: mockSupabase }).request(
    `/quote${query}`,
    { headers: { Authorization: "Bearer fake-token" } },
    ENV
  );
}

describe("GET /checkout/quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns totals for both payment methods", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));

    const res = await getQuote("?state=Lagos");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.quotes.COD).toEqual({
      subtotal: 21000,
      shippingFee: 1500,
      paymentFee: 0,
      discount: 0,
      total: 22500,
    });
    expect(body.quotes.CARD).toMatchObject({ paymentFee: 450, total: 22950 });
  });

  it("rejects an empty cart", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([]));
    const res = await getQuote();
    expect(res.status).toBe(400);
  });
});

describe("shipping from Fez", () => {
  const FEZ_ENV = {
    ...ENV,
    FEZ_USER_ID: "G-1",
    FEZ_PASSWORD: "pw",
    FEZ_BASE_URL: "https://fez.test/v1",
  };
  const fetchMock = vi.fn();

  function quoteWithFez(query: string) {
    return withMocks(checkout, { prisma: mockPrisma, supabase: mockSupabase }).request(
      `/quote${query}`,
      { headers: { Authorization: "Bearer fake-token" } },
      FEZ_ENV
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    resetFezCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Fez's delivery cost for the state in the quote", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "Success",
            authDetails: { authToken: "t" },
            orgDetails: { "secret-key": "s" },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "Success", totalCost: 6450 }))
      );
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));

    const body = await (await quoteWithFez("?state=Kano")).json();

    expect(body.quotes.COD).toMatchObject({ shippingFee: 6450, total: 27450 });
    expect(body.quotes.CARD).toMatchObject({ shippingFee: 6450 });
  });

  it("falls back to the flat fee when Fez is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("network down"));
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));

    const res = await quoteWithFez("?state=Kano");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.quotes.COD).toMatchObject({ shippingFee: 1500, total: 22500 });
  });

  it("uses the flat fee when no state has been chosen yet", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));

    const body = await (await quoteWithFez("")).json();

    expect(body.quotes.COD).toMatchObject({ shippingFee: 1500 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an invalid body", async () => {
    mockAsAuthedUser();
    const res = await post({ ...validBody, paymentMethod: "PAYPAL" });
    expect(res.status).toBe(400);
    expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
  });

  it("requires a local government area", async () => {
    mockAsAuthedUser();
    const { lga: _lga, ...withoutLga } = validBody.shippingAddress;
    const res = await post({ ...validBody, shippingAddress: withoutLga });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("lga");
    expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a local government that is not in the chosen state", async () => {
    mockAsAuthedUser();
    // Ikeja is in Lagos, not Oyo.
    const res = await post({
      ...validBody,
      shippingAddress: { ...validBody.shippingAddress, state: "Oyo", lga: "Ikeja" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("local government");
    expect(mockPrisma.cart.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a state that does not exist", async () => {
    mockAsAuthedUser();
    const res = await post({
      ...validBody,
      shippingAddress: { ...validBody.shippingAddress, state: "Atlantis" },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("state");
  });

  it("requires a checkoutMode for card payments", async () => {
    mockAsAuthedUser();
    const res = await post({ ...validBody, paymentMethod: "CARD" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty cart", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([]));
    const res = await post(validBody);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/empty/i);
  });

  it("returns 409 when stock is short, counting cartons as pieces", async () => {
    mockAsAuthedUser();
    // 5 cartons x 12 = 60 pieces needed, only 50 in stock
    mockPrisma.cart.findUnique.mockResolvedValueOnce(
      cartWith([cartItem({ quantity: 5 })])
    );
    const res = await post(validBody);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.shortages[0]).toEqual({ name: "Indomie", requested: 60, available: 50 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("combines carton and piece lines of the same variant for the stock check", async () => {
    mockAsAuthedUser();
    const variant = cartItem().productVariant;
    mockPrisma.cart.findUnique.mockResolvedValueOnce(
      cartWith([
        cartItem({ id: "a", pricingType: "carton", quantity: 4, productVariant: { ...variant, stockLevel: 50 } }), // 48
        cartItem({ id: "b", pricingType: "piece", quantity: 3, productVariant: { ...variant, stockLevel: 50 } }), // +3 = 51
      ])
    );
    const res = await post(validBody);
    expect(res.status).toBe(409);
  });

  it("places a COD order: deducts stock in pieces, stays pending until an admin confirms, clears the cart, no payment row", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));
    mockTx.productVariant.updateMany.mockResolvedValueOnce({ count: 1 });
    mockTx.order.create.mockResolvedValueOnce(createdOrder());

    const res = await post(validBody);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockTx.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", stockLevel: { gte: 12 } },
      data: { stockLevel: { decrement: 12 } },
    });
    expect(mockTx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_PAYMENT",
          paymentMethod: "COD",
          subtotal: 21000,
          shippingFee: 1500,
          paymentFee: 0,
          totalAmount: 22500,
        }),
      })
    );
    expect(mockTx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: "cart-1" } });
    expect(mockTx.payment.create).not.toHaveBeenCalled();
    expect(body.order.reference).toBe("OG-000042");
    expect(body.payment).toBeUndefined();
  });

  it("returns 409 when a COD stock decrement loses a race", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));
    mockTx.productVariant.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await post(validBody);

    expect(res.status).toBe(409);
    expect(mockTx.order.create).not.toHaveBeenCalled();
  });

  it("creates a pending card order with a payment, leaving stock and cart alone", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));
    mockTx.order.create.mockResolvedValueOnce(
      createdOrder({ status: "PENDING_PAYMENT", paymentMethod: "CARD", paymentFee: "450", totalAmount: "22950" })
    );
    mockTx.payment.create.mockImplementationOnce(async ({ data }: any) => ({ ...data }));

    const res = await post({ ...validBody, paymentMethod: "CARD", checkoutMode: "INLINE" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockTx.productVariant.updateMany).not.toHaveBeenCalled();
    expect(mockTx.cartItem.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_PAYMENT",
          paymentFee: 450,
          totalAmount: 22950,
        }),
      })
    );
    expect(body.payment.amount).toBe(22950);
    expect(body.payment.checkoutMode).toBe("INLINE");
    expect(body.payment.reference).toMatch(/^OG42-[A-Z0-9]{10}$/);
  });

  it("saves the address when asked, without failing the order if that errors", async () => {
    mockAsAuthedUser();
    mockPrisma.cart.findUnique.mockResolvedValueOnce(cartWith([cartItem()]));
    mockTx.productVariant.updateMany.mockResolvedValueOnce({ count: 1 });
    mockTx.order.create.mockResolvedValueOnce(createdOrder());
    mockPrisma.address.create.mockRejectedValueOnce(new Error("db hiccup"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post({ ...validBody, saveAddress: true });

    expect(res.status).toBe(201);
    expect(mockPrisma.address.create).toHaveBeenCalled();
  });
});