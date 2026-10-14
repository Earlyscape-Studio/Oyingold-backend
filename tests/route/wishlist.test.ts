import { describe, it, expect, vi, beforeEach } from "vitest";
import { wishlist } from "@/routes/wishlist.js";
import { withMocks } from "../utils/with-mocks.js";

const mockPrisma = {
  user: { findUnique: vi.fn() },
  product: { findUnique: vi.fn() },
  wishlistItem: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
};

const mockSupabase = { auth: { getUser: vi.fn() } };

const authedUser = {
  id: "u1",
  supabaseId: "sb-1",
  email: "customer@example.com",
  role: "CUSTOMER",
};

function mockAsAuthedUser() {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: "sb-1", email: authedUser.email } },
    error: null,
  });
  mockPrisma.user.findUnique.mockResolvedValueOnce(authedUser);
}

function call(path: string, init: RequestInit = {}) {
  return withMocks(wishlist, { prisma: mockPrisma, supabase: mockSupabase }).request(
    path,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake-token",
        ...(init.headers ?? {}),
      },
    }
  );
}

beforeEach(() => vi.clearAllMocks());

describe("wishlist auth", () => {
  it("rejects requests without a token", async () => {
    const res = await withMocks(wishlist, {
      prisma: mockPrisma,
      supabase: mockSupabase,
    }).request("/");
    expect(res.status).toBe(401);
  });
});

describe("GET /wishlist", () => {
  it("returns the user's items with products, newest first", async () => {
    mockAsAuthedUser();
    mockPrisma.wishlistItem.findMany.mockResolvedValueOnce([
      { id: "w1", createdAt: new Date("2026-10-01"), product: { id: "p1", name: "Dano Milk" } },
    ]);

    const res = await call("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.wishlistItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1" },
        orderBy: { createdAt: "desc" },
      })
    );
    expect(body[0]).toMatchObject({ id: "w1", product: { id: "p1" } });
  });
});

describe("GET /wishlist/ids", () => {
  it("returns only product ids", async () => {
    mockAsAuthedUser();
    mockPrisma.wishlistItem.findMany.mockResolvedValueOnce([
      { productId: "p1" },
      { productId: "p2" },
    ]);

    const res = await call("/ids");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ productIds: ["p1", "p2"] });
  });
});

describe("POST /wishlist", () => {
  it("requires a productId", async () => {
    mockAsAuthedUser();
    const res = await call("/", { method: "POST", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it("rejects an unreadable body", async () => {
    mockAsAuthedUser();
    const res = await call("/", { method: "POST", body: "nope" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown product", async () => {
    mockAsAuthedUser();
    mockPrisma.product.findUnique.mockResolvedValueOnce(null);

    const res = await call("/", {
      method: "POST",
      body: JSON.stringify({ productId: "ghost" }),
    });

    expect(res.status).toBe(404);
    expect(mockPrisma.wishlistItem.upsert).not.toHaveBeenCalled();
  });

  it("upserts so adding twice is harmless", async () => {
    mockAsAuthedUser();
    mockPrisma.product.findUnique.mockResolvedValueOnce({ id: "p1" });
    mockPrisma.wishlistItem.upsert.mockResolvedValueOnce({});

    const res = await call("/", {
      method: "POST",
      body: JSON.stringify({ productId: "p1" }),
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.wishlistItem.upsert).toHaveBeenCalledWith({
      where: { userId_productId: { userId: "u1", productId: "p1" } },
      create: { userId: "u1", productId: "p1" },
      update: {},
    });
  });
});

describe("DELETE /wishlist/:productId", () => {
  it("only deletes the current user's row", async () => {
    mockAsAuthedUser();
    mockPrisma.wishlistItem.deleteMany.mockResolvedValueOnce({ count: 1 });

    const res = await call("/p1", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(mockPrisma.wishlistItem.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", productId: "p1" },
    });
  });
});