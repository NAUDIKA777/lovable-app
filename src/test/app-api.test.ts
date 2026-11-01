import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAppBarcode, handleAppUnlock, resetAppApiState } from "@/lib/app-api.server";
import { resetAmazonState } from "@/lib/amazon-catalog.server";
import { signToken } from "@/lib/session.server";

const ENV = {
  ADMIN_PIN: "123456",
  SESSION_SECRET: "s3cret",
  SPAPI_LWA_CLIENT_ID: "id",
  SPAPI_LWA_CLIENT_SECRET: "secret",
  SPAPI_REFRESH_TOKEN: "refresh",
};
const MP = "ATVPDKIKX0DER";
const ITEM = {
  asin: "B000TEST01",
  summaries: [
    {
      marketplaceId: MP,
      itemName: "Test Widget",
      brand: "Acme",
      browseClassification: { displayName: "Gadgets" },
    },
  ],
  images: [
    {
      marketplaceId: MP,
      images: [{ variant: "MAIN", link: "https://img/main.jpg", width: 1000, height: 1000 }],
    },
  ],
};
const amazon = (items: unknown[] = [ITEM], status = 200) =>
  vi.fn(async (input: URL | string | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === "api.amazon.com")
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }));
    return new Response(JSON.stringify({ items }), { status });
  }) as unknown as typeof fetch;

const unlockReq = (pin: unknown, ip = "1.1.1.1") =>
  new Request("https://x/api/app/unlock", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify({ pin }),
  });
const barcodeReq = (token?: string) =>
  new Request("https://x/api/app/barcode/036000291452", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

async function getToken() {
  const res = await handleAppUnlock(unlockReq("123456"), ENV);
  return ((await res.json()) as { token: string }).token;
}

beforeEach(() => {
  resetAppApiState();
  resetAmazonState();
});

describe("POST unlock", () => {
  it("right PIN returns a token and an expiry about 30 days out", async () => {
    const now = Date.now();
    const res = await handleAppUnlock(unlockReq("123456"), ENV, now);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(body.token).toMatch(/^\d+\.[\w-]+$/);
    expect(body.expiresAt).toBe(now + 30 * 864e5);
  });
  it("accepts a PIN typed with spaces or dashes", async () => {
    expect((await handleAppUnlock(unlockReq("123-456"), ENV)).status).toBe(200);
  });
  it("wrong PIN -> 401, bad shape -> 400, bad JSON -> 400", async () => {
    expect((await handleAppUnlock(unlockReq("999999"), ENV)).status).toBe(401);
    expect((await handleAppUnlock(unlockReq("12"), ENV)).status).toBe(400);
    expect(
      (await handleAppUnlock(new Request("https://x/u", { method: "POST", body: "nope" }), ENV))
        .status,
    ).toBe(400);
  });
  it("locks out an IP after 5 wrong PINs, even for the right PIN, then recovers", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++)
      expect((await handleAppUnlock(unlockReq("000000", "9.9.9.9"), ENV, now)).status).toBe(401);
    const locked = await handleAppUnlock(unlockReq("123456", "9.9.9.9"), ENV, now + 1000);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await handleAppUnlock(unlockReq("123456", "8.8.8.8"), ENV, now)).status).toBe(200); // other IPs unaffected
    expect(
      (await handleAppUnlock(unlockReq("123456", "9.9.9.9"), ENV, now + 16 * 60_000)).status,
    ).toBe(200);
  });
  it("500 when ADMIN_PIN or SESSION_SECRET is missing", async () => {
    expect(
      (await handleAppUnlock(unlockReq("123456"), { ...ENV, ADMIN_PIN: undefined })).status,
    ).toBe(500);
    expect(
      (await handleAppUnlock(unlockReq("123456"), { ...ENV, SESSION_SECRET: undefined })).status,
    ).toBe(500);
  });
});

describe("GET barcode", () => {
  it("no token, junk token, expired token -> 401 and Amazon is never called", async () => {
    const f = amazon();
    const expired = await signToken("s3cret:android-app", Date.now() - 1000);
    expect((await handleAppBarcode(barcodeReq(), "036000291452", ENV, f)).status).toBe(401);
    expect((await handleAppBarcode(barcodeReq("junk"), "036000291452", ENV, f)).status).toBe(401);
    expect((await handleAppBarcode(barcodeReq(expired), "036000291452", ENV, f)).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
  it("the website's cookie token cannot be used as an app token", async () => {
    const webToken = await signToken("s3cret", Date.now() + 864e5);
    expect(
      (await handleAppBarcode(barcodeReq(webToken), "036000291452", ENV, amazon())).status,
    ).toBe(401);
  });
  it("valid token -> found product JSON", async () => {
    const res = await handleAppBarcode(barcodeReq(await getToken()), "036000291452", ENV, amazon());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      found: true,
      barcode: "036000291452",
      title: "Test Widget",
      brand: "Acme",
      category: "Gadgets",
      imageUrl: "https://img/main.jpg",
    });
  });
  it("no listing -> 404 with a message", async () => {
    const res = await handleAppBarcode(
      barcodeReq(await getToken()),
      "036000291452",
      ENV,
      amazon([]),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      found: false,
      message: expect.stringContaining("No Amazon listing"),
    });
  });
  it("bad check digit -> 400", async () => {
    expect(
      (await handleAppBarcode(barcodeReq(await getToken()), "036000291453", ENV, amazon())).status,
    ).toBe(400);
  });
  it("Amazon secrets missing -> 503; Amazon failing -> 502", async () => {
    const token = await getToken();
    const noCreds = { ...ENV, SPAPI_REFRESH_TOKEN: undefined };
    expect(
      (await handleAppBarcode(barcodeReq(token), "036000291452", noCreds, amazon())).status,
    ).toBe(503);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      (await handleAppBarcode(barcodeReq(token), "036000291452", ENV, amazon([], 403))).status,
    ).toBe(502);
  });
  it("never echoes secrets in responses", async () => {
    const res = await handleAppBarcode(barcodeReq(await getToken()), "036000291452", ENV, amazon());
    const text = await res.text();
    for (const s of ["s3cret", "refresh", "123456"]) expect(text).not.toContain(s);
  });
});
