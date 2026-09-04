import type {Context, Next} from "hono"
import {supabaseAdmin} from "@/lib/supabase.js"


const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)


export async function requireAdmin (c: Context, next: Next) {
    const authHeader = c.req.header("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") 
    ? authHeader.slice("Bearer ".length)
    :
    null;


    if (!token){
        return c.json({error: "Missing Authorization header"}, 401)
    }

    const {data, error} = await supabaseAdmin.auth.getUser(token)

    if(error || !data?.user?.email){
        return c.json({error: "Invalid or expired session"}, 401)
    }
    

    if(!ADMIN_EMAILS.includes(data.user.email.toLowerCase())){
        return c.json({error: "Unauthorized as admin"}, 403)
    }

    await next()
}

