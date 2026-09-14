import {Hono} from "hono";
import {requireAuth} from "@/middlewares/require-auth.js";
import type {AppEnv} from "@/types/hono.js";


export const me = new Hono<AppEnv>()
    .get("/", requireAuth, async (c) => {
        const user = c.get("user");
        
        return c.json({
            id: user.id,
            email: user.email,
            role: user.role
        })
    })
