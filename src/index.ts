// import * as Sentry from "@sentry/hono/node";
import { Hono } from 'hono'
// import { serve } from '@hono/node-server'
import {sentry} from "@sentry/hono/cloudflare";
import {cors} from "hono/cors"
import {products} from "@/routes/products.js"
import {brands} from "@/routes/brands.js"
import {categories} from "@/routes/categories.js"
import {health} from "@/routes/health.js"
import {orders} from "@/routes/orders.js"
import {dashboard} from "@/routes/dashboard.js"
import {cart} from "@/routes/cart.js";
import { dbMiddleware } from "@/middlewares/db.js";
import { supabaseMiddleware } from "@/middlewares/supabase.js";
import type {AppEnv} from "@/types/hono.js";
import {me} from "@/routes/me.js";

const app = new Hono<AppEnv>();


app.use(
  sentry(app, (env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    environment: env.NODE_ENV,
  }))
);

app.use('*', cors({
  origin: (origin) => origin ?? '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));


app.use("*", dbMiddleware);
app.use("*", supabaseMiddleware);


app.get('/', (c) => {
  return c.text('Hello Hono!')
});


app.route("/products", products)
app.route("/categories", categories)
app.route("/brands", brands)
app.route("/orders", orders)
app.route("/dashboard", dashboard)
app.route("/cart", cart)
app.route("/me", me)


app.route("/health", health);

// serve({
//   fetch: app.fetch,
//   port: Number(process.env.PORT) || 8000
// }, (info) => {
//   console.log(`Server is running on http://localhost:${info.port}`)
// })

export default app;