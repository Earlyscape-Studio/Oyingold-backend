import { describe, it, expect, vi, beforeEach } from "vitest";
import { testClient } from "hono/testing";
import { adminUsers } from "@/routes/admin-users.js";
import { withMocks } from "../utils/with-mocks.js";

const mockPrisma = {
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
};

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
    admin: {
      createUser: vi.fn(),
    },
  },
};

const adminSession = {
  id: "u2",
  supabaseId: "admin-id",
  role: "ADMIN",
};

function client() {
  return testClient(
    withMocks(adminUsers, { prisma: mockPrisma, supabase: mockSupabase })
  );
}

function authedRequest(path: string, init: RequestInit = {}) {
  return withMocks(adminUsers, {
    prisma: mockPrisma,
    supabase: mockSupabase,
  }).request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-token",
      ...(init.headers ?? {}),
    },
  });
}

function mockAsAdmin() {
  mockSupabase.auth.getUser.mockResolvedValueOnce({
    data: { user: { id: "admin-id", email: "admin@oyingold.com" } },
    error: null,
  } as any);

  mockPrisma.user.findUnique.mockResolvedValueOnce(adminSession as any);
}

describe("GET /admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests with no Authorization header", async () => {
    const res = await client().index.$get();
    expect(res.status).toBe(401);
  });

  it("returns the list of admins for an authenticated admin", async () => {
    mockAsAdmin();

    mockPrisma.user.findMany.mockResolvedValueOnce([
      { id: "u2", email: "admin@oyingold.com", createdAt: "2026-01-01T00:00:00.000Z" },
    ] as any);

    const res = await authedRequest("/", { method: "GET" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "u2", email: "admin@oyingold.com", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: "ADMIN" } })
    );
  });
});

describe("POST /admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests with no Authorization header", async () => {
    const res = await withMocks(adminUsers, {
      prisma: mockPrisma,
      supabase: mockSupabase,
    }).request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new-admin@example.com" }),
    });

    expect(res.status).toBe(401);
  });

  it("rejects non-admin users", async () => {
    mockSupabase.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: "non-admin-id", email: "not-admin@example.com" } },
      error: null,
    } as any);

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "u1",
      supabaseId: "non-admin-id",
      role: "CUSTOMER",
    } as any);

    const res = await authedRequest("/", {
      method: "POST",
      body: JSON.stringify({ email: "new-admin@example.com" }),
    });

    expect(res.status).toBe(403);
  });

  it("rejects a missing or malformed email", async () => {
    mockAsAdmin();

    const res = await authedRequest("/", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email" }),
    });

    expect(res.status).toBe(400);
  });

  it("promotes an existing user to ADMIN without calling Supabase invite", async () => {
    mockAsAdmin();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "existing-1",
      email: "customer@example.com",
      role: "CUSTOMER",
    } as any);

    mockPrisma.user.update.mockResolvedValueOnce({
      id: "existing-1",
      email: "customer@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
    } as any);

    const res = await authedRequest("/", {
      method: "POST",
      body: JSON.stringify({ email: "customer@example.com" }),
    });

    expect(res.status).toBe(200);
    expect(mockSupabase.auth.admin.createUser).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-1" },
        data: { role: "ADMIN" },
      })
    );
  });

  it("rejects when the email is already an admin", async () => {
    mockAsAdmin();

    mockPrisma.user.findUnique.mockResolvedValueOnce({
      id: "existing-2",
      email: "already-admin@example.com",
      role: "ADMIN",
    } as any);

    const res = await authedRequest("/", {
      method: "POST",
      body: JSON.stringify({ email: "already-admin@example.com" }),
    });

    expect(res.status).toBe(409);
  });

  it("invites a brand new email via Supabase and creates the Prisma row as ADMIN", async () => {
    mockAsAdmin();

    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    mockSupabase.auth.admin.createUser.mockResolvedValueOnce({
      data: { user: { id: "new-supabase-id" } },
      error: null,
    } as any);

    mockPrisma.user.create.mockResolvedValueOnce({
      id: "new-1",
      email: "brandnew@example.com",
      createdAt: "2026-01-01T00:00:00.000Z",
    } as any);

    const res = await authedRequest("/", {
      method: "POST",
      body: JSON.stringify({ email: "brandnew@example.com" }),
    });

    expect(res.status).toBe(201);
    expect(mockSupabase.auth.admin.createUser).toHaveBeenCalledWith({
      email: "brandnew@example.com",
      email_confirm: true,
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          supabaseId: "new-supabase-id",
          email: "brandnew@example.com",
          role: "ADMIN",
        },
      })
    );
  });

  it("returns an error when Supabase invite fails", async () => {
    mockAsAdmin();

    mockPrisma.user.findUnique.mockResolvedValueOnce(null);

    mockSupabase.auth.admin.createUser.mockResolvedValueOnce({
      data: null,
      error: { message: "Email rate limit exceeded" },
    } as any);

    const res = await authedRequest("/", {
      method: "POST",
      body: JSON.stringify({ email: "brandnew@example.com" }),
    });

    expect(res.status).toBe(400);
  });
});