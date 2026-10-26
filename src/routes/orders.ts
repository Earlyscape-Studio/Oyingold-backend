import { Hono } from "hono";
// import { prisma } from "@/lib/prisma.js";
import type {AppEnv} from "@/types/hono.js";
import { requireAdmin } from "@/middlewares/require-admin.js";

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

    try {
      const updated = await prisma.order.update({
        where: { id },
        data,
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
      });

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