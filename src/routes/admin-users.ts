import { Hono } from "hono";
import { requireAdmin } from "@/middlewares/require-admin.js";
import type { AppEnv } from "@/types/hono.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const adminUsers = new Hono<AppEnv>()
  .get("/", requireAdmin, async (c) => {
    const prisma = c.get("prisma");

    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    return c.json(admins);
  })
  .post("/", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const supabase = c.get("supabase");
    const body = await c.req.json().catch(() => null);

    const email = body?.email?.trim().toLowerCase();

    if (!email || !EMAIL_RE.test(email)) {
      return c.json({ error: "A valid email is required" }, 400);
    }


    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      if (existing.role === "ADMIN") {
        return c.json(
          { error: "This email is already an admin" },
          409
        );
      }

      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN" },
        select: { id: true, email: true, createdAt: true },
      });

      return c.json(updated, 200);
    }

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email);

    if (error || !data?.user?.id) {
      return c.json(
        { error: error?.message ?? "Failed to invite this email" },
        400
      );
    }

    try {
      const created = await prisma.user.create({
        data: {
          supabaseId: data.user.id,
          email,
          role: "ADMIN",
        },
        select: { id: true, email: true, createdAt: true },
      });

      return c.json(created, 201);
    } catch (err: any) {
      if (err?.code === "P2002") {
        return c.json(
          { error: "This email is already registered" },
          409
        );
      }
      throw err;
    }
  });