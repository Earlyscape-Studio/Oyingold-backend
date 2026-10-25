// Pricing and stock rules for checkout. Everything here is pure, so each rule
// can be swapped in one place once the client decides (shipping plan, card fee
// rate, discounts, counting stock in cartons).
//
// Money is calculated in integer kobo to avoid floating point drift, and
// converted back to naira only when stored or returned.

export type PricingType = "carton" | "piece";
export type PaymentMethod = "CARD" | "COD";

// Optional Worker vars. All are plain strings (wrangler vars are strings).
export type PricingEnv = {
  FLAT_SHIPPING_FEE?: string; // naira, flat amount per order
  CARD_FEE_PERCENT?: string; // e.g. "1.5" for 1.5%
  CARD_FEE_FLAT?: string; // naira, added on top of the percentage
  CARD_FEE_CAP?: string; // naira, maximum card fee
};

export function toKobo(value: unknown): number {
  return Math.round(Number(value) * 100);
}

export function fromKobo(kobo: number): number {
  return kobo / 100;
}

// Reads a non-negative number from an env string; anything else counts as 0.
function envNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * How much stock a cart line consumes.
 *
 * Stock is currently counted in PIECES: a piece line consumes its quantity,
 * a carton line consumes quantity x unitsPerCarton.
 *
 * If the client later wants stock counted in cartons, change this function
 * (and the meaning of stockLevel) and nothing else in checkout needs to move.
 */
export function stockUnitsForLine(line: {
  pricingType: PricingType;
  quantity: number;
  unitsPerCarton: number;
}): number {
  return line.pricingType === "carton"
    ? line.quantity * line.unitsPerCarton
    : line.quantity;
}

/**
 * Shipping fee in kobo. Placeholder: a flat fee from FLAT_SHIPPING_FEE until
 * the client decides their shipping plan. The context argument is where
 * per-state or weight-based rules will plug in.
 */
export function calculateShippingFeeKobo(
  env: PricingEnv,
  _context: { state: string; subtotalKobo: number }
): number {
  return toKobo(envNumber(env.FLAT_SHIPPING_FEE));
}

/**
 * Discount in kobo. Placeholder: none yet (first-order discount comes later).
 */
export function calculateDiscountKobo(): number {
  return 0;
}

/**
 * Card processing fee in kobo, passed on to the customer. Zero until the
 * FCMB rate is known and set via CARD_FEE_PERCENT / CARD_FEE_FLAT / CARD_FEE_CAP.
 *
 * This is a simple fee on the base amount. If the merchant must receive the
 * full order amount after FCMB deducts its cut, this becomes a gross-up
 * (base / (1 - rate)); decide that once the real rate is known.
 */
export function calculateCardFeeKobo(env: PricingEnv, baseKobo: number): number {
  const percent = envNumber(env.CARD_FEE_PERCENT);
  const flatKobo = toKobo(envNumber(env.CARD_FEE_FLAT));
  if (percent === 0 && flatKobo === 0) return 0;

  let fee = Math.round((baseKobo * percent) / 100) + flatKobo;

  const cap = envNumber(env.CARD_FEE_CAP);
  if (cap > 0) fee = Math.min(fee, toKobo(cap));

  return fee;
}

export type Totals = {
  subtotal: number;
  shippingFee: number;
  paymentFee: number;
  discount: number;
  total: number;
};

/** All figures are in naira. total = subtotal + shipping + paymentFee - discount. */
export function buildTotals(input: {
  subtotalKobo: number;
  paymentMethod: PaymentMethod;
  state: string;
  env: PricingEnv;
}): Totals {
  const { subtotalKobo, paymentMethod, state, env } = input;

  const shippingKobo = calculateShippingFeeKobo(env, { state, subtotalKobo });
  const discountKobo = Math.min(calculateDiscountKobo(), subtotalKobo);

  // The card fee is charged on what the customer would otherwise pay.
  const baseKobo = subtotalKobo + shippingKobo - discountKobo;
  const feeKobo =
    paymentMethod === "CARD" ? calculateCardFeeKobo(env, baseKobo) : 0;

  return {
    subtotal: fromKobo(subtotalKobo),
    shippingFee: fromKobo(shippingKobo),
    paymentFee: fromKobo(feeKobo),
    discount: fromKobo(discountKobo),
    total: fromKobo(baseKobo + feeKobo),
  };
}