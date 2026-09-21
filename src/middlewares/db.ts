import {Pool} from "pg";
import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient} from "@/generated/prisma/client.js";
import {createMiddleware} from "hono/factory";
import type {AppEnv} from "@/types/hono.js";



export const dbMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const pool = new Pool({
        connectionString: c.env.HYPERDRIVE.connectionString,
        max: 1
    });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });


    c.set("prisma", prisma);

    await next();

    // c.executionCtx.waitUntil(pool.end());
    await pool.end();
});