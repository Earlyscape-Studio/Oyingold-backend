import { describe, it, expect, vi, beforeEach } from "vitest";
import { me } from "@/routes/me.js";
import { withMocks } from "../utils/with-mocks.js";

const mockPrisma = {
  user: { findUnique: vi.fn(), update: vi.fn() },
  order: { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  address: { findMany: vi.fn() },
};

const mockSupabase = { auth: { getUser: vi.fn() } };

const authedUser = {
  id: "u1",
  supabaseId: "sb-1",
  email: "customer@example.com",
  role: "CUSTOMER",
  fullName: "Ada Obi",
  phone: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
};

function mockAsAuthedUser() {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: "sb-1", email: authedUser.email } },
    error: null,
  });
  mockPrisma.user.findUnique.mockResolvedValueOnce(authedUser);
}

function call(path: string, init: RequestInit = {}) {
  return withMocks(me, { prisma: mockPrisma, supabase: mockSupabase }).request(
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

const orderRow = {
  id: "o1",
  orderNumber: 42,
  status: "UNFULFILLED",
  totalAmount: "7000.00",
  trackingNumber: null,
  shippingAddress: null,
  createdAt: new Date("2026-07-06T00:00:00Z"),
  items: [
    {
      id: "i1",
      pricingType: "piece",
      unitPrice: "3500.00",
      quantity: 2,
      productVariant: {
        unitLabel: "70g x 40",
        product: { id: "p1", name: "Indomie Noodle - Jollof Flavor", images: ["a.jpg"] },
      },
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("GET /me", () => {
  it("rejects requests without a token", async () => {
    const res = await withMocks(me, { prisma: mockPrisma, supabase: mockSupabase }).request("/");
    expect(res.status).toBe(401);
  });

  it("returns profile with member since and total orders", async () => {
    mockAsAuthedUser();
    mockPrisma.order.count.mockResolvedValueOnce(25);

    const res = await call("/");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      email: "customer@example.com",
      fullName: "Ada Obi",
      totalOrders: 25,
    });
    expect(body.memberSince).toBeDefined();
  });
});

describe("PATCH /me", () => {
  it("rejects an empty update", async () => {
    mockAsAuthedUser();
    const res = await call("/", { method: "PATCH", body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  it("rejects non-string values", async () => {
    mockAsAuthedUser();
    const res = await call("/", { method: "PATCH", body: JSON.stringify({ fullName: 5 }) });
    expect(res.status).toBe(400);
  });

  it("trims and saves valid fields", async () => {
    mockAsAuthedUser();
    mockPrisma.user.update.mockResolvedValueOnce({ ...authedUser, fullName: "Ada N", phone: "0812" });

    const res = await call("/", {
      method: "PATCH",
      body: JSON.stringify({ fullName: "  Ada N ", phone: "0812" }),
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { fullName: "Ada N", phone: "0812" },
    });
  });
});

describe("GET /me/orders", () => {
  it("scopes to the user, paginates and maps status to tracker step", async () => {
    mockAsAuthedUser();
    mockPrisma.order.count.mockResolvedValueOnce(25);
    mockPrisma.order.findMany.mockResolvedValueOnce([orderRow]);

    const res = await call("/orders?page=2&limit=10");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" }, skip: 10, take: 10 })
    );
    expect(body).toMatchObject({ page: 2, limit: 10, total: 25, totalPages: 3 });
    expect(body.data[0]).toMatchObject({
      reference: "OG-000042",
      step: 2,
      total: 7000,
    });
    expect(body.data[0].items[0]).toMatchObject({
      name: "Indomie Noodle - Jollof Flavor",
      image: "a.jpg",
      unitPrice: 3500,
      quantity: 2,
    });
  });

  it("caps the page size and returns an empty list cleanly", async () => {
    mockAsAuthedUser();
    mockPrisma.order.count.mockResolvedValueOnce(0);
    mockPrisma.order.findMany.mockResolvedValueOnce([]);

    const res = await call("/orders?limit=9999");
    const body = await res.json();

    expect(body).toMatchObject({ data: [], total: 0, limit: 50, totalPages: 1 });
  });

  it("gives cancelled orders no tracker step", async () => {
    mockAsAuthedUser();
    mockPrisma.order.count.mockResolvedValueOnce(1);
    mockPrisma.order.findMany.mockResolvedValueOnce([{ ...orderRow, status: "CANCELLED" }]);

    const body = await (await call("/orders")).json();
    expect(body.data[0].step).toBeNull();
  });
});

describe("GET /me/orders/:id", () => {
  it("returns 404 for an order the user does not own", async () => {
    mockAsAuthedUser();
    mockPrisma.order.findFirst.mockResolvedValueOnce(null);

    const res = await call("/orders/someone-elses");

    expect(res.status).toBe(404);
    expect(mockPrisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses", userId: "u1" } })
    );
  });

  it("returns the order when owned", async () => {
    mockAsAuthedUser();
    mockPrisma.order.findFirst.mockResolvedValueOnce(orderRow);

    const res = await call("/orders/o1");
    expect(res.status).toBe(200);
    expect((await res.json()).reference).toBe("OG-000042");
  });
});

describe("GET /me/addresses", () => {
  it("flags the most recently used address", async () => {
    mockAsAuthedUser();
    mockPrisma.address.findMany.mockResolvedValueOnce([
      { id: "a1", fullName: "Ada", phone: "1", street: "s", city: "c", state: "Lagos", country: "Nigeria", isDefault: true, lastUsedAt: new Date() },
      { id: "a2", fullName: "Ada", phone: "1", street: "s2", city: "c", state: "Lagos", country: "Nigeria", isDefault: false, lastUsedAt: null },
    ]);

    const body = await (await call("/addresses")).json();

    expect(body[0].isLastUsed).toBe(true);
    expect(body[1].isLastUsed).toBe(false);
  });
});