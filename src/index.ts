// import * as Sentry from "@sentry/hono/node";
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import {sentry} from "@sentry/hono/node";
import {cors} from "hono/cors"
import {products} from "@/routes/products.js"
import {brands} from "@/routes/brands.js"
import {categories} from "@/routes/categories.js"
import {health} from "@/routes/health.js"
import {orders} from "@/routes/orders.js"
import {dashboard} from "@/routes/dashboard.js"
import {me} from "@/routes/me.js";

const app = new Hono()


app.use(sentry(app))

app.use('*', cors({
  origin: (origin) => origin ?? '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}))


app.get('/', (c) => {
  return c.text('Hello Hono!')
})

// app.get("/debug-sentry", () => {
//    Sentry.logger.info("User example action completed");
//    Sentry.logger.warn("Slow operation detected", {
//      operation: "data_fetch",
//      duration: 3500,
//    });
//    Sentry.logger.error("Validation failed", {
//      field: "email",
//      reason: "Invalid email",
//    });
//   throw new Error("My first Sentry error!");
// });

app.route("/products", products)
app.route("/categories", categories)
app.route("/brands", brands)
app.route("/health", health)
app.route("/orders", orders)
app.route("/dashboard", dashboard)
app.route("/me", me)

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 8000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
