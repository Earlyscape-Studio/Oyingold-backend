import {describe, it, expect, vi} from "vitest";
import {testClient} from "hono/testing";
import {health} from "@/routes/health.js";
import {withMocks} from "../utils/with-mocks.js";


// vi.mock("@/lib/prisma.js", () => ({
//     prisma: {
//         $queryRaw: vi.fn()
//     }
// }))


describe("GET /", () => {
    it("returns ok when the database is reachable", async () => {
        const mockPrisma = {
            $queryRaw: vi.fn().mockResolvedValueOnce([{"?column?": 1}])
        };

        const client = testClient(withMocks(health, {prisma: mockPrisma}))
        const res = await client.index.$get()

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({status: "ok", database: "connected"})
    })


    it("returns 503 when the database is unreachable", async () => {
        const mockPrisma = {
            $queryRaw: vi.fn().mockRejectedValueOnce(new Error("connection refused"))
        }

        const client = testClient(withMocks(health, {prisma: mockPrisma}))
        const res = await client.index.$get()

        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({status: "error", database: "unreachable"})
    })
})