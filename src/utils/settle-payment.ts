import type { Prisma, PrismaClient } from "@/generated/prisma/client.js";
import {
  queryTransaction,
  type FcmbEnv,
  type GatewayTransaction,
} from "@/utils/fcmb.js";
import { amountsMatch, mapGatewayCode } from "@/utils/payments.js";
import { stockUnitsForLine, type PricingType } from "@/utils/pricing.js";

export type SettleOutcome =
  | "unknown_reference"
  | "paid"
  | "pending"
  | "failed"
  | "amount_mismatch";

export type SettleResult = {
  outcome: SettleOutcome;
  paymentStatus: "PENDING" | "PAID" | "FAILED" | null;
  order: {
    id: string;
    orderNumber: number;
    status: string;
    needsAttention: boolean;
  } | null;
};

// Thrown inside the settle transaction when stock can't cover a paid order. It
// rolls the transaction back so nothing is half-applied.
class OutOfStockError extends Error {}

type Deps = {
  query?: (env: FcmbEnv, reference: string) => Promise<GatewayTransaction>;
};

type GatewayDetails = {
  gatewayReference?: string;
  gatewayCode?: string;
  gatewayMessage?: string;
  channel?: string;
  fee?: number;
  rawResponse?: Prisma.InputJsonValue;
};

// Drops null values so a later, emptier gateway answer never erases what we already know.
function compact(data: Record<string, unknown>): GatewayDetails {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== null && v !== undefined)
  ) as GatewayDetails;
}

/**
 * The single place a payment's fate is decided. Browser callbacks, the verify
 * endpoint and webhooks all end up here, and all it trusts is the gateway's own
 * answer to a status query. Safe to run any number of times for the same
 * reference: only one run can move a payment to PAID, so stock is deducted once.
 */
export async function verifyAndSettle(
  prisma: PrismaClient,
  env: FcmbEnv,
  reference: string,
  deps: Deps = {}
): Promise<SettleResult> {
  const query = deps.query ?? queryTransaction;

  const payment = await prisma.payment.findUnique({
    where: { reference },
    include: {
      order: {
        include: {
          items: { include: { productVariant: { include: { product: true } } } },
        },
      },
    },
  });

  if (!payment) {
    return { outcome: "unknown_reference", paymentStatus: null, order: null };
  }

  const finish = async (
    outcome: SettleOutcome,
    paymentStatus: "PENDING" | "PAID" | "FAILED"
  ): Promise<SettleResult> => ({
    outcome,
    paymentStatus,
    order: await prisma.order.findUnique({
      where: { id: payment.orderId },
      select: { id: true, orderNumber: true, status: true, needsAttention: true },
    }),
  });

  // Already settled: no need to bother the gateway again.
  if (payment.status === "PAID") return finish("paid", "PAID");

  const gateway = await query(env, reference);

  // The gateway has no record yet: the customer hasn't paid (or hasn't finished).
  if (!gateway.found) return finish("pending", "PENDING");

  const details = compact({
    gatewayReference: gateway.gatewayReference,
    gatewayCode: gateway.code,
    gatewayMessage: gateway.message,
    channel: gateway.channel,
    fee: gateway.fee,
    rawResponse: gateway.raw ?? null,
  });

  const outcome = mapGatewayCode(gateway.code);

  if (outcome === "PENDING") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: details,
    });
    return finish("pending", "PENDING");
  }

  if (outcome === "FAILED") {
    // Never downgrade a payment that has already been confirmed.
    await prisma.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { ...details, status: "FAILED" },
    });
    return finish("failed", "FAILED");
  }

  // The gateway says the money arrived. Make sure it's the amount we asked for:
  // the inline checkout takes its amount from the browser, so this can't be skipped.
  if (!amountsMatch(payment.amount, gateway.amount)) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: payment.id, status: { not: "PAID" } },
        data: {
          ...details,
          status: "FAILED",
          gatewayMessage: "Amount paid does not match the order total",
        },
      });
      await flagOrder(
        tx,
        payment.orderId,
        `Payment ${reference} reported ${gateway.amount} but the order total is ${Number(payment.amount)}. Check with FCMB and refund or fix manually.`
      );
    });
    return finish("amount_mismatch", "FAILED");
  }

  try {
    await prisma.$transaction((tx) => settle(tx, payment, details, { deductStock: true }));
  } catch (error) {
    if (!(error instanceof OutOfStockError)) throw error;

    // The customer has paid but the shelves can't cover it. Keep their payment,
    // leave stock alone and put the order in front of an admin.
    await prisma.$transaction((tx) =>
      settle(tx, payment, details, { deductStock: false, shortage: error.message })
    );
  }

  return finish("paid", "PAID");
}

type Tx = Prisma.TransactionClient;

async function flagOrder(tx: Tx, orderId: string, reason: string) {
  await tx.order.update({
    where: { id: orderId },
    data: { needsAttention: true, needsAttentionReason: reason },
  });
}

async function settle(
  tx: Tx,
  payment: {
    id: string;
    reference: string;
    orderId: string;
    order: {
      userId: string;
      items: Array<{
        productVariantId: string;
        pricingType: string;
        quantity: number;
        productVariant: { unitsPerCarton: number; product: { name: string } };
      }>;
    };
  },
  details: GatewayDetails,
  options: { deductStock: boolean; shortage?: string }
) {
  // Claim the payment. If another request already marked it PAID, it did the rest too.
  const claimed = await tx.payment.updateMany({
    where: { id: payment.id, status: { not: "PAID" } },
    data: { ...details, status: "PAID", paidAt: new Date() },
  });
  if (claimed.count === 0) return;

  // A second payment for an order that's already paid, or a payment that lands
  // on an order that's no longer waiting for one: keep the money on record, change
  // nothing else, and flag it for a human.
  const duplicates = await tx.payment.count({
    where: { orderId: payment.orderId, status: "PAID", id: { not: payment.id } },
  });
  if (duplicates > 0) {
    await flagOrder(
      tx,
      payment.orderId,
      `Duplicate payment ${payment.reference} received for an order that is already paid. Refund needed.`
    );
    return;
  }

  const current = await tx.order.findUnique({
    where: { id: payment.orderId },
    select: { status: true },
  });
  if (current?.status !== "PENDING_PAYMENT") {
    await flagOrder(
      tx,
      payment.orderId,
      `Payment ${payment.reference} received but the order is ${current?.status}. Check whether to refund.`
    );
    return;
  }

  if (options.deductStock) {
    const needed = new Map<string, { name: string; required: number }>();

    for (const item of payment.order.items) {
      const required = stockUnitsForLine({
        pricingType: item.pricingType as PricingType,
        quantity: item.quantity,
        unitsPerCarton: item.productVariant.unitsPerCarton,
      });
      const existing = needed.get(item.productVariantId);
      needed.set(item.productVariantId, {
        name: item.productVariant.product.name,
        required: (existing?.required ?? 0) + required,
      });
    }

    // Each decrement only succeeds if enough stock is still there.
    for (const [variantId, need] of needed) {
      const result = await tx.productVariant.updateMany({
        where: { id: variantId, stockLevel: { gte: need.required } },
        data: { stockLevel: { decrement: need.required } },
      });
      if (result.count === 0) throw new OutOfStockError(need.name);
    }
  }

  await tx.order.update({
    where: { id: payment.orderId },
    data: {
      status: "UNFULFILLED",
      ...(options.shortage
        ? {
            needsAttention: true,
            needsAttentionReason: `Paid, but not enough stock to fulfil: ${options.shortage}. Contact the customer or refund.`,
          }
        : {}),
    },
  });

  // Card orders leave the cart alone until they're paid. Now remove just what was
  // bought, so anything added to the cart in the meantime survives.
  if (payment.order.items.length > 0) {
    await tx.cartItem.deleteMany({
      where: {
        cart: { userId: payment.order.userId },
        OR: payment.order.items.map((item) => ({
          productVariantId: item.productVariantId,
          pricingType: item.pricingType,
        })),
      },
    });
  }
}