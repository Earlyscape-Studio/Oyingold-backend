import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/settle-payment.js", () => ({ verifyAndSettle: vi.fn() }));

import { webhooks } from "@/routes/webhooks.js";
import { verifyAndSettle } from "@/utils/settle-payment.js";
import { withMocks } from "../utils/with-mocks.js";

const mockPrisma = {
  webhookEvent: { upsert: vi.fn(), update: vi.fn() },
};

function notification(items: Array<{ eventId?: string; eventType?: string; data?: any }>) {
  return {
    notificationItems: items.map((i) => ({
      notificationRequestItem: {
        eventType: "transaction",
        eventDate: "2026-10-24 12:00:00",
        ...i,
      },
    })),
  };
}

function post(body: unknown, { env = {}, query = "" }: { env?: any; query?: string } = {}) {
  return withMocks(webhooks, { prisma: mockPrisma }).request(
    `/fcmb${query}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    env
  );
}

const txEvent = (overrides: any = {}) => ({
  id: "evt-row-1",
  eventId: "e1",
  eventType: "transaction",
  reference: "OG42-ABC",
  processedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.webhookEvent.update.mockResolvedValue({});
  vi.mocked(verifyAndSettle).mockResolvedValue({
    outcome: "paid",
    paymentStatus: "PAID",
    order: null,
  });
});

describe("POST /webhooks/fcmb", () => {
  it("stores the notification, settles the payment and marks the event processed", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent());

    const res = await post(
      notification([{ eventId: "e1", data: { reference: "OG42-ABC", status: "APPROVED" } }])
    );

    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(1);

    expect(mockPrisma.webhookEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: "e1" },
        create: expect.objectContaining({
          eventId: "e1",
          eventType: "transaction",
          reference: "OG42-ABC",
        }),
      })
    );
    expect(verifyAndSettle).toHaveBeenCalledWith(mockPrisma, expect.anything(), "OG42-ABC");
    expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-row-1" },
      data: { processedAt: expect.any(Date), error: null },
    });
  });

  it("ignores the payload's own status: only the gateway lookup settles anything", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent());

    // A notification claiming approval for a payment the gateway says is declined.
    vi.mocked(verifyAndSettle).mockResolvedValueOnce({
      outcome: "failed",
      paymentStatus: "FAILED",
      order: null,
    });

    await post(notification([{ eventId: "e1", data: { reference: "OG42-ABC", status: "APPROVED" } }]));

    expect(verifyAndSettle).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a retry of an already processed event without settling again", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent({ processedAt: new Date() }));

    const res = await post(notification([{ eventId: "e1", data: { reference: "OG42-ABC" } }]));

    expect(res.status).toBe(200);
    expect(verifyAndSettle).not.toHaveBeenCalled();
    expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalled();
  });

  it("processes an event that was stored earlier but never finished", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent({ processedAt: null }));

    await post(notification([{ eventId: "e1", data: { reference: "OG42-ABC" } }]));

    expect(verifyAndSettle).toHaveBeenCalledTimes(1);
  });

  it("handles several items in one notification", async () => {
    mockPrisma.webhookEvent.upsert
      .mockResolvedValueOnce(txEvent({ id: "r1", eventId: "e1", reference: "OG1-A" }))
      .mockResolvedValueOnce(txEvent({ id: "r2", eventId: "e2", reference: "OG2-B" }));

    const res = await post(
      notification([
        { eventId: "e1", data: { reference: "OG1-A" } },
        { eventId: "e2", data: { reference: "OG2-B" } },
      ])
    );

    expect((await res.json()).received).toBe(2);
    expect(verifyAndSettle).toHaveBeenCalledTimes(2);
    expect(mockPrisma.webhookEvent.update).toHaveBeenCalledTimes(2);
  });

  it("records other event types without settling anything", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(
      txEvent({ eventType: "refund", reference: null })
    );

    await post(notification([{ eventId: "e1", eventType: "refund", data: { transactionRef: "OG42-ABC" } }]));

    expect(verifyAndSettle).not.toHaveBeenCalled();
    expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { processedAt: expect.any(Date), error: null } })
    );
  });

  it("closes out a transaction event with no reference, noting why", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent({ reference: null }));

    await post(notification([{ eventId: "e1", data: {} }]));

    expect(verifyAndSettle).not.toHaveBeenCalled();
    expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { processedAt: expect.any(Date), error: "No transaction reference in payload" },
      })
    );
  });

  it("notes a reference we don't recognise", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent());
    vi.mocked(verifyAndSettle).mockResolvedValueOnce({
      outcome: "unknown_reference",
      paymentStatus: null,
      order: null,
    });

    await post(notification([{ eventId: "e1", data: { reference: "OG42-ABC" } }]));

    expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { processedAt: expect.any(Date), error: "Unknown payment reference" },
      })
    );
  });

  it("still acknowledges when settling fails, keeping the event unprocessed with the reason", async () => {
    mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent());
    vi.mocked(verifyAndSettle).mockRejectedValueOnce(new Error("gateway down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(notification([{ eventId: "e1", data: { reference: "OG42-ABC" } }]));

    expect(res.status).toBe(200);
    expect(mockPrisma.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: "evt-row-1" },
      data: { error: "gateway down" },
    });
    // Never marked processed.
    expect(mockPrisma.webhookEvent.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processedAt: expect.anything() }) })
    );
  });

  it("acknowledges malformed bodies without storing anything", async () => {
    for (const body of ["not json", {}, { notificationItems: [{}] }, notification([{}])]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect((await res.json()).received).toBe(0);
    }
    expect(mockPrisma.webhookEvent.upsert).not.toHaveBeenCalled();
  });

  describe("shared token", () => {
    const env = { FCMB_WEBHOOK_TOKEN: "s3cret" };
    const body = () => notification([{ eventId: "e1", data: { reference: "OG42-ABC" } }]);

    it("rejects a missing or wrong token before touching the database", async () => {
      expect((await post(body(), { env })).status).toBe(401);
      expect((await post(body(), { env, query: "?token=wrong" })).status).toBe(401);
      expect(mockPrisma.webhookEvent.upsert).not.toHaveBeenCalled();
      expect(verifyAndSettle).not.toHaveBeenCalled();
    });

    it("accepts the right token", async () => {
      mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent());
      const res = await post(body(), { env, query: "?token=s3cret" });
      expect(res.status).toBe(200);
      expect(verifyAndSettle).toHaveBeenCalledTimes(1);
    });

    it("is not enforced when no token is configured", async () => {
      mockPrisma.webhookEvent.upsert.mockResolvedValueOnce(txEvent());
      expect((await post(body())).status).toBe(200);
    });
  });
});