import { describe, it, expect, vi, beforeEach } from "vitest";
import { cart } from "@/routes/cart.js";
import { withMocks } from "../utils/with-mocks.js";

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
  },
  cart: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  productVariant: {
    findUnique: vi.fn(),
  },
  cartItem: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  },
};

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
};

const authedUser = { id: "u1", supabaseId: "user-id", role: "CUSTOMER" };
const userCart = { id: "cart-1", userId: "u1" };

function mockAsAuthedUser() {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: "user-id", email: "customer@example.com" } },
    error: null,
  } as any);

  mockPrisma.user.findUnique.mockResolvedValueOnce(authedUser as any);
}

function postItems(body: unknown) {
  return withMocks(cart, {
    prisma: mockPrisma,
    supabase: mockSupabase,
  }).request("/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-token",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /cart/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an out-of-stock variant", async () => {
    mockAsAuthedUser();

    mockPrisma.productVariant.findUnique.mockResolvedValueOnce({
      id: "v1",
      cartonPrice: "37000",
      piecePrice: "3200",
      stockLevel: 0,
    } as any);

    const res = await postItems({
      productVariantId: "v1",
      pricingType: "carton",
      quantity: 1,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This item is out of stock" });
  });

  it("rejects a variant with a zero/placeholder carton price", async () => {
    mockAsAuthedUser();

    mockPrisma.productVariant.findUnique.mockResolvedValueOnce({
      id: "v2",
      cartonPrice: "0",
      piecePrice: null,
      stockLevel: 10,
    } as any);

    const res = await postItems({
      productVariantId: "v2",
      pricingType: "carton",
      quantity: 1,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This item isn't available for purchase yet",
    });
  });

  it("rejects a zero-priced piece even when the carton price is valid", async () => {
    mockAsAuthedUser();

    mockPrisma.productVariant.findUnique.mockResolvedValueOnce({
      id: "v3",
      cartonPrice: "37000",
      piecePrice: "0",
      stockLevel: 10,
    } as any);

    const res = await postItems({
      productVariantId: "v3",
      pricingType: "piece",
      quantity: 1,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This item isn't available for purchase yet",
    });
  });

  it("adds a valid, in-stock variant to the cart", async () => {
    mockAsAuthedUser();

    mockPrisma.productVariant.findUnique.mockResolvedValueOnce({
      id: "v4",
      cartonPrice: "37000",
      piecePrice: "3200",
      stockLevel: 10,
    } as any);

    mockPrisma.cartItem.upsert.mockResolvedValueOnce({} as any);

    // First call is getOrCreateCart's lookup, second is the final refetch
    // after the item is created.
    mockPrisma.cart.findUnique.mockResolvedValueOnce(userCart as any);
    mockPrisma.cart.findUnique.mockResolvedValueOnce({
      ...userCart,
      items: [],
    } as any);

    const res = await postItems({
      productVariantId: "v4",
      pricingType: "carton",
      quantity: 1,
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ quantity: 1, pricingType: "carton" }),
        update: { quantity: { increment: 1 } },
      })
    );
  });

  it("rejects a fractional quantity instead of crashing", async () => {
    mockAsAuthedUser();

    const res = await postItems({
      productVariantId: "v4",
      pricingType: "carton",
      quantity: 1.5,
    });

    expect(res.status).toBe(400);
    expect(mockPrisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unreadable request body with a 400", async () => {
    mockAsAuthedUser();

    const res = await withMocks(cart, {
      prisma: mockPrisma,
      supabase: mockSupabase,
    }).request("/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-token",
      },
      body: "not json",
    });

    expect(res.status).toBe(400);
  });
});