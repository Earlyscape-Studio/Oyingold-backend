import {Hono} from "hono"
import {prisma} from "@/lib/prisma.js"
import {requireAdmin} from "@/middlewares/require-admin.js"


export const products = new Hono();

//products search by category, brand or unique search query
products.get("/", async (c) => {
    const {category, brand, q} = c.req.query();


    const list = await prisma.product.findMany({
        where: {
            ...(category ? {category: {slug: category}} : {}),
            ...(brand ? {brand: {slug: brand}} : {}),
            ...(q ? {name: {contains: q, mode: "insensitive" as const}} : {})
        },
        include: {
            category: true,
            brand: true,
            variants: {
                orderBy: {
                    unitLabel: "asc"
                }
            }
        },
        orderBy: {name: "asc"}
    });

    return c.json(list);
})


//GET product:id - individual product
products.get("/:id", async (c) => {
    const id = c.req.param("id");

    const product = await prisma.product.findUnique({
        where: {id},
        include: {
            category: true,
            brand: true,
            variants: {
                orderBy: {
                    unitLabel: "asc"
                }
            }
        }
    });

    if (!product) {
        return c.json({error: "Product not found"}, 404);
    }


    return c.json(product);
})



//POST - create a new product
products.post("/", requireAdmin,  async (c) => {
    const body = await c.req.json();

    const {name, description, categoryId, brandId, variant} = body ?? {};



    if (!name || !categoryId || brandId){
        return c.json({
            error: "name, categoryId, and brandId are required"
        }, 400);
    }

    if(!variant || !variant.sku || !variant.unitLabel || !variant.cartonPrice){
        return c.json(
            {error: "variant.sku, variant.unitLabel and variant.cartonPrice are required"}, 400
        );
    }


    try {
        const created = await prisma.product.create({
            data: {
                name,
                description: description || null,
                categoryId,
                brandId,
                variants: {
                    create: {
                        sku: variant.sku,
                        unitLabel: variant.unitLabel,
                        unitsPerCarton: Number(variant.unitsPerCarton) || 1,
                        cartonPrice: variant.cartonPrice,
                        piecePrice: variant.piecePrice || null,
                        stockLevel: Number(variant.stockLevel) || 0,
                        lowStockThreshold: Number(variant.lowStockThreshold) || 10,
                    }
                }
            },
            include: {
                category: true,
                brands: true,
                variants: true
            }
        });


        return c.json(created, 201)
    }catch(err: any) {
        if(err?.code === "P2002"){
            return c.json({error: "A variant with that SKU already exists"}, 409);
        }
        throw err;
    }
})