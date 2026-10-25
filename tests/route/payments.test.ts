import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/fcmb.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/fcmb.js")>()),
  initializeTransaction: vi.fn(),
}));
vi.mock("@/utils/settle-payment.js", () => ({ verifyAndSettle: vi.fn() }));

import { payments } from "@/routes/payments.js";
import { FcmbError, initializeTransaction } from "@/utils/fcmb.js";
import { verifyAndSettle } from "@/utils/settle-payment.js";
import { withMocks } from "../utils/with-mocks.js";

const mockPrisma = {
  user: { findUnique: vi.fn() },
  order: { findFirst: vi.fn() },
  payment: { findFirst: vi.fn(), create: vi.fn() },
};
const mockSupabase = { auth: { getUser: vi.fn() } };

const authedUser = { id: "u1", supabaseId: "user-id", role: "CUSTOMER", email: "ada@example.com" };
const ENV = {
  FRONTEND_URL: "https://oyingold.com",
  FCMB_PUBLIC_KEY: "pk_test",
  FCMB_SECRET_KEY: "sk_test",
};

function mockAsAuthedUser() {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: "user-id", email: "ada@example.com" } },
    error: null,
  } as any);
  mockPrisma.user.findUnique.mockResolvedValueOnce(authedUser as any);
}

function call(path: string, body?: unknown, env: any = ENV) {
  return withMocks(payments, { prisma: mockPrisma, supabase: mockSupabase }).request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer fake-token" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env
  );
}

const pendingPayment = (overrides: any = {}) => ({
  id: "pay1",
  reference: "OG42-ABC",
  checkoutMode: "STANDARD",
  amount: "22950",
  status: "PENDING",
  order: {
    id: "o1",
    orderNumber: 42,
    status: "PENDING_PAYMENT",
    contactEmail: "ada@example.com",
    shippingAddress: { fullName: "Ada Nwosu" },
  },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /payments (new attempt)", () => {
  it("requires an order id and a valid checkout mode", async () => {
    mockAsAuthedUser();
    const res = await call("/", { orderId: "o1", checkoutMode: "PAYPAL" });
    expect(res.status).toBe(400);
  });

  it("404s for an order that isn't the customer's", async () => {
    mockAsAuthedUser();
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);
    const res = await call("/", { orderId: "o1", checkoutMode: "INLINE" });
    expect(res.status).toBe(404);
  });

  it("refuses orders that aren't awaiting a card payment", async () => {
    mockAsAuthedUser();
    mockPrisma.order.findFirst.mockResolvedValueOnce({
      id: "o1", orderNumber: 42, paymentMethod: "COD", status: "UNFULFILLED", totalAmount: "22500",
    });
    const res = await call("/", { orderId: "o1", checkoutMode: "INLINE" });
    expect(res.status).toBe(409);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it("creates a fresh payment with its own reference", async () => {
    mockAsAuthedUser();
    mockPrisma.order.findFirst.mockResolvedValueOnce({
      id: "o1", orderNumber: 42, paymentMethod: "CARD", status: "PENDING_PAYMENT", totalAmount: "22950",
    });
    mockPrisma.payment.create.mockImplementationOnce(async ({ data }: any) => ({ ...data }));

    const res = await call("/", { orderId: "o1", checkoutMode: "INLINE" });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.payment.reference).toMatch(/^OG42-[A-Z0-9]{10}$/);
    expect(body.payment).toMatchObject({ amount: 22950, checkoutMode: "INLINE" });
  });
});

describe("POST /payments/:reference/initialize", () => {
  it("404s for a payment that isn't the customer's", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce(null);
    const res = await call("/OG42-ABC/initialize");
    expect(res.status).toBe(404);
  });

  it("refuses a payment that is no longer pending", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce(pendingPayment({ status: "PAID" }));
    const res = await call("/OG42-ABC/initialize");
    expect(res.status).toBe(409);
  });

  it("returns the hosted link for standard checkout", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce(pendingPayment());
    vi.mocked(initializeTransaction).mockResolvedValueOnce({ redirectLink: "https://checkout.example/#/pay" });

    const res = await call("/OG42-ABC/initialize");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ mode: "STANDARD", redirectLink: "https://checkout.example/#/pay" });
    expect(initializeTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reference: "OG42-ABC",
        amount: "22950.00",
        email: "ada@example.com",
        productId: "OG-000042",
        callbackUrl: "https://oyingold.com/checkout/complete?reference=OG42-ABC",
      })
    );
  });

  it("returns a friendly 502 when the gateway can't start the payment", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce(pendingPayment());
    vi.mocked(initializeTransaction).mockRejectedValueOnce(new FcmbError("down"));

    const res = await call("/OG42-ABC/initialize");

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/try again/i);
  });

  it("returns the popup settings for inline checkout, with no gateway call", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce(pendingPayment({ checkoutMode: "INLINE" }));

    const res = await call("/OG42-ABC/initialize");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(body.mode).toBe("INLINE");
    expect(body.config).toEqual({
      publicKey: "pk_test",
      reference: "OG42-ABC",
      amount: "22950.00",
      currency: "NGN",
      country: "NG",
      description: "Oyingold Retail order OG-000042",
      email: "ada@example.com",
      fullName: "Ada Nwosu",
      callbackUrl: "https://oyingold.com/checkout/complete?reference=OG42-ABC",
    });
    // The secret key must never leave the server.
    expect(JSON.stringify(body)).not.toContain("sk_test");
  });

  it("reports missing configuration instead of crashing", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce(pendingPayment());
    const res = await call("/OG42-ABC/initialize", undefined, {});
    expect(res.status).toBe(500);
  });
});

describe("POST /payments/:reference/verify", () => {
  it("404s for a payment that isn't the customer's, without asking the gateway", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce(null);
    const res = await call("/OG42-ABC/verify");
    expect(res.status).toBe(404);
    expect(verifyAndSettle).not.toHaveBeenCalled();
  });

  it("returns the settled status and the order", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce({ id: "pay1" });
    vi.mocked(verifyAndSettle).mockResolvedValueOnce({
      outcome: "paid",
      paymentStatus: "PAID",
      order: { id: "o1", orderNumber: 42, status: "UNFULFILLED", needsAttention: false },
    });

    const res = await call("/OG42-ABC/verify");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.paymentStatus).toBe("PAID");
    expect(body.order).toEqual({ id: "o1", reference: "OG-000042", status: "UNFULFILLED" });
    expect(JSON.stringify(body)).not.toContain("needsAttention");
  });

  it("explains an amount mismatch to the customer", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce({ id: "pay1" });
    vi.mocked(verifyAndSettle).mockResolvedValueOnce({
      outcome: "amount_mismatch",
      paymentStatus: "FAILED",
      order: { id: "o1", orderNumber: 42, status: "PENDING_PAYMENT", needsAttention: true },
    });

    const body = await (await call("/OG42-ABC/verify")).json();

    expect(body.paymentStatus).toBe("FAILED");
    expect(body.message).toMatch(/doesn't match/);
  });

  it("returns 502 when the gateway can't be reached, telling the customer not to pay twice", async () => {
    mockAsAuthedUser();
    mockPrisma.payment.findFirst.mockResolvedValueOnce({ id: "pay1" });
    vi.mocked(verifyAndSettle).mockRejectedValueOnce(new FcmbError("down"));

    const res = await call("/OG42-ABC/verify");

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/don't pay again/i);
  });
});