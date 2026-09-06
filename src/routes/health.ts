import { Hono } from "hono"
import { prisma } from "@/lib/prisma.js"

export const health = new Hono()

health.get("/", async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return c.json({ status: "ok", database: "connected" })
  } catch {
    return c.json({ status: "error", database: "unreachable" }, 503)
  }
})