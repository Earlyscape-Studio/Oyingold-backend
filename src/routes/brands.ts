import {Hono} from "hono"
import {prisma} from "@/lib/prisma.js"

export const brands = new Hono()
    .get("/", async (c) => {
        const list = await prisma.brand.findMany({
            orderBy: {name: "asc"}
        })

        return c.json(list)
    })