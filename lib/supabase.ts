import "dotenv/config"
import {createClient} from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY

if(!supabaseUrl || !secretKey){
    throw new Error(
        "supabaseUrl and secretKey must be set to verify admin sessions"
    )
}

export const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: {autoRefreshToken: false, persistSession: false} 
})