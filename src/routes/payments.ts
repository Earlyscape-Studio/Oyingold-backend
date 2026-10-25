import { Hono } from "hono";
import type { AppEnv } from "@/types/hono.js";
import { requireAuth } from "@/middlewares/require-auth.js";
import { formatOrderNumber } from "@/utils/orders.js";
import { FcmbError, initializeTransaction } from "@/utils/fcmb.js";
import {
  formatGatewayAmount,
  makePaymentReference,
} from "@/utils/payments.js";
import { verifyAndSettle } from "@/utils/settle-payment.js";

type CheckoutMode = "INLINE" | "STANDARD";

const isCheckoutMode = (value: unknown): value is CheckoutMode =>
  value === "INLINE" || value === "STANDARD";

export const payments = new Hono<AppEnv>()
  // A new payment attempt for an unpaid card order: retrying after a failure,
  // or switching between inline and standard checkout. Every attempt gets its
  // own reference because the gateway refuses to reuse one.
  .post("/", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");

    const body: any = await c.req.json().catch(() => null);
    if (typeof body?.orderId !== "string" || !isCheckoutMode(body?.checkoutMode)) {
      return c.json(
        { error: "orderId and a checkoutMode of 'INLINE' or 'STANDARD' are required" },
        400
      );
    }

    const order = await prisma.order.findFirst({
      where: { id: body.orderId, userId: user.id },
    });
    if (!order) return c.json({ error: "Order not found" }, 404);

    if (order.paymentMethod !== "CARD" || order.status !== "PENDING_PAYMENT") {
      return c.json({ error: "This order is not waiting for a card payment" }, 409);
    }

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        reference: makePaymentReference(order.orderNumber),
        checkoutMode: body.checkoutMode,
        amount: order.totalAmount,
        status: "PENDING",
      },
    });

    return c.json(
      {
        payment: {
          reference: payment.reference,
          amount: Number(order.totalAmount),
          checkoutMode: payment.checkoutMode,
        },
      },
      201
    );
  })

  // Starts the payment. Standard checkout returns a hosted link to send the
  // customer to; inline returns the settings the browser needs to open the popup.
  .post("/:reference/initialize", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");
    const env = c.env ?? ({} as typeof c.env);
    const reference = c.req.param("reference") ?? "";

    const payment = await prisma.payment.findFirst({
      where: { reference, order: { userId: user.id } },
      include: { order: true },
    });
    if (!payment) return c.json({ error: "Payment not found" }, 404);

    if (payment.status !== "PENDING" || payment.order.status !== "PENDING_PAYMENT") {
      return c.json({ error: "This payment can no longer be started" }, 409);
    }

    if (!env.FRONTEND_URL) {
      return c.json({ error: "Payments are not configured" }, 500);
    }

    const orderRef = formatOrderNumber(payment.order.orderNumber);
    const amount = formatGatewayAmount(payment.amount);
    const email = payment.order.contactEmail ?? user.email;
    const callbackUrl = `${env.FRONTEND_URL.replace(/\/$/, "")}/checkout/complete?reference=${encodeURIComponent(reference)}`;

    if (payment.checkoutMode === "STANDARD") {
      try {
        const { redirectLink } = await initializeTransaction(env, {
          reference,
          amount,
          email,
          productId: orderRef,
          productDescription: `Oyingold Retail order ${orderRef}`,
          callbackUrl,
        });
        return c.json({ mode: "STANDARD", redirectLink });
      } catch (error) {
        if (error instanceof FcmbError) {
          return c.json(
            { error: "We couldn't start your payment. Please try again." },
            502
          );
        }
        throw error;
      }
    }

    if (!env.FCMB_PUBLIC_KEY) {
      return c.json({ error: "Payments are not configured" }, 500);
    }

    const address = payment.order.shippingAddress as { fullName?: string } | null;

    return c.json({
      mode: "INLINE",
      config: {
        publicKey: env.FCMB_PUBLIC_KEY,
        reference,
        amount,
        currency: "NGN",
        country: "NG",
        description: `Oyingold Retail order ${orderRef}`,
        email,
        fullName: address?.fullName ?? null,
        callbackUrl,
      },
    });
  })

  // Asks the gateway what happened to a payment and updates the order to match.
  // The frontend calls this after the customer returns, whatever the browser
  // callback claimed. Safe to call repeatedly.
  .post("/:reference/verify", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");
    const env = c.env ?? ({} as typeof c.env);
    const reference = c.req.param("reference") ?? "";

    const owned = await prisma.payment.findFirst({
      where: { reference, order: { userId: user.id } },
      select: { id: true },
    });
    if (!owned) return c.json({ error: "Payment not found" }, 404);

    try {
      const result = await verifyAndSettle(prisma, env, reference);

      return c.json({
        paymentStatus: result.paymentStatus,
        message:
          result.outcome === "amount_mismatch"
            ? "We received a payment that doesn't match your order total. Our team will be in touch."
            : undefined,
        order: result.order
          ? {
              id: result.order.id,
              reference: formatOrderNumber(result.order.orderNumber),
              status: result.order.status,
            }
          : null,
      });
    } catch (error) {
      if (error instanceof FcmbError) {
        return c.json(
          {
            error:
              "We couldn't confirm your payment right now. If you were charged, please don't pay again. Check your orders in a few minutes.",
          },
          502
        );
      }
      throw error;
    }
  });