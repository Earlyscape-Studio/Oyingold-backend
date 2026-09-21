import { Hono } from "hono"
import type {AppEnv} from "@/types/hono.js";
// import { prisma } from "@/lib/prisma.js"

export const health = new Hono<AppEnv>().get("/", async (c) => {
  const prisma = c.get("prisma");
  try{
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: "ok", database: "connected" });
  }catch{
    return c.json({ status: "error", database: "unreachable"}, 503);
  }
});
