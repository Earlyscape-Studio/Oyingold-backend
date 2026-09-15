import {Hono} from "hono"
import {prisma} from "@/lib/prisma.js"
import {requireAdmin} from "@/middlewares/require-admin.js"


export const products = new Hono()
    //products search by category, brand or unique search query
    .get("/", async (c) => {
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
    .get("/:id", async (c) => {
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
    .post("/", requireAdmin,  async (c) => {
        const body = await c.req.json();
       
        const {name, description, categoryId, brandId, images, variant} = body ?? {};



        if (!name || !categoryId || !brandId){
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
                    images: Array.isArray(images) ? images : [],
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
                    brand: true,
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
    .patch("/:id", requireAdmin, async (c) => {
        const id = c.req.param("id");
        const body = await c.req.json();

        const {name, description, categoryId, brandId, images, isFeatured} = body ?? {};

        const data: Record<string, unknown> = {}
        if(name !== "undefined") data.name = name;
        if(description !== "undefined") data.description = description || null;
        if(categoryId !== "undefined") data.categoryId = categoryId;
        if(brandId !== "undefined") data.brandId = brandId;
        if(images !== "undefined") data.images = images;
        if(isFeatured !== "undefined") data.isFeatured = isFeatured;

        if(Object.keys(data).length === 0){
            return c.json({
                error: "No valid fields provided to update"
            }, 400);
        }

        try{
            const updated = await prisma.product.update({
                where: {id},
                data,
                include: {
                    category: true,
                    brand: true,
                    variants: true
                }
            })

            return c.json(updated);
        }catch(err: any){
            if(err?.code === "P2025"){
                return c.json({error: "Product not found"}, 404);
            }

            if(err?.code === "P2003"){
                return c.json({error: "categoryId or brandId does not exist"}, 400);
            }
            
            throw err;
        }
    })
    .delete("/:id", requireAdmin, async (c) => {
        const id = c.req.param("id");

        const product = await prisma.product.findUnique({
            where: {id},
            include: {
                variants: {
                    include: {
                        _count: {
                            select: {
                                orderItems: true
                            }
                        }
                    }
                }
            }
        })

        if (!product){
            return c.json({error: "Product not found"}, 404);
        }

        const hasOrderHistory = product.variants.some(v => v._count.orderItems > 0);

        if(hasOrderHistory){
            return c.json({
                error: "Cannot delete a product with variants that appear in existing orders. Consider removing it from view instead (e.g unfeaturing or zeroing stock)."
            }, 409);
        }

        await prisma.$transaction([
            prisma.productVariant.deleteMany({where: {productId: id}}),
            prisma.product.delete({where: {id}})
        ]);

        return c.json({success: true});
    })
    .patch("/:id/variants/:variantId", requireAdmin, async (c) => {
        const {id, variantId} = c.req.param();
        const body = await c.req.json();


        const {sku, unitLabel, unitPerCarton, cartonPrice, piecePrice, stockLevel, lowStockThreshold} = body ?? {};

        const data: Record<string, unknown> = {};

        if(sku !== "undefined") data.sku = sku;
        if(unitLabel !== "undefined") data.unitLabel = unitLabel;
        if(unitPerCarton !== "undefined") data.unitPerCarton = Number(unitPerCarton);
        if(cartonPrice !== "undefined") data.cartonPrice = cartonPrice;
        if(piecePrice !== "undefined") data.piecePrice = piecePrice === null ? null : piecePrice;
        if(stockLevel !== "undefined") data.stockLevel = Number(stockLevel);
        if(lowStockThreshold !== "undefined") data.lowStockThreshold = Number(lowStockThreshold);



        if(Object.keys(data).length === 0){
            return c.json({
                error: "No valid fields provided to update"
            }, 400);
        }

        try{
            const updated = await prisma.productVariant.update({
                where: {
                    id: variantId, 
                    productId: id
                },
                data
            })

            return c.json(updated);
        }catch(err: any){
            if(err?.code === "P2025"){
                return c.json({error: "Variant not found for this product"}, 404);
            }
            
            if(err?.code === "P2002"){
                return c.json({error: "A variant with that SKU already exists"}, 409);
            }

            throw err;
        }

    })
    .delete("/:id/variants/:variantId", requireAdmin, async (c) => {
        const {id, variantId} = c.req.param();

        const variant = await prisma.productVariant.findUnique({
            where: {
                id: variantId,
                productId: id
            },
            include: {
                _count: {
                    select: {
                        orderItems: true
                    }
                }
            }
        })
        
        if(!variant){
            return c.json({error: "Variant for this product not found"}, 404);
        }

        if(variant._count.orderItems > 0){
            return c.json({
                error: "Cannot delete variant that appears in existing orders. Consider zeroing its stock instead."
            }, 409);
        }

        await prisma.productVariant.delete({where: {id: variantId}});

        return c.json({success: true});
    })