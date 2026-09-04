import {Hono} from "hono"
import {prisma} from "@/lib/prisma.js"

export const categories = new Hono();


categories.get("/", async (c) => {
    const list = await prisma.category.findMany({
        orderBy: {name: "asc"}
    })

    return c.json(list)
})