import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTICE_NOT_SET_UP,
  NOTICE_NO_MATCH,
  NOTICE_UNAVAILABLE,
  classifyBarcode,
  lookupOnAmazon,
  resetAmazonState,
} from "@/lib/amazon-catalog.server";

const ENV = {
  SPAPI_LWA_CLIENT_ID: "id",
  SPAPI_LWA_CLIENT_SECRET: "secret",
  SPAPI_REFRESH_TOKEN: "refresh",
};
const MP = "ATVPDKIKX0DER";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ITEM = {
  asin: "B000TEST01",
  summaries: [
    {
      marketplaceId: MP,
      itemName: " Test Widget 3-Pack ",
      brand: "Acme",
      browseClassification: { displayName: "Gadgets" },
    },
  ],
  images: [
    {
      marketplaceId: MP,
      images: [
        { variant: "MAIN", link: "https://img/main-500.jpg", width: 500, height: 500 },
        { variant: "MAIN", link: "https://img/main-1000.jpg", width: 1000, height: 1000 },
        { variant: "PT01", link: "https://img/pt01-2000.jpg", width: 2000, height: 2000 },
      ],
    },
  ],
};

/** Fake Amazon: login endpoint plus a catalog endpoint answered by `catalog`. */
function amazon(catalog: (url: URL, init: RequestInit) => Response) {
  return vi.fn(async (input: URL | string | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host === "api.amazon.com") return json({ access_token: "tok", expires_in: 3600 });
    return catalog(url, init);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  resetAmazonState();
  vi.restoreAllMocks();
});

describe("classifyBarcode", () => {
  it("maps lengths to identifier types", () => {
    expect(classifyBarcode("036000291452")).toEqual({
      code: "036000291452",
      types: ["UPC", "GTIN"],
    });
    expect(classifyBarcode("4006381333931")?.types).toEqual(["EAN", "GTIN"]);
    expect(classifyBarcode("9780306406157")?.types).toEqual(["ISBN", "EAN", "GTIN"]);
    expect(classifyBarcode("0360-0029 1452")?.code).toBe("036000291452");
  });
  it("rejects bad check digits and non-product codes", () => {
    expect(classifyBarcode("036000291453")).toBeNull();
    expect(classifyBarcode("ABC-123")).toBeNull();
  });
});

describe("lookupOnAmazon", () => {
  it("returns title, brand, category and the largest MAIN image", async () => {
    const f = amazon((url, init) => {
      expect(url.searchParams.get("identifiers")).toBe("036000291452");
      expect(url.searchParams.get("identifiersType")).toBe("UPC");
      expect(url.searchParams.get("includedData")).toBe("summaries,images");
      expect((init.headers as Record<string, string>)["x-amz-access-token"]).toBe("tok");
      return json({ items: [ITEM] });
    });
    const out = await lookupOnAmazon("036000291452", ENV, f);
    expect(out).toEqual({
      notice: null,
      result: {
        title: "Test Widget 3-Pack",
        brand: "Acme",
        category: "Gadgets",
        imageUrl: "https://img/main-1000.jpg",
      },
    });
  });

  it("falls back to the next identifier type when the first has no match", async () => {
    const seen: string[] = [];
    const f = amazon((url) => {
      seen.push(url.searchParams.get("identifiersType")!);
      return json({ items: url.searchParams.get("identifiersType") === "GTIN" ? [ITEM] : [] });
    });
    const out = await lookupOnAmazon("036000291452", ENV, f);
    expect(seen).toEqual(["UPC", "GTIN"]);
    expect(out.result?.title).toBe("Test Widget 3-Pack");
  });

  it("no listing -> friendly no-match notice", async () => {
    const out = await lookupOnAmazon(
      "036000291452",
      ENV,
      amazon(() => json({ items: [] })),
    );
    expect(out).toEqual({ result: null, notice: NOTICE_NO_MATCH });
  });

  it("missing credentials -> not set up, and Amazon is never called", async () => {
    const f = amazon(() => json({}));
    const out = await lookupOnAmazon("036000291452", { SPAPI_LWA_CLIENT_ID: "id" }, f);
    expect(out).toEqual({ result: null, notice: NOTICE_NOT_SET_UP });
    expect(f).not.toHaveBeenCalled();
  });

  it("an invalid barcode never reaches Amazon", async () => {
    const f = amazon(() => json({}));
    expect((await lookupOnAmazon("036000291453", ENV, f)).notice).toBe(NOTICE_NO_MATCH);
    expect(f).not.toHaveBeenCalled();
  });

  it("retries a throttled request, then succeeds", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const f = amazon(() => (++calls === 1 ? json({ errors: [] }, 429) : json({ items: [ITEM] })));
    const p = lookupOnAmazon("036000291452", ENV, f);
    await vi.runAllTimersAsync();
    expect((await p).result?.title).toBe("Test Widget 3-Pack");
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("refreshes the token once on a 401, without using up a retry", async () => {
    let calls = 0;
    const f = amazon(() => (++calls === 1 ? json({}, 401) : json({ items: [ITEM] })));
    expect((await lookupOnAmazon("036000291452", ENV, f)).result?.title).toBe("Test Widget 3-Pack");
  });

  it("login failure -> unavailable notice, logged without secrets", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async () =>
      json({ error: "invalid_grant", error_description: "bad refresh token" }, 400),
    ) as unknown as typeof fetch;
    const out = await lookupOnAmazon("036000291452", ENV, f);
    expect(out).toEqual({ result: null, notice: NOTICE_UNAVAILABLE });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("bad refresh token");
    expect(logged).not.toContain("secret");
  });

  it("403 (missing role) -> unavailable notice with a hint in the log", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await lookupOnAmazon(
      "036000291452",
      ENV,
      amazon(() => json({ errors: [{ code: "Unauthorized", message: "Access denied" }] }, 403)),
    );
    expect(out.notice).toBe(NOTICE_UNAVAILABLE);
    expect(JSON.stringify(err.mock.calls)).toContain("may lack the role");
  });

  it("caches the access token across lookups", async () => {
    const f = amazon(() => json({ items: [ITEM] }));
    await lookupOnAmazon("036000291452", ENV, f);
    await lookupOnAmazon("036000291452", ENV, f);
    const logins = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) =>
      String(u).includes("api.amazon.com"),
    ).length;
    expect(logins).toBe(1);
  });

  it("an item with no title is treated as no match", async () => {
    const out = await lookupOnAmazon(
      "036000291452",
      ENV,
      amazon(() => json({ items: [{ asin: "X", summaries: [{ marketplaceId: MP }] }] })),
    );
    expect(out).toEqual({ result: null, notice: NOTICE_NO_MATCH });
  });
});
