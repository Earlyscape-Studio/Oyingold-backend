import { describe, it, expect, vi, beforeEach } from "vitest";
import { testClient } from "hono/testing";
import { products } from "@/routes/products.js";

vi.mock("@/lib/prisma.js", () => ({
  prisma: {
    product: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/supabase.js", () => ({
  supabaseAdmin: {
    auth: {
      getUser: vi.fn(),
    },
  },
}));

const fakeProduct = {
  id: "p1",
  name: "Gold Wealth Edible Oil",
  description: null,
  images: [],
  isFeatured: false,
  category: {
    id: "c1",
    name: "Vegetable Oil",
    slug: "vegetable-oil",
  },
  brand: {
    id: "b1",
    name: "Goldwealth",
    slug: "goldwealth",
  },
  variants: [],
};

describe("GET /products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the full list with no filters", async () => {
    const { prisma } = await import("@/lib/prisma.js");
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      fakeProduct,
    ] as any);

    const client = testClient(products);
    const res = await client.index.$get({ query: {} });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([fakeProduct]);
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it("filters category by slug when provided", async () => {
    const { prisma } = await import("@/lib/prisma.js");
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
      fakeProduct,
    ] as any);

    const client = testClient(products);
    await client.index.$get({ query: { category: "vegetable-oil" } });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          category: {
            slug: "vegetable-oil",
          },
        },
      })
    );
  });

  it("filters by search query case-insensitively", async () => {
    const { prisma } = await import("@/lib/prisma.js");
    vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);

    const client = testClient(products);
    await client.index.$get({ query: { q: "oil" } });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: {
            contains: "oil",
            mode: "insensitive",
          },
        },
      })
    );
  });
});

describe("GET /products/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the product when found", async () => {
    const { prisma } = await import("@/lib/prisma.js");
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(
      fakeProduct as any
    );

    const client = testClient(products);
    const res = await client[":id"].$get({ param: { id: "p1" } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeProduct);
  });

  it("returns 404 when the product doesn't exist", async () => {
    const { prisma } = await import("@/lib/prisma.js");
    vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);

    const client = testClient(products);
    const res = await client[":id"].$get({ param: { id: "missing" } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Product not found" });
  });
});

describe("POST /products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validBody = {
    name: "New Product",
    categoryId: "c1",
    brandId: "b1",
    variant: {
      sku: "SKU-1",
      unitLabel: "1L",
      cartonPrice: "37000",
    },
  };

  it("rejects requests with no Authorization header", async () => {
    const res = await products.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    const { supabaseAdmin } = await import("@/lib/supabase.js");
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: { email: "not-admin@example.com" } },
      error: null,
    } as any);

    const res = await products.request("/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-token",
      },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(403);
  });

  it("rejects a request missing required fields", async () => {
    const { supabaseAdmin } = await import("@/lib/supabase.js");
    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: { email: "admin@oyingold.com" } },
      error: null,
    } as any);
    process.env.ADMIN_EMAILS = "admin@oyingold.com";

    const res = await products.request("/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-token",
      },
      body: JSON.stringify({ name: "Missing Fields" }),
    });

    expect(res.status).toBe(400);
  });

  it("creates a product for a valid admin request", async () => {
    const { supabaseAdmin } = await import("@/lib/supabase.js");
    const { prisma } = await import("@/lib/prisma.js");

    vi.mocked(supabaseAdmin.auth.getUser).mockResolvedValueOnce({
      data: { user: { email: "admin@oyingold.com" } },
      error: null,
    } as any);
    process.env.ADMIN_EMAILS = "admin@oyingold.com";
    vi.mocked(prisma.product.create).mockResolvedValueOnce(fakeProduct as any);

    const res = await products.request("/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-token",
      },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(fakeProduct);
  });
});
