export type GatewayOutcome = "PAID" | "PENDING" | "FAILED";

// Codes that mean "not decided yet": still in progress, timed out (check again
// shortly), or the gateway has no record. Everything else except "00" is a failure.
const PENDING_CODES = new Set([
  "S20",
  "SM_P",
  "INP",
  "INP2",
  "SM_09",
  "S0",
  "S11",
  "S404",
]);

/** Maps an FCMB status code to what we do with the payment. Only "00" is PAID. */
export function mapGatewayCode(code: string | null | undefined): GatewayOutcome {
  if (!code) return "PENDING";
  if (code === "00") return "PAID";
  if (PENDING_CODES.has(code)) return "PENDING";
  return "FAILED";
}

/** True when the gateway's amount equals what we asked for, to the kobo. */
export function amountsMatch(expected: unknown, actual: number | null): boolean {
  if (actual === null) return false;
  return Math.round(Number(expected) * 100) === Math.round(actual * 100);
}

/** Naira with two decimals, the format the gateway expects ("22950.00"). */
export function formatGatewayAmount(amount: unknown): string {
  return Number(amount).toFixed(2);
}

/** Our reference for a payment attempt. Unique per attempt: the gateway rejects reuse. */
export function makePaymentReference(orderNumber: number): string {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  return `OG${orderNumber}-${random}`;
}