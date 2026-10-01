import { Hono } from "hono";
import { requireAuth } from "@/middlewares/require-auth.js";
import type { AppEnv } from "@/types/hono.js";
import { CUSTOMER_ORDER_INCLUDE, presentOrder } from "@/utils/orders.js";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

function parsePositiveInt(value: string | undefined, fallback: number) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const me = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");

    const totalOrders = await prisma.order.count({
      where: { userId: user.id },
    });

    return c.json({
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName ?? null,
      phone: user.phone ?? null,
      memberSince: user.createdAt,
      totalOrders,
    });
  })

  .patch("/", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");
    const body = await c.req.json().catch(() => null);

    const data: { fullName?: string | null; phone?: string | null } = {};

    for (const field of ["fullName", "phone"] as const) {
      if (body?.[field] === undefined) continue;

      const value = body[field];
      if (value !== null && typeof value !== "string") {
        return c.json({ error: `${field} must be a string or null` }, 400);
      }

      const trimmed = typeof value === "string" ? value.trim() : null;
      if (trimmed && trimmed.length > 100) {
        return c.json({ error: `${field} is too long` }, 400);
      }

      data[field] = trimmed || null;
    }

    if (Object.keys(data).length === 0) {
      return c.json({ error: "Nothing to update" }, 400);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    return c.json({
      id: updated.id,
      email: updated.email,
      fullName: updated.fullName ?? null,
      phone: updated.phone ?? null,
    });
  })

  .get("/orders", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");

    const page = parsePositiveInt(c.req.query("page"), 1);
    const limit = Math.min(
      parsePositiveInt(c.req.query("limit"), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );

    const [total, orders] = await Promise.all([
      prisma.order.count({ where: { userId: user.id } }),
      prisma.order.findMany({
        where: { userId: user.id },
        include: CUSTOMER_ORDER_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return c.json({
      data: orders.map(presentOrder),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })

  .get("/orders/:id", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");

    // Scoped to the owner, so someone else's order id is a plain 404.
    const order = await prisma.order.findFirst({
      where: { id: c.req.param("id"), userId: user.id },
      include: CUSTOMER_ORDER_INCLUDE,
    });

    if (!order) {
      return c.json({ error: "Order not found" }, 404);
    }

    return c.json(presentOrder(order));
  })

  .get("/addresses", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");

    const addresses = await prisma.address.findMany({
      where: { userId: user.id },
      orderBy: [
        { lastUsedAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
    });

    // The first address with a lastUsedAt is the "Last Used" one in the UI.
    const lastUsedId = addresses.find((a) => a.lastUsedAt)?.id ?? null;

    return c.json(
      addresses.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        phone: a.phone,
        street: a.street,
        city: a.city,
        state: a.state,
        country: a.country,
        isDefault: a.isDefault,
        isLastUsed: a.id === lastUsedId,
      }))
    );
  });