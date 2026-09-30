import { Resend } from "resend";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "@/types/hono.js";

export const mailMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    const { RESEND_API_KEY } = c.env;

    if (!RESEND_API_KEY) {
        return c.json({ error: "Resend is not configured" }, 500);
    }

    const resend = new Resend(RESEND_API_KEY);

    c.set("resend", resend);

    await next();
});