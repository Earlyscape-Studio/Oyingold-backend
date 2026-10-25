import { describe, it, expect } from "vitest";
import {
  amountsMatch,
  formatGatewayAmount,
  makePaymentReference,
  mapGatewayCode,
} from "@/utils/payments.js";

describe("mapGatewayCode", () => {
  it("treats only 00 as paid", () => {
    expect(mapGatewayCode("00")).toBe("PAID");
    expect(mapGatewayCode("SM_10")).toBe("FAILED"); // approved for partial amount
    expect(mapGatewayCode("SM_32")).toBe("FAILED"); // completed partially
  });

  it("treats in-progress, timeout and no-record codes as pending", () => {
    for (const code of ["S20", "SM_P", "INP", "INP2", "SM_09", "S0", "S404", "S11"]) {
      expect(mapGatewayCode(code)).toBe("PENDING");
    }
  });

  it("treats declines, cancellations and expiries as failed", () => {
    for (const code of ["S12", "SM_51", "SM_05", "SM_17", "SM_C", "X23", "SM_X23", "S14"]) {
      expect(mapGatewayCode(code)).toBe("FAILED");
    }
  });

  it("treats a missing code as pending, never as paid or failed", () => {
    expect(mapGatewayCode(null)).toBe("PENDING");
    expect(mapGatewayCode(undefined)).toBe("PENDING");
  });
});

describe("amountsMatch", () => {
  it("compares to the kobo", () => {
    expect(amountsMatch("22950", 22950)).toBe(true);
    expect(amountsMatch(22950.1, 22950.1)).toBe(true);
    expect(amountsMatch("22950.00", 22949.99)).toBe(false);
  });

  it("never matches a missing amount", () => {
    expect(amountsMatch("100", null)).toBe(false);
  });
});

describe("formatGatewayAmount", () => {
  it("always uses two decimals", () => {
    expect(formatGatewayAmount("22950")).toBe("22950.00");
    expect(formatGatewayAmount(450.3)).toBe("450.30");
  });
});

describe("makePaymentReference", () => {
  it("includes the order number and is unique per call", () => {
    const a = makePaymentReference(42);
    const b = makePaymentReference(42);
    expect(a).toMatch(/^OG42-[A-Z0-9]{10}$/);
    expect(a).not.toBe(b);
  });
});