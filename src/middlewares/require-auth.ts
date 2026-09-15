import type {Context, Next} from "hono";
import {supabaseAdmin} from "@/lib/supabase.js";
import {prisma} from "@/lib/prisma.js";
import type {AppEnv} from "@/types/hono.js";


export async function requireAuth(c: Context<AppEnv>, next: Next){

    const authHeader = c.req.header("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

    if(!token){
        return c.json({error: "Missing Authorization Header"}, 401)
    }

    const {data, error} = await supabaseAdmin.auth.getUser(token);


    if(error || !data?.user?.id){
        return c.json({error: "Invalid or expired session"}, 401)
    }

    const user = await prisma.user.findUnique({
        where: {supabaseId: data.user.id}
    })

    if(!user){
        return c.json({error: "No account found for this session"}, 401);
    }

    c.set("user", user);

    await next();
}