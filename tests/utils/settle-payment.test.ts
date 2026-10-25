import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyAndSettle } from "@/utils/settle-payment.js";
import type { GatewayTransaction } from "@/utils/fcmb.js";

// One object plays both the client and the transaction client.
const db = {
  payment: { findUnique: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  order: { findUnique: vi.fn(), update: vi.fn() },
  productVariant: { updateMany: vi.fn() },
  cartItem: { deleteMany: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(db)),
};

const query = vi.fn();
const run = () => verifyAndSettle(db as any, {}, "OG42-ABC", { query });

function payment(overrides: any = {}) {
  return {
    id: "pay1",
    reference: "OG42-ABC",
    orderId: "o1",
    status: "PENDING",
    amount: "22950",
    order: {
      id: "o1",
      userId: "u1",
      items: [
        {
          productVariantId: "v1",
          pricingType: "carton",
          quantity: 2,
          productVariant: { unitsPerCarton: 12, product: { name: "Indomie" } },
        },
        {
          productVariantId: "v1",
          pricingType: "piece",
          quantity: 3,
          productVariant: { unitsPerCarton: 12, product: { name: "Indomie" } },
        },
      ],
    },
    ...overrides,
  };
}

function gateway(overrides: Partial<GatewayTransaction> = {}): GatewayTransaction {
  return {
    found: true,
    code: "00",
    message: "Successful",
    amount: 22950,
    fee: 150,
    gatewayReference: "GW1",
    channel: "CARD",
    raw: { status: "SUCCESS" },
    ...overrides,
  };
}

const orderAfter = (status = "UNFULFILLED") => ({
  id: "o1",
  orderNumber: 42,
  status,
  needsAttention: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.payment.findUnique.mockResolvedValue(payment());
  db.payment.updateMany.mockResolvedValue({ count: 1 });
  db.payment.count.mockResolvedValue(0);
  db.order.findUnique.mockImplementation(async ({ select }: any) =>
    select?.needsAttention ? orderAfter() : { status: "PENDING_PAYMENT" }
  );
  db.productVariant.updateMany.mockResolvedValue({ count: 1 });
});

describe("verifyAndSettle", () => {
  it("reports an unknown reference", async () => {
    db.payment.findUnique.mockResolvedValueOnce(null);
    const result = await run();
    expect(result.outcome).toBe("unknown_reference");
    expect(query).not.toHaveBeenCalled();
  });

  it("short-circuits an already paid payment without calling the gateway", async () => {
    db.payment.findUnique.mockResolvedValueOnce(payment({ status: "PAID" }));
    const result = await run();
    expect(result.outcome).toBe("paid");
    expect(query).not.toHaveBeenCalled();
    expect(db.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it("stays pending when the gateway has no record yet", async () => {
    query.mockResolvedValueOnce(gateway({ found: false, code: null }));
    const result = await run();
    expect(result.outcome).toBe("pending");
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });

  it("stays pending for an in-progress code and records the details", async () => {
    query.mockResolvedValueOnce(gateway({ code: "S20", amount: null }));
    const result = await run();
    expect(result.outcome).toBe("pending");
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay1", status: "PENDING" },
        data: expect.objectContaining({ gatewayCode: "S20" }),
      })
    );
  });

  it("marks a declined payment FAILED but never touches stock or the order status", async () => {
    query.mockResolvedValueOnce(gateway({ code: "SM_51", message: "Not sufficient funds" }));
    const result = await run();
    expect(result.outcome).toBe("failed");
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay1", status: "PENDING" },
        data: expect.objectContaining({ status: "FAILED", gatewayCode: "SM_51" }),
      })
    );
    expect(db.productVariant.updateMany).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("settles a good payment: PAID, stock deducted in pieces, order unfulfilled, purchased items removed from the cart", async () => {
    query.mockResolvedValueOnce(gateway());
    const result = await run();

    expect(result.outcome).toBe("paid");
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pay1", status: { not: "PAID" } },
        data: expect.objectContaining({ status: "PAID", gatewayReference: "GW1", fee: 150 }),
      })
    );
    // 2 cartons x 12 + 3 pieces = 27 pieces from one variant
    expect(db.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(db.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", stockLevel: { gte: 27 } },
      data: { stockLevel: { decrement: 27 } },
    });
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: { status: "UNFULFILLED" },
    });
    expect(db.cartItem.deleteMany).toHaveBeenCalledWith({
      where: {
        cart: { userId: "u1" },
        OR: [
          { productVariantId: "v1", pricingType: "carton" },
          { productVariantId: "v1", pricingType: "piece" },
        ],
      },
    });
  });

  it("does nothing more when a concurrent run already claimed the payment", async () => {
    query.mockResolvedValueOnce(gateway());
    db.payment.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await run();

    expect(result.outcome).toBe("paid");
    expect(db.productVariant.updateMany).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("fails the payment and flags the order when the amount doesn't match", async () => {
    query.mockResolvedValueOnce(gateway({ amount: 100 }));

    const result = await run();

    expect(result.outcome).toBe("amount_mismatch");
    expect(db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o1" },
        data: expect.objectContaining({ needsAttention: true }),
      })
    );
    expect(db.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a paid order when stock ran out, deducting nothing and flagging it", async () => {
    query.mockResolvedValueOnce(gateway());
    db.productVariant.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await run();

    expect(result.outcome).toBe("paid");
    // Settled twice: the first transaction rolled back, the second keeps the payment without touching stock.
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(db.order.update).toHaveBeenCalledWith({
      where: { id: "o1" },
      data: expect.objectContaining({
        status: "UNFULFILLED",
        needsAttention: true,
        needsAttentionReason: expect.stringContaining("Indomie"),
      }),
    });
  });

  it("flags a duplicate payment and leaves the order and stock alone", async () => {
    query.mockResolvedValueOnce(gateway());
    db.payment.count.mockResolvedValueOnce(1);

    const result = await run();

    expect(result.outcome).toBe("paid");
    expect(db.productVariant.updateMany).not.toHaveBeenCalled();
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          needsAttention: true,
          needsAttentionReason: expect.stringMatching(/Duplicate/),
        }),
      })
    );
  });

  it("flags a payment that lands on an order that is no longer waiting for one", async () => {
    query.mockResolvedValueOnce(gateway());
    db.order.findUnique.mockImplementation(async ({ select }: any) =>
      select?.needsAttention ? orderAfter("CANCELLED") : { status: "CANCELLED" }
    );

    await run();

    expect(db.productVariant.updateMany).not.toHaveBeenCalled();
    expect(db.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          needsAttention: true,
          needsAttentionReason: expect.stringContaining("CANCELLED"),
        }),
      })
    );
  });

  it("lets a gateway error propagate so nothing is decided without an answer", async () => {
    query.mockRejectedValueOnce(new Error("gateway down"));
    await expect(run()).rejects.toThrow("gateway down");
    expect(db.payment.updateMany).not.toHaveBeenCalled();
  });
});