import { Hono } from "hono";
// import { prisma } from "@/lib/prisma.js";
import type {AppEnv} from "@/types/hono.js";
import { requireAdmin } from "@/middlewares/require-admin.js";
import { stockUnitsForLine, type PricingType } from "@/utils/pricing.js";

const VALID_STATUSES = [
  "PENDING_PAYMENT",
  "UNFULFILLED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

export const orders = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const { status, needsAttention } = c.req.query();

    if (status && !VALID_STATUSES.includes(status as any)) {
      return c.json(
        { error: `status must be one of ${VALID_STATUSES.join(", ")}` },
        400
      );
    }

    if (needsAttention !== undefined && needsAttention !== "true") {
      return c.json({ error: "needsAttention can only be 'true'" }, 400);
    }

    const list = await prisma.order.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(needsAttention === "true" ? { needsAttention: true } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
        items: {
          include: {
            productVariant: {
              include: {
                product: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return c.json(list);
  })

  .get("/:id", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const id = c.req.param("id");

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
        items: {
          include: {
            productVariant: {
              include: {
                product: true,
              },
            },
          },
        },
        // Every payment attempt, newest first, so a flagged order can be traced to its gateway reference.
        payments: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            reference: true,
            gatewayReference: true,
            checkoutMode: true,
            amount: true,
            fee: true,
            status: true,
            gatewayCode: true,
            gatewayMessage: true,
            channel: true,
            paidAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    return c.json(order);
  })

  .patch("/:id/status", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);

    const { status, trackingNumber } = body ?? {};

    if (!status || !VALID_STATUSES.includes(status)) {
      return c.json(
        {
          error: `status is required and must be one of ${VALID_STATUSES.join(
            ", "
          )}`,
        },
        400
      );
    }

    const data: Record<string, unknown> = { status };
    if (trackingNumber !== undefined)
      data.trackingNumber = trackingNumber || null;

    const existing = await prisma.order.findUnique({
      where: { id },
      select: {
        status: true,
        items: {
          select: {
            productVariantId: true,
            pricingType: true,
            quantity: true,
            productVariant: { select: { unitsPerCarton: true } },
          },
        },
      },
    });

    if (!existing) {
      return c.json({ error: "Order not found" }, 404);
    }

    // Cancelling gives the stock back, so a cancelled order can't quietly come back to life.
    if (existing.status === "CANCELLED" && status !== "CANCELLED") {
      return c.json(
        {
          error:
            "A cancelled order can't be reopened. Ask the customer to place a new order.",
        },
        409
      );
    }

    const include = {
      user: {
        select: {
          id: true,
          email: true,
        },
      },
      items: {
        include: {
          productVariant: {
            include: {
              product: true,
            },
          },
        },
      },
    };

    const cancelling = status === "CANCELLED" && existing.status !== "CANCELLED";

    try {
      const updated = cancelling
        ? await prisma.$transaction(async (tx) => {
            // Claim the restock first, so two admins cancelling at once (or a
            // second click) can't both put the stock back. Orders whose stock was
            // never deducted (unpaid card orders, orders from before checkout
            // existed) have nothing to restore.
            const claimed = await tx.order.updateMany({
              where: { id, stockDeducted: true },
              data: { stockDeducted: false },
            });

            if (claimed.count > 0) {
              const restore = new Map<string, number>();

              for (const item of existing.items) {
                const units = stockUnitsForLine({
                  pricingType: item.pricingType as PricingType,
                  quantity: item.quantity,
                  unitsPerCarton: item.productVariant.unitsPerCarton,
                });
                restore.set(
                  item.productVariantId,
                  (restore.get(item.productVariantId) ?? 0) + units
                );
              }

              for (const [variantId, units] of restore) {
                await tx.productVariant.update({
                  where: { id: variantId },
                  data: { stockLevel: { increment: units } },
                });
              }
            }

            return tx.order.update({ where: { id }, data, include });
          })
        : await prisma.order.update({ where: { id }, data, include });

      return c.json(updated);
    } catch (err: any) {
      if (err?.code === "P2025") {
        return c.json({ error: "Order not found" }, 404);
      }
      throw err;
    }
  })

  // An admin has dealt with a flagged order (refunded, contacted the customer, ...).
  .patch("/:id/attention", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const id = c.req.param("id");

    try {
      const updated = await prisma.order.update({
        where: { id },
        data: { needsAttention: false, needsAttentionReason: null },
        select: { id: true, needsAttention: true, needsAttentionReason: true },
      });

      return c.json(updated);
    } catch (err: any) {
      if (err?.code === "P2025") {
        return c.json({ error: "Order not found" }, 404);
      }
      throw err;
    }
  });
