import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import {cors} from "hono/cors"
import {products} from "@/routes/products.js"
import {brands} from "@/routes/brands.js"
import {categories} from "@/routes/categories.js"

const app = new Hono()


app.use('*', cors({
  origin: (origin) => origin ?? '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}))


app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route("/products", products)
app.route("/categories", categories)
app.route("/brands", brands)

serve({
  fetch: app.fetch,
  port: 8000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
