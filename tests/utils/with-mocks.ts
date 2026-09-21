import { Hono } from "hono";
import type {AppEnv} from "@/types/hono.js";


export function withMocks<T extends Hono<any, any, any>>(
    route: T,
    mocks: {prisma?: any; supabase?: any}
){
    const app = new Hono<AppEnv>();

    app.use("*", async (c, next) => {
        if (mocks.prisma) c.set("prisma", mocks.prisma);
        if (mocks.supabase) c.set("supabase", mocks.supabase);
        await next();
    });

    app.route("/", route);

    return app as unknown as T;
  
}