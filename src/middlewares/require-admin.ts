import type {Context, Next} from "hono"
import {supabaseAdmin} from "@/lib/supabase.js";
import type {AppEnv} from "@/types/hono.js"
import {prisma} from "@/lib/prisma.js";



export async function requireAdmin (c: Context<AppEnv>, next: Next) {
    const authHeader = c.req.header("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") 
    ? authHeader.slice("Bearer ".length)
    :
    null;


    if (!token){
        return c.json({error: "Missing Authorization header"}, 401)
    }

    const {data, error} = await supabaseAdmin.auth.getUser(token)

    if(error || !data?.user?.id){
        return c.json({error: "Invalid or expired session"}, 401)
    }
    
    const user = await prisma.user.findUnique({
        where: {supabaseId: data.user.id}
    })

    // const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)

    if(!user || user.role !== "ADMIN"){
        return c.json({error: "Unauthorized as admin"}, 403)
    } 

    // if(!adminEmails.includes(data.user.email.toLowerCase())){
    //     return c.json({error: "Unauthorized as admin"}, 403)
    // }

    c.set("user", user)
    
    await next()
}

