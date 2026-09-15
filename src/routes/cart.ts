import { Hono } from "hono";
import type { AppEnv } from "@/types/hono.js";
import { prisma } from "@/lib/prisma.js";
import { requireAuth } from "@/middlewares/require-auth.js";

const CART_INCLUDE = {
  items: {
    include: {
      productVariant: {
        include: { product: true },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
};

async function getOrCreateCart(userId: string) {
  const existing = await prisma.cart.findUnique({
    where: { userId },
    include: CART_INCLUDE,
  });

  if (existing) return existing;

  return prisma.cart.create({
    data: { userId },
    include: CART_INCLUDE,
  });
}

export const cart = new Hono<AppEnv>()
  .get("/", requireAuth, async (c) => {
    const user = c.get("user");
    const userCart = await getOrCreateCart(user.id);
    return c.json(userCart);
  })

  .post("/items", requireAuth, async (c) => {
    const user = c.get("user");
    const body = await c.req.json();

    const { productVariantId, quantity, pricingType } = body ?? {};

    if (
      !productVariantId ||
      !pricingType ||
      !["carton", "piece"].includes(pricingType)
    ) {
      return c.json(
        {
          error:
            "productVariantId and pricingType ('carton' | 'piece') are required",
        },
        400
      );
    }

    const qty = Number(quantity) || 1;
    if (qty < 1) {
      return c.json({ error: "quantity must be at least 1" }, 400);
    }

    const variant = await prisma.productVariant.findUnique({
      where: { id: productVariantId },
    });

    if (!variant) {
      return c.json({ error: "Product variant not found" }, 404);
    }

    if (pricingType === "piece" && variant.piecePrice === null) {
      return c.json({ error: "This variant is not sold by the piece" }, 400);
    }

    const userCart = await getOrCreateCart(user.id);

    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_productVariantId_pricingType: {
          cartId: userCart.id,
          productVariantId,
          pricingType,
        },
      },
    });

    if (existingItem) {
      await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + qty },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: userCart.id,
          productVariantId,
          pricingType,
          quantity: qty,
        },
      });
    }

    const updatedCart = await prisma.cart.findUnique({
      where: { id: userCart.id },
      include: CART_INCLUDE,
    });

    return c.json(updatedCart, 201);
  })
  .patch("/items/:itemId", requireAuth, async (c) => {
    const user = c.get("user");
    const itemId = c.req.param("itemId");
    const body = await c.req.json();

    const { quantity } = body ?? {};
    const qty = Number(quantity);

    if (!qty || qty < 1) {
      return c.json({ error: "quantity must be at least 1" }, 400);
    }

    const item = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });

    if (!item || item.cart.userId !== user.id) {
      return c.json({ error: "Cart item not found" }, 404);
    }

    await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: qty },
    });

    const updatedCart = await prisma.cart.findUnique({
      where: { id: item.cartId },
      include: CART_INCLUDE,
    });

    return c.json(updatedCart);
  })

  .delete("/items/:itemId", requireAuth, async (c) => {
    const user = c.get("user");
    const itemId = c.req.param("itemId");

    const item = await prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: true },
    });

    if (!item || item.cart.userId !== user.id) {
      return c.json({ error: "Cart item not found" }, 404);
    }

    await prisma.cartItem.delete({ where: { id: itemId } });

    const updatedCart = await prisma.cart.findUnique({
      where: { id: item.cartId },
      include: CART_INCLUDE,
    });

    return c.json(updatedCart);
  })

  .delete("/", requireAuth, async (c) => {
    const user = c.get("user");

    const userCart = await prisma.cart.findUnique({
      where: { userId: user.id },
    });

    if (userCart) {
      await prisma.cartItem.deleteMany({ where: { cartId: userCart.id } });
    }

    return c.json({ success: true });
  });
