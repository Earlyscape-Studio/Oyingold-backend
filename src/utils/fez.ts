// Thin client for the Fez Delivery business API. Used for one thing only:
// quoting the delivery cost to a state at checkout.
// Docs: https://fez-delivery-co.gitbook.io/fezcorporate-api-docs
//
// Two calls: authenticate (returns a bearer token and the org's secret key), then
// POST /order/cost. If Fez isn't configured or can't answer, resolveShippingFeeKobo
// returns undefined and checkout falls back to the flat fee (FLAT_SHIPPING_FEE).

import { toKobo } from "@/utils/pricing.js";

export type FezEnv = {
  FEZ_USER_ID?: string; // secret
  FEZ_PASSWORD?: string; // secret
  FEZ_BASE_URL?: string; // defaults to the sandbox; set the production URL explicitly
  FEZ_PICKUP_STATE?: string; // optional; otherwise Fez uses the state on your org profile
};

// Thrown for anything that stops us from getting a trustworthy quote from Fez
// (not configured, network failure, bad credentials, unexpected body).
export class FezError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "FezError";
  }
}

const DEFAULT_BASE_URL = "https://apisandbox.fezdelivery.co/v1";
const REQUEST_TIMEOUT_MS = 5000;
// Token lifetime isn't documented in a form we can rely on, so it's cached briefly,
// and a 401 clears it and retries once.
const TOKEN_TTL_MS = 10 * 60 * 1000;
// Delivery rates change rarely; this keeps checkout from calling Fez on every
// state change. Cached per isolate.
const QUOTE_TTL_MS = 10 * 60 * 1000;

type FezAuth = { token: string; secretKey: string };

let cachedAuth: (FezAuth & { expiresAt: number; cacheKey: string }) | null = null;
const cachedQuotes = new Map<string, { kobo: number; expiresAt: number }>();

export function resetFezCache() {
  cachedAuth = null;
  cachedQuotes.clear();
}

function baseUrl(env: FezEnv): string {
  return (env.FEZ_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

export function isFezConfigured(env: FezEnv): boolean {
  return Boolean(env.FEZ_USER_ID && env.FEZ_PASSWORD);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new FezError("Could not reach Fez");
  }
}

async function getFezAuth(env: FezEnv, force = false): Promise<FezAuth> {
  if (!isFezConfigured(env)) throw new FezError("Fez credentials are not configured");

  const cacheKey = `${env.FEZ_USER_ID}:${baseUrl(env)}`;
  if (
    !force &&
    cachedAuth &&
    cachedAuth.cacheKey === cacheKey &&
    cachedAuth.expiresAt > Date.now()
  ) {
    return { token: cachedAuth.token, secretKey: cachedAuth.secretKey };
  }

  const res = await request(`${baseUrl(env)}/user/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: env.FEZ_USER_ID, password: env.FEZ_PASSWORD }),
  });

  const body: any = await res.json().catch(() => null);
  const token = body?.authDetails?.authToken;
  const secretKey = body?.orgDetails?.["secret-key"];

  if (
    !res.ok ||
    typeof token !== "string" ||
    token.length === 0 ||
    typeof secretKey !== "string" ||
    secretKey.length === 0
  ) {
    throw new FezError("Could not authenticate with Fez", res.status);
  }

  cachedAuth = { token, secretKey, expiresAt: Date.now() + TOKEN_TTL_MS, cacheKey };
  return { token, secretKey };
}

// Authenticated POST that refreshes the token once if Fez says it has expired.
async function authedPost(env: FezEnv, path: string, payload: unknown): Promise<Response> {
  const send = async (force: boolean) => {
    const { token, secretKey } = await getFezAuth(env, force);
    return request(`${baseUrl(env)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "secret-key": secretKey,
      },
      body: JSON.stringify(payload),
    });
  };

  const res = await send(false);
  if (res.status !== 401) return res;

  cachedAuth = null;
  return send(true);
}

/**
 * What Fez charges to deliver to a state, in kobo. Includes VAT: the docs say the
 * amount actually charged is the cost plus VAT, which they return as totalCost.
 * Priced for Fez's default parcel band (0-5kg); we don't send a weight yet.
 */
export async function getFezDeliveryCostKobo(env: FezEnv, state: string): Promise<number> {
  const destination = state.trim();
  if (!destination) throw new FezError("A delivery state is required");

  const pickUpState = env.FEZ_PICKUP_STATE?.trim() || undefined;
  const cacheKey = `${baseUrl(env)}|${pickUpState ?? ""}|${destination.toLowerCase()}`;

  const hit = cachedQuotes.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.kobo;

  const res = await authedPost(env, "/order/cost", {
    state: destination,
    ...(pickUpState ? { pickUpState } : {}),
  });

  const body: any = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "Success") {
    throw new FezError("Could not get a delivery cost from Fez", res.status);
  }

  const total =
    toNumber(body.totalCost) ??
    (toNumber(body.cost?.cost) !== null
      ? (toNumber(body.cost.cost) as number) + (toNumber(body.vat?.vatAmount) ?? 0)
      : null);

  if (total === null || total <= 0) {
    throw new FezError("Fez returned an unusable delivery cost", res.status);
  }

  const kobo = toKobo(total);
  cachedQuotes.set(cacheKey, { kobo, expiresAt: Date.now() + QUOTE_TTL_MS });
  return kobo;
}

/**
 * The shipping fee to charge for a state, in kobo, or undefined to mean "use the
 * flat fee". Never throws: a Fez outage must not stop customers from checking out.
 */
export async function resolveShippingFeeKobo(
  env: FezEnv,
  state: string
): Promise<number | undefined> {
  if (!isFezConfigured(env) || !state.trim()) return undefined;

  try {
    return await getFezDeliveryCostKobo(env, state);
  } catch (err) {
    console.error(
      "Fez delivery quote failed, using the flat shipping fee:",
      err instanceof Error ? err.message : "unknown error"
    );
    return undefined;
  }
}