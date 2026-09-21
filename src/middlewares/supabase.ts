import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/types/hono.js";

export const supabaseMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const {SUPABASE_URL, SUPABASE_SECRET_KEY} = c.env;


    if(!SUPABASE_URL || !SUPABASE_SECRET_KEY){
        return c.json({error: "Supabase is not configured"}, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: { autoRefreshToken: false, persistSession: false},
    });

    c.set("supabase", supabase);


    await next();
});