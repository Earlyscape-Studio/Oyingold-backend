import type {Context, Next} from "hono";
// import {supabaseAdmin} from "@/lib/supabase.js";
// import {prisma} from "@/lib/prisma.js";
import type {AppEnv} from "@/types/hono.js";


export async function requireAuth(c: Context<AppEnv>, next: Next){

    const authHeader = c.req.header("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

    if(!token){
        return c.json({error: "Missing Authorization Header"}, 401)
    }

    const supabase = c.get("supabase");
    const prisma = c.get("prisma");



    const {data, error} = await supabase.auth.getUser(token);


    if(error || !data?.user?.id){
        return c.json({error: "Invalid or expired session"}, 401)
    }

    const supabaseUser = data.user;

    let user = await prisma.user.findUnique({
        where: {supabaseId: supabaseUser.id},
    });

    if(!user){
        if(!supabaseUser.email){
            return c.json({error: "Account has no email on file"}, 401);
        }

        try{
            user = await prisma.user.create({
                data: {
                    supabaseId: supabaseUser.id,
                    email: supabaseUser.email
                }
            });
        }catch(createError){
            user = await prisma.user.findUnique({
                where: {
                    supabaseId: supabaseUser.id
                }
            });

            if(!user){
                throw createError;
            }
        }
    }

    c.set("user", user);

    await next();
}