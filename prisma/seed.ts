import {prisma} from "../lib/prisma.js"
import {logger} from "../lib/logger.js"



async function main() {
  // Categories
  const vegetableOil = await prisma.category.upsert({
    where: { slug: "vegetable-oil" },
    update: {},
    create: { name: "Vegetable Oil", slug: "vegetable-oil" },
  });

  const condiments = await prisma.category.upsert({
    where: { slug: "condiments" },
    update: {},
    create: { name: "Condiments", slug: "condiments" },
  });

  // Brands
  const goldwealth = await prisma.brand.upsert({
    where: { slug: "goldwealth" },
    update: {},
    create: { name: "Goldwealth", slug: "goldwealth" },
  });

  const devonKings = await prisma.brand.upsert({
    where: { slug: "devon-kings" },
    update: {},
    create: { name: "Devon Kings", slug: "devon-kings" },
  });

  const lazizOil = await prisma.brand.upsert({
    where: { slug: "laziz-oil" },
    update: {},
    create: { name: "Laziz Oil", slug: "laziz-oil" },
  });

  const lazizSeasoning = await prisma.brand.upsert({
    where: { slug: "laziz" },
    update: {},
    create: { name: "Laziz", slug: "laziz" },
  });

  // Products + variants — Goldwealth Vegetable Oil
  const goldwealthOilProduct = await prisma.product.upsert({
    where: { id: "seed-goldwealth-oil" },
    update: {},
    create: {
      id: "seed-goldwealth-oil",
      name: "Goldwealth Vegetable Oil",
      description: "Goldwealth branded vegetable oil, multiple pack sizes.",
      categoryId: vegetableOil.id,
      brandId: goldwealth.id,
    },
  });

  await prisma.productVariant.createMany({
    skipDuplicates: true,
    data: [
      {
        productId: goldwealthOilProduct.id,
        sku: "GW-VO-1L-12",
        unitLabel: "1 Litre",
        unitsPerCarton: 12,
        cartonPrice: 37000,
        piecePrice: 3200,
        stockLevel: 50,
      },
      {
        productId: goldwealthOilProduct.id,
        sku: "GW-VO-3L-6",
        unitLabel: "3 Litre",
        unitsPerCarton: 6,
        cartonPrice: 54000,
        piecePrice: 9700,
        stockLevel: 30,
      },
      {
        productId: goldwealthOilProduct.id,
        sku: "GW-VO-5L-4",
        unitLabel: "5 Litre",
        unitsPerCarton: 4,
        cartonPrice: 57000,
        piecePrice: 14500,
        stockLevel: 25,
      },
      {
        productId: goldwealthOilProduct.id,
        sku: "GW-VO-25L",
        unitLabel: "25 Litre",
        unitsPerCarton: 1,
        cartonPrice: 58000,
        piecePrice: 61000,
        stockLevel: 8,
      },
    ],
  });

  // Products + variants — Devon Kings Vegetable Oil
  const devonKingsOilProduct = await prisma.product.upsert({
    where: { id: "seed-devon-kings-oil" },
    update: {},
    create: {
      id: "seed-devon-kings-oil",
      name: "Devon Kings Vegetable Oil",
      description: "Devon Kings branded vegetable oil, multiple pack sizes.",
      categoryId: vegetableOil.id,
      brandId: devonKings.id,
    },
  });

  await prisma.productVariant.createMany({
    skipDuplicates: true,
    data: [
      {
        productId: devonKingsOilProduct.id,
        sku: "DK-VO-1L-12",
        unitLabel: "1 Litre",
        unitsPerCarton: 12,
        cartonPrice: 48000,
        piecePrice: 4300,
        stockLevel: 40,
      },
      {
        productId: devonKingsOilProduct.id,
        sku: "DK-VO-5L-4",
        unitLabel: "5 Litre",
        unitsPerCarton: 4,
        cartonPrice: 60000,
        piecePrice: 16500,
        stockLevel: 20,
      },
      {
        // no piece price on this one in the source data — carton-only
        productId: devonKingsOilProduct.id,
        sku: "DK-VO-750ML-12",
        unitLabel: "750 ml",
        unitsPerCarton: 12,
        cartonPrice: 0, // TODO: source data has no carton price either — placeholder, fix once confirmed
        piecePrice: null,
        stockLevel: 0,
      },
    ],
  });

  // Products + variants — Laziz Oil
  const lazizOilProduct = await prisma.product.upsert({
    where: { id: "seed-laziz-oil" },
    update: {},
    create: {
      id: "seed-laziz-oil",
      name: "Laziz Vegetable Oil",
      description: "Laziz branded vegetable oil, multiple pack sizes.",
      categoryId: vegetableOil.id,
      brandId: lazizOil.id,
    },
  });

  await prisma.productVariant.createMany({
    skipDuplicates: true,
    data: [
      {
        productId: lazizOilProduct.id,
        sku: "LZ-VO-1L-12",
        unitLabel: "1 Litre",
        unitsPerCarton: 12,
        cartonPrice: 45000,
        piecePrice: 4500,
        stockLevel: 35,
      },
      {
        productId: lazizOilProduct.id,
        sku: "LZ-VO-5L-4",
        unitLabel: "5 Litre",
        unitsPerCarton: 4,
        cartonPrice: 69000,
        piecePrice: 18000,
        stockLevel: 15,
      },
      {
        productId: lazizOilProduct.id,
        sku: "LZ-VO-45ML-80",
        unitLabel: "45 ml",
        unitsPerCarton: 80,
        cartonPrice: 12500,
        piecePrice: 200,
        stockLevel: 60,
      },
    ],
  });

  // Product + variants — Laziz Seasoning (Condiments)
  const lazizSeasoningChicken = await prisma.product.upsert({
    where: { id: "seed-laziz-seasoning-chicken" },
    update: {},
    create: {
      id: "seed-laziz-seasoning-chicken",
      name: "Laziz Chicken Seasoning",
      description: "Laziz chicken seasoning cubes, multiple pack sizes.",
      categoryId: condiments.id,
      brandId: lazizSeasoning.id,
    },
  });

  await prisma.productVariant.createMany({
    skipDuplicates: true,
    data: [
      {
        productId: lazizSeasoningChicken.id,
        sku: "LZ-SEAS-CHK-7-50",
        unitLabel: "7g x 50",
        unitsPerCarton: 50,
        cartonPrice: 4800,
        piecePrice: 100,
        stockLevel: 100,
      },
      {
        productId: lazizSeasoningChicken.id,
        sku: "LZ-SEAS-CHK-50-20",
        unitLabel: "50g x 20",
        unitsPerCarton: 20,
        cartonPrice: 13500,
        piecePrice: 750,
        stockLevel: 45,
      },
      {
        productId: lazizSeasoningChicken.id,
        sku: "LZ-SEAS-CHK-100-20",
        unitLabel: "100g x 20",
        unitsPerCarton: 20,
        cartonPrice: 28000,
        piecePrice: 1470,
        stockLevel: 25,
      },
    ],
  });

  logger.info("Seed complete.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    logger.error(e);
    logger.info("Disconnecting Prisma Client due to error.");
    await prisma.$disconnect();
    process.exit(1);
  });