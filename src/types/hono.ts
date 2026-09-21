import type {User, PrismaClient} from "@/generated/prisma/client.js";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {Bindings} from "@/env.js";



export type AppEnv = {
    Bindings: Bindings;
    Variables: {
        user: User;
        prisma: PrismaClient;
        supabase: SupabaseClient;
    }
}