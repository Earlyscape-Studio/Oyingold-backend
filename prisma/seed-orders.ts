import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
// Node-runtime client (see the nodeClient generator in schema.prisma).
// The Workers client in lib/prisma.ts can't run under plain Node.
import { PrismaClient } from "../generated/prisma-node/client.js";
import { logger } from "../lib/logger.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: `${process.env.DATABASE_URL}` }),
});

// Usage: SEED_ORDERS_EMAIL=you@example.com npm run seed:orders
// The user must already exist, so sign in once through the app first.

const STATUSES = [
  "PENDING_PAYMENT",
  "UNFULFILLED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;

const ORDER_COUNT = 12;

async function main() {
  const email = process.env.SEED_ORDERS_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error("Set SEED_ORDERS_EMAIL to the email of an existing user.");
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(
      `No user with email ${email}. Sign in through the app once so the user is created, then re-run.`
    );
  }

  const existingOrders = await prisma.order.count({ where: { userId: user.id } });
  if (existingOrders > 0) {
    logger.info(`${email} already has ${existingOrders} orders, skipping.`);
    return;
  }

  const variants = await prisma.productVariant.findMany({
    take: 8,
    orderBy: { sku: "asc" },
  });
  if (variants.length < 2) {
    throw new Error("Seed products first (npm run seed).");
  }

  const address = await prisma.address.create({
    data: {
      userId: user.id,
      fullName: user.fullName ?? "Test Customer",
      phone: "+234 812 3456 789",
      street: "25, City Drive, Adewale junction, Off Gold bridge",
      city: "Victoria Island",
      state: "Lagos",
      country: "Nigeria",
      isDefault: true,
      lastUsedAt: new Date(),
    },
  });

  const shippingAddress = {
    fullName: address.fullName,
    phone: address.phone,
    street: address.street,
    city: address.city,
    state: address.state,
    country: address.country,
  };

  for (let i = 0; i < ORDER_COUNT; i++) {
    const status = STATUSES[i % STATUSES.length];

    const lines = [0, 1].map((offset) => {
      const variant = variants[(i + offset) % variants.length];
      const usePiece = variant.piecePrice !== null && (i + offset) % 2 === 0;
      return {
        productVariantId: variant.id,
        pricingType: usePiece ? "piece" : "carton",
        unitPrice: usePiece ? variant.piecePrice! : variant.cartonPrice,
        quantity: (i % 3) + 1,
      };
    });

    const totalAmount = lines.reduce(
      (sum, l) => sum + Number(l.unitPrice) * l.quantity,
      0
    );

    await prisma.order.create({
      data: {
        userId: user.id,
        status,
        totalAmount,
        shippingAddress,
        trackingNumber: status === "SHIPPED" || status === "DELIVERED" ? `TRK-${1000 + i}` : null,
        createdAt: new Date(Date.now() - i * 2 * 24 * 60 * 60 * 1000),
        items: { create: lines },
      },
    });
  }

  logger.info(`Seeded ${ORDER_COUNT} test orders for ${email}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    logger.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });