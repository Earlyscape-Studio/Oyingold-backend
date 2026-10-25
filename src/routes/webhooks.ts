import { Hono, type Context } from "hono";
import type { AppEnv } from "@/types/hono.js";
import { verifyAndSettle } from "@/utils/settle-payment.js";

type StoredEvent = {
  id: string;
  eventType: string;
  reference: string | null;
};

// Constant-time string comparison, so the shared token can't be guessed byte by byte.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// FCMB sends { notificationItems: [{ notificationRequestItem: { eventId, eventType, data } }] }.
function extractItems(body: any): Array<{
  eventId: string;
  eventType: string;
  reference: string | null;
  payload: unknown;
}> {
  const items = Array.isArray(body?.notificationItems) ? body.notificationItems : [];
  const result = [];

  for (const entry of items) {
    const item = entry?.notificationRequestItem;
    if (typeof item?.eventId !== "string" || item.eventId.length === 0) continue;

    const ref = item.data?.reference;
    result.push({
      eventId: item.eventId,
      eventType: typeof item.eventType === "string" ? item.eventType : "unknown",
      reference: typeof ref === "string" && ref.length > 0 ? ref : null,
      payload: item,
    });
  }

  return result;
}

// Runs the work after the response has gone out (what FCMB asks for). Where the
// runtime has no execution context, as in tests, it simply waits for it.
async function afterResponse(c: Context<AppEnv>, work: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}

async function processEvent(
  prisma: AppEnv["Variables"]["prisma"],
  env: AppEnv["Bindings"],
  event: StoredEvent
) {
  try {
    let note: string | null = null;

    if (event.eventType === "transaction") {
      if (!event.reference) {
        note = "No transaction reference in payload";
      } else {
        // The payload's own amounts and status are ignored: the gateway's answer to a
        // status query is what settles a payment. A forged notification can at worst
        // trigger a harmless lookup.
        const result = await verifyAndSettle(prisma, env, event.reference);
        if (result.outcome === "unknown_reference") note = "Unknown payment reference";
      }
    }
    // Other event types (refund, dispute, wallet...) are only kept on record for now.

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), error: note },
    });
  } catch (error) {
    // Left unprocessed, with the reason, so it can be retried or investigated.
    console.error("Webhook processing failed", event.id, error);
    await prisma.webhookEvent
      .update({
        where: { id: event.id },
        data: { error: error instanceof Error ? error.message.slice(0, 500) : "Unknown error" },
      })
      .catch(() => {});
  }
}

export const webhooks = new Hono<AppEnv>().post("/fcmb", async (c) => {
  const prisma = c.get("prisma");
  const env = c.env ?? ({} as AppEnv["Bindings"]);

  // FCMB documents no signature, so when a token is configured it must be part of
  // the notification URL entered in their dashboard (…/webhooks/fcmb?token=…).
  if (env.FCMB_WEBHOOK_TOKEN) {
    const given = c.req.query("token") ?? "";
    if (!safeEqual(given, env.FCMB_WEBHOOK_TOKEN)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  const body = await c.req.json().catch(() => null);
  const items = extractItems(body);

  // 1. Save every notification before doing anything with it.
  const toProcess: StoredEvent[] = [];

  for (const item of items) {
    const event = await prisma.webhookEvent.upsert({
      where: { eventId: item.eventId },
      create: {
        eventId: item.eventId,
        eventType: item.eventType,
        reference: item.reference,
        payload: item.payload as any,
      },
      update: {},
    });

    // A retry of something already handled is acknowledged and ignored.
    if (event.processedAt) continue;

    toProcess.push({ id: event.id, eventType: event.eventType, reference: event.reference });
  }

  // 2. Acknowledge, 3. then apply the business logic.
  await afterResponse(
    c,
    (async () => {
      for (const event of toProcess) await processEvent(prisma, env, event);
    })()
  );

  return c.json({ received: items.length });
});