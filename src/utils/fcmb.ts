// Thin client for the FCMB Pay gateway (SeerBit under the hood).
// Docs: https://paydocs.fcmb.com
//
// Three calls: get a Bearer token from the merchant keys, initialize a standard
// checkout, and query a transaction by our payment reference.

export type FcmbEnv = {
  FCMB_PUBLIC_KEY?: string;
  FCMB_SECRET_KEY?: string;
  FCMB_BASE_URL?: string; // defaults to https://seerbitapi.com
};

// Thrown for anything that stops us from getting a trustworthy answer from the
// gateway (not configured, network failure, 5xx, unexpected body).
export class FcmbError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "FcmbError";
  }
}

export type GatewayTransaction = {
  found: boolean; // false when the gateway has no record yet (customer hasn't paid)
  code: string | null; // "00" means approved
  message: string | null;
  amount: number | null; // the order amount we asked for, excluding any gateway fee
  fee: number | null;
  gatewayReference: string | null;
  channel: string | null;
  raw: unknown;
};

const DEFAULT_BASE_URL = "https://seerbitapi.com";
const TOKEN_TTL_MS = 5 * 60 * 1000;

// Cached per isolate. Short-lived on purpose: token expiry isn't documented, and
// a 401 clears the cache and retries once anyway.
let cachedToken: { value: string; expiresAt: number; cacheKey: string } | null = null;

export function resetFcmbTokenCache() {
  cachedToken = null;
}

function baseUrl(env: FcmbEnv): string {
  return (env.FCMB_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function requireKeys(env: FcmbEnv): { publicKey: string; secretKey: string } {
  if (!env.FCMB_PUBLIC_KEY || !env.FCMB_SECRET_KEY) {
    throw new FcmbError("FCMB keys are not configured");
  }
  return { publicKey: env.FCMB_PUBLIC_KEY, secretKey: env.FCMB_SECRET_KEY };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new FcmbError("Could not reach the payment gateway");
  }
}

export async function getFcmbToken(env: FcmbEnv, force = false): Promise<string> {
  const { publicKey, secretKey } = requireKeys(env);
  const cacheKey = `${publicKey}:${baseUrl(env)}`;

  if (
    !force &&
    cachedToken &&
    cachedToken.cacheKey === cacheKey &&
    cachedToken.expiresAt > Date.now()
  ) {
    return cachedToken.value;
  }

  const res = await request(`${baseUrl(env)}/api/v2/encrypt/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The docs list the private key first in this body.
    body: JSON.stringify({ key: `${secretKey}.${publicKey}` }),
  });

  const body: any = await res.json().catch(() => null);
  const token = body?.data?.EncryptedSecKey?.encryptedKey;

  if (!res.ok || typeof token !== "string" || token.length === 0) {
    throw new FcmbError("Could not authenticate with the payment gateway", res.status);
  }

  cachedToken = { value: token, expiresAt: Date.now() + TOKEN_TTL_MS, cacheKey };
  return token;
}

// Authenticated request that refreshes the token once if the gateway says it has expired.
async function authedRequest(
  env: FcmbEnv,
  url: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> }
): Promise<Response> {
  const send = async (force: boolean) => {
    const token = await getFcmbToken(env, force);
    return request(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
  };

  const res = await send(false);
  if (res.status !== 401) return res;

  return send(true);
}

/**
 * Standard checkout: asks the gateway for a hosted checkout link.
 * `amount` is naira with two decimals, e.g. "22950.00".
 */
export async function initializeTransaction(
  env: FcmbEnv,
  input: {
    reference: string;
    amount: string;
    email: string;
    productId: string;
    productDescription: string;
    callbackUrl: string;
  }
): Promise<{ redirectLink: string }> {
  const { publicKey } = requireKeys(env);

  const res = await authedRequest(env, `${baseUrl(env)}/api/v2/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey,
      amount: input.amount,
      currency: "NGN",
      country: "NG",
      paymentReference: input.reference,
      email: input.email,
      productId: input.productId,
      productDescription: input.productDescription,
      callbackUrl: input.callbackUrl,
    }),
  });

  const body: any = await res.json().catch(() => null);
  const redirectLink = body?.data?.payments?.redirectLink;

  if (!res.ok || typeof redirectLink !== "string" || redirectLink.length === 0) {
    throw new FcmbError("The payment gateway did not return a checkout link", res.status);
  }

  return { redirectLink };
}

/**
 * Looks up a transaction by our reference. The gateway is the source of truth:
 * browser callbacks and webhooks only tell us when to ask.
 */
export async function queryTransaction(
  env: FcmbEnv,
  reference: string
): Promise<GatewayTransaction> {
  const res = await authedRequest(
    env,
    `${baseUrl(env)}/api/v3/payments/query/${encodeURIComponent(reference)}`,
    { method: "GET" }
  );

  const body: any = await res.json().catch(() => null);
  const data = body?.data;

  // "No data found" (404 / S404): the customer hasn't started paying yet.
  if (res.status === 404 || data?.code === "S404") {
    return {
      found: false,
      code: null,
      message: null,
      amount: null,
      fee: null,
      gatewayReference: null,
      channel: null,
      raw: body,
    };
  }

  if (!res.ok || !data) {
    throw new FcmbError("Could not check the payment status", res.status);
  }

  const payments = data.payments ?? {};
  const breakdown = payments.paymentBreakdown ?? {};

  return {
    found: true,
    // gatewayCode describes the payment itself; data.code only says the lookup worked.
    code: toText(payments.gatewayCode) ?? toText(data.code),
    message: toText(payments.gatewayMessage) ?? toText(payments.reason) ?? toText(data.message),
    // breakdown.amount excludes the gateway fee; payments.amount can include it.
    amount: toNumber(breakdown.amount) ?? toNumber(payments.amount),
    fee: toNumber(breakdown.fee) ?? toNumber(payments.fee),
    gatewayReference: toText(payments.gatewayref),
    channel: toText(payments.paymentType) ?? toText(payments.channelType),
    raw: body,
  };
}