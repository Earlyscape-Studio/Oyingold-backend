import { describe, it, expect } from "vitest";
import {
  buildTotals,
  calculateCardFeeKobo,
  calculateShippingFeeKobo,
  stockUnitsForLine,
  toKobo,
} from "@/utils/pricing.js";

describe("toKobo", () => {
  it("avoids floating point drift", () => {
    expect(toKobo(0.1 + 0.2)).toBe(30);
    expect(toKobo("3200.50")).toBe(320050);
  });
});

describe("stockUnitsForLine", () => {
  it("counts piece lines as their quantity", () => {
    expect(stockUnitsForLine({ pricingType: "piece", quantity: 3, unitsPerCarton: 12 })).toBe(3);
  });

  it("counts carton lines as quantity x unitsPerCarton", () => {
    expect(stockUnitsForLine({ pricingType: "carton", quantity: 2, unitsPerCarton: 12 })).toBe(24);
  });
});

describe("calculateShippingFeeKobo", () => {
  const ctx = { state: "Lagos", subtotalKobo: 100000 };

  it("uses the flat fee from env", () => {
    expect(calculateShippingFeeKobo({ FLAT_SHIPPING_FEE: "1500" }, ctx)).toBe(150000);
  });

  it("is zero when unset or invalid", () => {
    expect(calculateShippingFeeKobo({}, ctx)).toBe(0);
    expect(calculateShippingFeeKobo({ FLAT_SHIPPING_FEE: "abc" }, ctx)).toBe(0);
    expect(calculateShippingFeeKobo({ FLAT_SHIPPING_FEE: "-5" }, ctx)).toBe(0);
  });
});

describe("calculateCardFeeKobo", () => {
  it("is zero with no config", () => {
    expect(calculateCardFeeKobo({}, 2100000)).toBe(0);
  });

  it("applies percentage plus flat amount", () => {
    // 1.5% of 21,000 = 315, plus 100 flat
    expect(
      calculateCardFeeKobo({ CARD_FEE_PERCENT: "1.5", CARD_FEE_FLAT: "100" }, 2100000)
    ).toBe(41500);
  });

  it("respects the cap", () => {
    expect(
      calculateCardFeeKobo({ CARD_FEE_PERCENT: "1.5", CARD_FEE_CAP: "200" }, 2100000)
    ).toBe(20000);
  });
});

describe("buildTotals", () => {
  const env = { FLAT_SHIPPING_FEE: "1500", CARD_FEE_PERCENT: "2" };

  it("adds the card fee for CARD on top of subtotal and shipping", () => {
    const t = buildTotals({ subtotalKobo: 2100000, paymentMethod: "CARD", state: "Lagos", env });
    // base 22,500, fee 2% = 450
    expect(t).toEqual({
      subtotal: 21000,
      shippingFee: 1500,
      paymentFee: 450,
      discount: 0,
      total: 22950,
    });
  });

  it("never charges a card fee for COD", () => {
    const t = buildTotals({ subtotalKobo: 2100000, paymentMethod: "COD", state: "Lagos", env });
    expect(t.paymentFee).toBe(0);
    expect(t.total).toBe(22500);
  });
});