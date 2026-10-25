import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FcmbError,
  getFcmbToken,
  initializeTransaction,
  queryTransaction,
  resetFcmbTokenCache,
} from "@/utils/fcmb.js";

const ENV = { FCMB_PUBLIC_KEY: "pk_test", FCMB_SECRET_KEY: "sk_test" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tokenResponse = () =>
  json({ status: "SUCCESS", data: { code: "00", EncryptedSecKey: { encryptedKey: "tok123" } } });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetFcmbTokenCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFcmbToken", () => {
  it("exchanges the keys for a token and caches it", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse());

    expect(await getFcmbToken(ENV)).toBe("tok123");
    expect(await getFcmbToken(ENV)).toBe("tok123");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://seerbitapi.com/api/v2/encrypt/keys");
    expect(JSON.parse(init.body)).toEqual({ key: "sk_test.pk_test" });
  });

  it("fails clearly when keys are missing", async () => {
    await expect(getFcmbToken({})).rejects.toThrow(FcmbError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the gateway refuses the keys", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "ERROR" }, 401));
    await expect(getFcmbToken(ENV)).rejects.toThrow(FcmbError);
  });
});

describe("initializeTransaction", () => {
  const input = {
    reference: "OG42-ABC",
    amount: "22950.00",
    email: "ada@example.com",
    productId: "OG-000042",
    productDescription: "Oyingold Retail order OG-000042",
    callbackUrl: "https://oyingold.com/checkout/complete?reference=OG42-ABC",
  };

  it("posts the order and returns the checkout link", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        json({ status: "SUCCESS", data: { code: "00", payments: { redirectLink: "https://checkout.example/#/?x=1" } } })
      );

    const result = await initializeTransaction(ENV, input);

    expect(result.redirectLink).toBe("https://checkout.example/#/?x=1");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://seerbitapi.com/api/v2/payments");
    expect(init.headers.Authorization).toBe("Bearer tok123");
    expect(JSON.parse(init.body)).toMatchObject({
      publicKey: "pk_test",
      amount: "22950.00",
      currency: "NGN",
      country: "NG",
      paymentReference: "OG42-ABC",
      callbackUrl: input.callbackUrl,
    });
  });

  it("refreshes the token once on a 401 and retries", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json({ status: "ERROR" }, 401))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        json({ data: { payments: { redirectLink: "https://checkout.example/ok" } } })
      );

    const result = await initializeTransaction(ENV, input);

    expect(result.redirectLink).toBe("https://checkout.example/ok");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("throws when no link comes back", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json({ status: "ERROR", data: { code: "S5" } }, 400));

    await expect(initializeTransaction(ENV, input)).rejects.toThrow(FcmbError);
  });
});

describe("queryTransaction", () => {
  it("normalises an approved transaction, using the fee-free breakdown amount", async () => {
    fetchMock.mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(
      json({
        status: "SUCCESS",
        data: {
          code: "00",
          message: "Successful",
          payments: {
            amount: 10.15,
            fee: "0.15",
            paymentType: "CARD",
            gatewayref: "SEERBIT1303494716633",
            gatewayCode: "00",
            gatewayMessage: "Successful",
            paymentBreakdown: { amount: 10.0, fee: 0.15, total: 10.15 },
          },
        },
      })
    );

    const result = await queryTransaction(ENV, "OG42-ABC");

    expect(result).toMatchObject({
      found: true,
      code: "00",
      amount: 10,
      fee: 0.15,
      gatewayReference: "SEERBIT1303494716633",
      channel: "CARD",
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://seerbitapi.com/api/v3/payments/query/OG42-ABC"
    );
  });

  it("reports not found when the gateway has no record", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json({ status: "ERROR", data: { code: "S404" } }, 404));

    const result = await queryTransaction(ENV, "OG42-NEW");
    expect(result.found).toBe(false);
  });

  it("throws on a gateway error so nothing is decided from a non-answer", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json({ error: "boom" }, 500));

    await expect(queryTransaction(ENV, "OG42-ABC")).rejects.toThrow(FcmbError);
  });

  it("throws when the network is down", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(queryTransaction(ENV, "OG42-ABC")).rejects.toThrow(FcmbError);
  });
});