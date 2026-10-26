import { Hono } from "hono";
import type { AppEnv } from "@/types/hono.js";
import { requireAuth } from "@/middlewares/require-auth.js";
import { CUSTOMER_ORDER_INCLUDE, presentOrder } from "@/utils/orders.js";
import { makePaymentReference } from "@/utils/payments.js";
import {
  buildTotals,
  stockUnitsForLine,
  toKobo,
  type PaymentMethod,
  type PricingEnv,
  type PricingType,
} from "@/utils/pricing.js";

type CheckoutMode = "INLINE" | "STANDARD";

type CheckoutInput = {
  paymentMethod: PaymentMethod;
  checkoutMode: CheckoutMode | null;
  contact: { email: string; phone: string; companyName: string | null };
  shippingAddress: {
    fullName: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    country: string;
    zipCode: string | null;
  };
  notes: string | null;
  saveAddress: boolean;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s()-]{6,19}$/;

// Thrown inside the COD transaction when a conditional stock decrement fails,
// which rolls the whole transaction back.
class OutOfStockError extends Error {}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function optionalStr(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed || null : undefined;
}

function parseBody(
  body: unknown
): { error: string } | { value: CheckoutInput } {
  if (!body || typeof body !== "object") {
    return { error: "A JSON body is required" };
  }
  const b = body as Record<string, any>;

  if (b.paymentMethod !== "CARD" && b.paymentMethod !== "COD") {
    return { error: "paymentMethod must be 'CARD' or 'COD'" };
  }

  let checkoutMode: CheckoutMode | null = null;
  if (b.paymentMethod === "CARD") {
    if (b.checkoutMode !== "INLINE" && b.checkoutMode !== "STANDARD") {
      return {
        error: "checkoutMode must be 'INLINE' or 'STANDARD' for card payments",
      };
    }
    checkoutMode = b.checkoutMode;
  }

  const email = str(b.contact?.email, 200);
  if (!email || !EMAIL_RE.test(email)) {
    return { error: "A valid contact email is required" };
  }

  const phone = str(b.contact?.phone, 20);
  if (!phone || !PHONE_RE.test(phone)) {
    return { error: "A valid contact phone number is required" };
  }

  const companyName = optionalStr(b.contact?.companyName, 200);
  if (companyName === undefined) {
    return { error: "companyName must be a string of at most 200 characters" };
  }

  const a = b.shippingAddress ?? {};
  const fullName = str(a.fullName, 200);
  const addressPhone = str(a.phone, 20);
  const street = str(a.street, 300);
  const city = str(a.city, 100);
  const state = str(a.state, 100);
  const country = str(a.country, 100);
  const zipCode = optionalStr(a.zipCode, 20);

  if (!fullName || !addressPhone || !street || !city || !state || !country) {
    return {
      error:
        "shippingAddress needs fullName, phone, street, city, state and country",
    };
  }
  if (!PHONE_RE.test(addressPhone)) {
    return { error: "shippingAddress.phone is not a valid phone number" };
  }
  if (zipCode === undefined) {
    return { error: "shippingAddress.zipCode must be a short string" };
  }

  const notes = optionalStr(b.notes, 1000);
  if (notes === undefined) {
    return { error: "notes must be a string of at most 1000 characters" };
  }

  return {
    value: {
      paymentMethod: b.paymentMethod,
      checkoutMode,
      contact: { email, phone, companyName },
      shippingAddress: {
        fullName,
        phone: addressPhone,
        street,
        city,
        state,
        country,
        zipCode,
      },
      notes,
      saveAddress: b.saveAddress === true,
    },
  };
}

type CartItemForPricing = {
  pricingType: string;
  quantity: number;
  productVariant: {
    id: string;
    unitsPerCarton: number;
    cartonPrice: unknown;
    piecePrice: unknown;
    stockLevel: number;
    product: { name: string };
  };
};

// Re-prices every cart line from the database. Nothing price-related comes from the client.
function priceCart(items: CartItemForPricing[]) {
  const unavailable: string[] = [];
  const lines: Array<{
    productVariantId: string;
    pricingType: PricingType;
    unitPrice: number;
    quantity: number;
  }> = [];
  const stockNeeded = new Map<
    string,
    { name: string; required: number; available: number }
  >();
  let subtotalKobo = 0;

  for (const item of items) {
    const variant = item.productVariant;
    const name = variant.product.name;
    const pricingType = item.pricingType as PricingType;

    const price =
      pricingType === "piece"
        ? variant.piecePrice
        : pricingType === "carton"
          ? variant.cartonPrice
          : null;

    if (price === null || price === undefined || toKobo(price) <= 0) {
      unavailable.push(name);
      continue;
    }

    const unitKobo = toKobo(price);
    subtotalKobo += unitKobo * item.quantity;

    lines.push({
      productVariantId: variant.id,
      pricingType,
      unitPrice: unitKobo / 100,
      quantity: item.quantity,
    });

    const required = stockUnitsForLine({
      pricingType,
      quantity: item.quantity,
      unitsPerCarton: variant.unitsPerCarton,
    });
    const existing = stockNeeded.get(variant.id);
    stockNeeded.set(variant.id, {
      name,
      required: (existing?.required ?? 0) + required,
      available: variant.stockLevel,
    });
  }

  return { unavailable, lines, stockNeeded, subtotalKobo };
}

const CART_FOR_CHECKOUT = {
  items: {
    include: { productVariant: { include: { product: true } } },
    orderBy: { createdAt: "asc" },
  },
} as const;

export const checkout = new Hono<AppEnv>()
  // What the cart would cost for each payment method. The checkout summary shows
  // these figures; the real totals are recalculated when the order is placed.
  .get("/quote", requireAuth, async (c) => {
    const prisma = c.get("prisma");
    const user = c.get("user");
    const env = (c.env ?? {}) as PricingEnv;
    const state = (c.req.query("state") ?? "").trim().slice(0, 100);

    const cart = await prisma.cart.findUnique({
      where: { userId: user.id },
      include: CART_FOR_CHECKOUT,
    });

    if (!cart || cart.items.length === 0) {
      return c.json({ error: "Your cart is empty" }, 400);
    }

    const { subtotalKobo } = priceCart(cart.items);

    return c.json({
      quotes: {
        CARD: buildTotals({ subtotalKobo, paymentMethod: "CARD", state, env }),
        COD: buildTotals({ subtotalKobo, paymentMethod: "COD", state, env }),
      },
    });
  })
  .post("/", requireAuth, async (c) => {
  const prisma = c.get("prisma");
  const user = c.get("user");
  const env = (c.env ?? {}) as PricingEnv;

  const parsed = parseBody(await c.req.json().catch(() => null));
  if ("error" in parsed) {
    return c.json({ error: parsed.error }, 400);
  }
  const input = parsed.value;

  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: CART_FOR_CHECKOUT,
  });

  if (!cart || cart.items.length === 0) {
    return c.json({ error: "Your cart is empty" }, 400);
  }

  const { unavailable, lines, stockNeeded, subtotalKobo } = priceCart(cart.items);

  if (unavailable.length > 0) {
    return c.json(
      {
        error: "Some items are no longer available for purchase",
        items: unavailable,
      },
      409
    );
  }

  // A variant can sit in the cart as both a carton line and a piece line, so
  // stock is checked on the combined amount per variant.
  const shortages = [...stockNeeded.values()]
    .filter((s) => s.required > s.available)
    .map((s) => ({ name: s.name, requested: s.required, available: s.available }));

  if (shortages.length > 0) {
    return c.json(
      { error: "Some items don't have enough stock", shortages },
      409
    );
  }

  const totals = buildTotals({
    subtotalKobo,
    paymentMethod: input.paymentMethod,
    state: input.shippingAddress.state,
    env,
  });

  const orderData = {
    userId: user.id,
    paymentMethod: input.paymentMethod,
    subtotal: totals.subtotal,
    shippingFee: totals.shippingFee,
    paymentFee: totals.paymentFee,
    discount: totals.discount,
    totalAmount: totals.total,
    contactEmail: input.contact.email,
    contactPhone: input.contact.phone,
    companyName: input.contact.companyName,
    notes: input.notes,
    shippingAddress: input.shippingAddress,
    items: { create: lines },
  };

  let responseBody: Record<string, unknown>;

  try {
    if (input.paymentMethod === "COD") {
      // COD: stock comes off now. Each decrement only succeeds if enough stock
      // is still there, so a lost race rolls the whole order back.
      const order = await prisma.$transaction(async (tx) => {
        for (const [variantId, need] of stockNeeded) {
          const result = await tx.productVariant.updateMany({
            where: { id: variantId, stockLevel: { gte: need.required } },
            data: { stockLevel: { decrement: need.required } },
          });
          if (result.count === 0) throw new OutOfStockError(need.name);
        }

        const created = await tx.order.create({
          data: { ...orderData, status: "UNFULFILLED" },
          include: CUSTOMER_ORDER_INCLUDE,
        });

        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        return created;
      });

      responseBody = { order: presentOrder(order) };
    } else {
      // Card: no stock change and the cart stays put until payment is confirmed,
      // so a failed payment doesn't cost the customer their cart.
      const { order, payment } = await prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: { ...orderData, status: "PENDING_PAYMENT" },
          include: CUSTOMER_ORDER_INCLUDE,
        });

        const createdPayment = await tx.payment.create({
          data: {
            orderId: created.id,
            reference: makePaymentReference(created.orderNumber),
            checkoutMode: input.checkoutMode!,
            amount: totals.total,
            status: "PENDING",
          },
        });

        return { order: created, payment: createdPayment };
      });

      responseBody = {
        order: presentOrder(order),
        payment: {
          reference: payment.reference,
          amount: totals.total,
          checkoutMode: payment.checkoutMode,
        },
      };
    }
  } catch (error) {
    if (error instanceof OutOfStockError) {
      return c.json(
        {
          error: "Some items don't have enough stock",
          shortages: [{ name: error.message }],
        },
        409
      );
    }
    throw error;
  }

  // Best effort: remembering the address must never fail an order that already exists.
  if (input.saveAddress) {
    try {
      const a = input.shippingAddress;
      await prisma.address.create({
        data: {
          userId: user.id,
          fullName: a.fullName,
          phone: a.phone,
          street: a.street,
          city: a.city,
          state: a.state,
          country: a.country,
          lastUsedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Failed to save checkout address", error);
    }
  }

  return c.json(responseBody, 201);
});