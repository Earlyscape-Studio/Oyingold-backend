import { Hono } from "hono";
// import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/middlewares/require-admin.js";
import type {AppEnv} from "@/types/hono.js";

export const brands = new Hono<AppEnv>()
  .get("/", async (c) => {
    const prisma = c.get("prisma");
    const list = await prisma.brand.findMany({
      orderBy: { name: "asc" },
    });

    return c.json(list);
  })
  .post("/", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const body = await c.req.json();

    const { name, slug } = body ?? {};

    if (!name || !slug) {
      return c.json(
        {
          error: "name and slug are required",
        },
        400
      );
    }

    try {
      const created = await prisma.brand.create({
        data: {
          name,
          slug,
        },
      });
      return c.json(created, 201);
    } catch (err: any) {
      if (err?.code === "P2002") {
        return c.json(
          { error: "A brand with this name or slug already exists" },
          400
        );
      }
      throw err;
    }
  })
  .patch("/:id", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const id = c.req.param("id");
    const body = await c.req.json();

    const { name, slug } = body ?? {};

    if (!name && !slug) {
      return c.json(
        {
          error: "name and slug are required",
        },
        400
      );
    }

    const data: Record<string, unknown> = {};
    if (name !== "undefined") data.name = name;
    if (slug !== "undefined") data.slug = slug;

    try {
      const updated = await prisma.brand.update({
        where: { id },
        data,
      });
      return c.json(updated);
    } catch (err: any) {
      if (err?.code === "P2002") {
        return c.json(
          { error: "A brand with this name or slug already exists" },
          400
        );
      }

      if (err?.code === "P2025") {
        return c.json({ error: "Brand not found" }, 404);
      }
      throw err;
    }
  })
  .delete("/:id", requireAdmin, async (c) => {
    const prisma = c.get("prisma");
    const id = c.req.param("id");

    // const body = await c.req.json();

    const brand = await prisma.brand.findUnique({
        where: {id},
        include: {
            _count: {
                select: {
                    products: true
                }
            }
        }
    })

    if(!brand){
        return c.json({error: "Brand not found"}, 404);
    }

    if(brand._count.products > 0){
        return c.json({
            error: "Cannot delete brand with products assigned to it. Reassign those products first."
        }, 409);
    }

    await prisma.brand.delete({
      where: { id },
    });
    
    return c.json({success: true});
  });
