import type {User} from "@/generated/prisma/client.js";



export type AppEnv = {
    Variables: {
        user: User;
    }
}