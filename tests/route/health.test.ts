import {describe, it, expect, vi} from "vitest";
import {testClient} from "hono/testing";
import {health} from "@/routes/health.js";


vi.mock("@/lib/prisma.js", () => ({
    prisma: {
        $queryRaw: vi.fn()
    }
}))


describe("GET /", () => {
    it("returns ok when the database is reachable", async () => {
        const {prisma} = await import("@/lib/prisma.js")
        vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{"?column?": 1}])

        const client = testClient(health)
        const res = await client.index.$get()

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({status: "ok", database: "connected"})
    })


    it("returns 503 when the database is unreachable", async () => {
        const {prisma} = await import("@/lib/prisma.js")
        vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("connection refused"))



        const client = testClient(health)
        const res = await client.index.$get()

        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({status: "error", database: "unreachable"})
    })
})