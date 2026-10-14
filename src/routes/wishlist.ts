import {Hono} from "hono";
import {requireAuth} from "@/middlewares/require-auth.js";
import type {AppEnv} from "@/types/hono.js";


const PRODUCT_INCLUDE = {
    category: true,
    brand: true,
    variants: {
        orderBy: {
            unitLabel: "asc" as const
        }
    }
}



export const wishlist = new Hono<AppEnv>()
    .get("/", requireAuth, async (c) => {
        const prisma = c.get("prisma");
        const user = c.get("user");


        const items = await prisma.wishlistItem.findMany({
            where: {userId: user.id},
            include:{product: {include: PRODUCT_INCLUDE}},
            orderBy: {createdAt: "desc"}
        });

        return c.json(
            items.map((item) => ({
                id: item.id,
                addedAt: item.createdAt,
                product: item.product
            }))
        );
    })
    

    .get("/ids", requireAuth, async (c) => {
        const prisma = c.get("prisma");
        const user = c.get("user");

        const items = await prisma.wishlistItem.findMany({
            where: {userId: user.id},
            select: {productId: true},
            orderBy: {createdAt: "desc"}
        })


        return c.json({
            productIds: items.map((i) => i.productId)
        })

    })



    .post("/", requireAuth, async (c) => {
        const prisma = c.get("prisma");
        const user = c.get("user")
        const body = await c.req.json().catch(() => null);
        

        const productId = body?.productId;

        if(typeof productId !== "string" || !productId){
            return c.json({error: "productId is required"}, 400);
        }

        const product = await prisma.product.findUnique({
            where: {id: productId},
            select: {id: true}
        })


        if(!product){
            return c.json({error: "Product not found"}, 404);
        }


        await prisma.wishlistItem.upsert({
            where: {
                userId_productId: {userId: user.id, productId}
            },
            create: {userId: user.id, productId},
            update: {}
        });


        return c.json({productId}, 201)
    })


    
    .delete("/:productId", requireAuth, async (c) => {
        const prisma = c.get("prisma");
        const user = c.get("user");
        const productId = c.req.param("productId");

        await prisma.wishlistItem.deleteMany({
            where: {userId: user.id, productId}
        })


        return c.json({productId});
    })