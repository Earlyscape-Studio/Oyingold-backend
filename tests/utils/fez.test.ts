import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  FezError,
  getFezDeliveryCostKobo,
  resetFezCache,
  resolveShippingFeeKobo,
} from "@/utils/fez.js";

const ENV = { FEZ_USER_ID: "G-1234-5678", FEZ_PASSWORD: "pw", FEZ_BASE_URL: "https://fez.test/v1" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const authResponse = (token = "tok1") =>
  json({
    status: "Success",
    authDetails: { authToken: token, expireToken: "2026-11-17 05:06:08" },
    orgDetails: { "secret-key": "sec1" },
  });

const costResponse = (totalCost = 6450) =>
  json({
    status: "Success",
    cost: { state: "Kano", cost: 6000 },
    vat: { vatAmount: 450, vatPercent: "7.50" },
    totalCost,
  });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetFezCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getFezDeliveryCostKobo", () => {
  it("authenticates, asks for the cost, and returns the VAT-inclusive total in kobo", async () => {
    fetchMock.mockResolvedValueOnce(authResponse()).mockResolvedValueOnce(costResponse());

    expect(await getFezDeliveryCostKobo(ENV, "Kano")).toBe(645000);

    const [authUrl, authInit] = fetchMock.mock.calls[0];
    expect(authUrl).toBe("https://fez.test/v1/user/authenticate");
    expect(JSON.parse(authInit.body)).toEqual({ user_id: "G-1234-5678", password: "pw" });

    const [costUrl, costInit] = fetchMock.mock.calls[1];
    expect(costUrl).toBe("https://fez.test/v1/order/cost");
    expect(costInit.headers.Authorization).toBe("Bearer tok1");
    expect(costInit.headers["secret-key"]).toBe("sec1");
    expect(JSON.parse(costInit.body)).toEqual({ state: "Kano" });
  });

  it("sends the pickup state when one is configured", async () => {
    fetchMock.mockResolvedValueOnce(authResponse()).mockResolvedValueOnce(costResponse());

    await getFezDeliveryCostKobo({ ...ENV, FEZ_PICKUP_STATE: "Lagos" }, "Kano");

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      state: "Kano",
      pickUpState: "Lagos",
    });
  });

  it("adds VAT to the cost when totalCost is missing", async () => {
    fetchMock.mockResolvedValueOnce(authResponse()).mockResolvedValueOnce(
      json({
        status: "Success",
        cost: { state: "Kano", cost: 6000 },
        vat: { vatAmount: 450, vatPercent: "7.50" },
      })
    );

    expect(await getFezDeliveryCostKobo(ENV, "Kano")).toBe(645000);
  });

  it("reuses the token and remembers a state's quote", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse())
      .mockResolvedValueOnce(costResponse(6450))
      .mockResolvedValueOnce(costResponse(5000));

    expect(await getFezDeliveryCostKobo(ENV, "Kano")).toBe(645000);
    expect(await getFezDeliveryCostKobo(ENV, " kano ")).toBe(645000); // cached, no new call
    expect(await getFezDeliveryCostKobo(ENV, "Lagos")).toBe(500000); // new state, same token

    expect(fetchMock).toHaveBeenCalledTimes(3); // one auth, two cost calls
  });

  it("signs in again and retries once when the token has expired", async () => {
    fetchMock
      .mockResolvedValueOnce(authResponse("old"))
      .mockResolvedValueOnce(json({ status: "Error", description: "Unauthenticated" }, 401))
      .mockResolvedValueOnce(authResponse("fresh"))
      .mockResolvedValueOnce(costResponse());

    expect(await getFezDeliveryCostKobo(ENV, "Kano")).toBe(645000);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe("Bearer fresh");
  });

  it("fails when credentials are missing, without calling Fez", async () => {
    await expect(getFezDeliveryCostKobo({}, "Kano")).rejects.toBeInstanceOf(FezError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when Fez rejects the credentials", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "Error", description: "Invalid" }, 401));
    await expect(getFezDeliveryCostKobo(ENV, "Kano")).rejects.toThrow(
      "Could not authenticate with Fez"
    );
  });

  it("fails on an unusable amount", async () => {
    fetchMock.mockResolvedValueOnce(authResponse()).mockResolvedValueOnce(costResponse(0));
    await expect(getFezDeliveryCostKobo(ENV, "Kano")).rejects.toThrow("unusable delivery cost");
  });

  it("fails when Fez can't be reached", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(getFezDeliveryCostKobo(ENV, "Kano")).rejects.toThrow("Could not reach Fez");
  });

  it("needs a state", async () => {
    await expect(getFezDeliveryCostKobo(ENV, "  ")).rejects.toThrow("state is required");
  });
});

describe("resolveShippingFeeKobo", () => {
  it("returns the Fez quote when configured", async () => {
    fetchMock.mockResolvedValueOnce(authResponse()).mockResolvedValueOnce(costResponse());
    expect(await resolveShippingFeeKobo(ENV, "Kano")).toBe(645000);
  });

  it("returns undefined without calling Fez when it isn't configured", async () => {
    expect(await resolveShippingFeeKobo({}, "Kano")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined when there is no state yet", async () => {
    expect(await resolveShippingFeeKobo(ENV, "")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined instead of throwing when Fez fails, and never logs the password", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    expect(await resolveShippingFeeKobo(ENV, "Kano")).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("pw");
  });
});