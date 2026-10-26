import { describe, it, expect, vi, beforeEach } from "vitest";
import { orders } from "@/routes/orders.js";
import { withMocks } from "../utils/with-mocks.js";

const mockPrisma = {
  user: { findUnique: vi.fn() },
  order: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
};
const mockSupabase = { auth: { getUser: vi.fn() } };

function mockAsAdmin() {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: "admin-id", email: "admin@example.com" } },
    error: null,
  } as any);
  mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "u2", supabaseId: "admin-id", role: "ADMIN" });
}

function call(path: string, init: RequestInit = {}) {
  return withMocks(orders, { prisma: mockPrisma, supabase: mockSupabase }).request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-token",
      ...(init.headers ?? {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /orders", () => {
  it("lists everything by default", async () => {
    mockAsAdmin();
    mockPrisma.order.findMany.mockResolvedValueOnce([]);

    const res = await call("/");

    expect(res.status).toBe(200);
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it("filters to orders that need attention", async () => {
    mockAsAdmin();
    mockPrisma.order.findMany.mockResolvedValueOnce([{ id: "o1", needsAttention: true }]);

    const res = await call("/?needsAttention=true");

    expect(res.status).toBe(200);
    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { needsAttention: true } })
    );
  });

  it("combines the attention filter with a status filter", async () => {
    mockAsAdmin();
    mockPrisma.order.findMany.mockResolvedValueOnce([]);

    await call("/?status=UNFULFILLED&needsAttention=true");

    expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "UNFULFILLED", needsAttention: true } })
    );
  });

  it("rejects any other needsAttention value", async () => {
    mockAsAdmin();
    const res = await call("/?needsAttention=false");
    expect(res.status).toBe(400);
    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
  });

  it("is admin only", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: "cust-id" } },
      error: null,
    } as any);
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "u1", role: "CUSTOMER" });

    const res = await call("/?needsAttention=true");

    expect(res.status).toBe(403);
    expect(mockPrisma.order.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /orders/:id", () => {
  it("includes the payment attempts so a flagged order can be traced", async () => {
    mockAsAdmin();
    mockPrisma.order.findUnique.mockResolvedValueOnce({ id: "o1", payments: [] });

    const res = await call("/o1");

    expect(res.status).toBe(200);
    const args = mockPrisma.order.findUnique.mock.calls[0][0];
    expect(args.include.payments.orderBy).toEqual({ createdAt: "desc" });
    expect(args.include.payments.select).toMatchObject({ reference: true, status: true, gatewayCode: true });
    // Raw gateway payloads stay out of the response.
    expect(args.include.payments.select.rawResponse).toBeUndefined();
  });
});

describe("PATCH /orders/:id/attention", () => {
  it("clears the flag and the reason", async () => {
    mockAsAdmin();
    mockPrisma.order.update.mockResolvedValueOnce({
      id: "o1",
      needsAttention: false,
      needsAttentionReason: null,
    });

    const res = await call("/o1/attention", { method: "PATCH" });

    expect(res.status).toBe(200);
    expect(mockPrisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "o1" },
        data: { needsAttention: false, needsAttentionReason: null },
      })
    );
    expect((await res.json()).needsAttention).toBe(false);
  });

  it("404s for an unknown order", async () => {
    mockAsAdmin();
    mockPrisma.order.update.mockRejectedValueOnce({ code: "P2025" });

    const res = await call("/missing/attention", { method: "PATCH" });

    expect(res.status).toBe(404);
  });
});