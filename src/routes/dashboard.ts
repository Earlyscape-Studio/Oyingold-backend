import {Hono} from "hono";
// import {prisma} from "@/lib/prisma.js";
import type {AppEnv} from "@/types/hono.js";
import { OrderStatus } from "@/generated/prisma/client.js";
import {requireAdmin} from "@/middlewares/require-admin.js";



const UNPAID_STATUSES: OrderStatus[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELLED];

export const dashboard = new Hono<AppEnv>()
    .get("/stats", requireAdmin, async (c) => {
        const prisma = c.get("prisma");
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
        const [
            todayOrders,
            monthOrders,
            recentOrders,
            lowStockVariants
        ] = await Promise.all([
            prisma.order.findMany({
                where: {
                    createdAt: {gte: startOfToday},
                    status: {notIn: UNPAID_STATUSES}
                },
                select: {totalAmount: true}
            }),
            prisma.order.findMany({
                where: {
                    createdAt: {gte: startOfMonth},
                    status: {notIn: UNPAID_STATUSES}
                },
                select: {totalAmount: true}
            }),
            prisma.order.findMany({
                take: 5,
                orderBy: {createdAt: "desc"},
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true
                        }
                    }
                }
            }),
            prisma.$queryRaw<Array<{
                id: string,
                sku: string,
                unitLabel: string,
                stockLevel: number,
                lowStockThreshold: number,
                productName: string
            }>>`
             SELECT pv.id, pv.sku, pv."unitLabel", pv."stockLevel", pv."lowStockThreshold", p.name as "productName"
             FROM "ProductVariant" pv
             JOIN "Product" p ON p.id = pv."productId"
             WHERE pv."stockLevel" <= pv."lowStockThreshold"
             ORDER BY pv."stockLevel" ASC
            `
        ]);

        const sumSales = (rows: {totalAmount: any}[]) => rows.reduce((sum, o) => sum + Number(o.totalAmount), 0);


        const todaySales = sumSales(todayOrders);
        const monthSales = sumSales(monthOrders);


        return c.json({
            sales: {
                today: todaySales,
                month: monthSales,
                todayOrderCount: todayOrders.length,
                monthOrderCount: monthOrders.length,
                averageOrderValueMonth: monthOrders.length > 0 ? monthSales / monthOrders.length : 0
            },
            recentOrders,
            lowStockVariants,
            note: "conversionRate, siteTraffic and recentReviews are not yet available - no analytics source or review model exists in the schema."
        });

    })