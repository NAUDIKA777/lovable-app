import type { LookupResult } from "./listing-rules";

/**
 * Amazon SP-API Catalog Items lookup (title, brand, category and photo only).
 * Server-only: it reads Amazon credentials from environment secrets.
 *
 * Secrets:  SPAPI_LWA_CLIENT_ID, SPAPI_LWA_CLIENT_SECRET, SPAPI_REFRESH_TOKEN
 * Optional: SPAPI_REGION (na | eu | fe, default na), SPAPI_MARKETPLACE_ID (default amazon.com)
 *           SPAPI_SANDBOX ("true" uses Amazon's sandbox with static test data)
 */

export type LookupOutcome = { result: LookupResult | null; notice: string | null };
export type Env = Record<string, string | undefined>;
type FetchFn = typeof fetch;

export const NOTICE_NOT_SET_UP =
  "Barcode lookup isn't set up yet — barcode saved, fill details by hand.";
export const NOTICE_NO_MATCH = "No match found — fill details by hand.";
export const NOTICE_UNAVAILABLE = "Lookup unavailable right now — barcode saved.";

const LWA_URL = "https://api.amazon.com/auth/o2/token";
const HOSTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const SANDBOX_HOSTS: Record<string, string> = {
  na: "https://sandbox.sellingpartnerapi-na.amazon.com",
  eu: "https://sandbox.sellingpartnerapi-eu.amazon.com",
  fe: "https://sandbox.sellingpartnerapi-fe.amazon.com",
};
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 15_000;

/** Thrown for failures worth logging; the caller turns them into a friendly notice. */
class AmazonError extends Error {}

let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

export function resetAmazonState() {
  tokenCache = null;
  tokenInFlight = null;
}

// --- Barcode handling -------------------------------------------------------

function hasValidCheckDigit(code: string): boolean {
  const digits = [...code].map(Number);
  const check = digits.pop();
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += digits[i]! * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Cleans a scanned code and lists the Catalog identifier types to try. null = not a catalog barcode. */
export function classifyBarcode(raw: string): { code: string; types: string[] } | null {
  const code = raw.trim().replace(/[\s-]/g, "").toUpperCase();
  if (/^(\d{10}|\d{9}X)$/.test(code)) return { code, types: ["ISBN"] };
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code) || !hasValidCheckDigit(code)) return null;
  switch (code.length) {
    case 8:
      return { code, types: ["EAN"] };
    case 12:
      return { code, types: ["UPC", "GTIN"] };
    case 13:
      return { code, types: /^97[89]/.test(code) ? ["ISBN", "EAN", "GTIN"] : ["EAN", "GTIN"] };
    default:
      return { code, types: ["GTIN"] };
  }
}

// --- Amazon calls -----------------------------------------------------------

type Cfg = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  marketplaceId: string;
  host: string;
};

function loadConfig(env: Env): Cfg | null {
  const clientId = env["SPAPI_LWA_CLIENT_ID"];
  const clientSecret = env["SPAPI_LWA_CLIENT_SECRET"];
  const refreshToken = env["SPAPI_REFRESH_TOKEN"];
  if (!clientId || !clientSecret || !refreshToken) return null;
  const region = (env["SPAPI_REGION"] || "na").toLowerCase();
  const hosts = (env["SPAPI_SANDBOX"] || "").toLowerCase() === "true" ? SANDBOX_HOSTS : HOSTS;
  return {
    clientId,
    clientSecret,
    refreshToken,
    marketplaceId: env["SPAPI_MARKETPLACE_ID"] || "ATVPDKIKX0DER",
    host: hosts[region] ?? hosts["na"]!,
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const backoff = (attempt: number) => 500 * 2 ** attempt + Math.floor(Math.random() * 250);

function getToken(cfg: Cfg, f: FetchFn): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000)
    return Promise.resolve(tokenCache.token);
  tokenInFlight ??= refreshToken(cfg, f).finally(() => {
    tokenInFlight = null;
  });
  return tokenInFlight;
}

async function refreshToken(cfg: Cfg, f: FetchFn): Promise<string> {
  const res = await f(LWA_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new AmazonError(
      `Amazon login (LWA) failed: ${body.error_description || body.error || `HTTP ${res.status}`}`,
    );
  }
  tokenCache = {
    token: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000,
  };
  return body.access_token;
}

async function spGet(cfg: Cfg, f: FetchFn, query: Record<string, string>): Promise<unknown> {
  const url = new URL(`${cfg.host}/catalog/2022-04-01/items`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  let refreshedOn401 = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const last = attempt === MAX_ATTEMPTS - 1;
    const token = await getToken(cfg, f);
    let res: Response;
    try {
      res = await f(url, {
        headers: {
          "x-amz-access-token": token,
          accept: "application/json",
          "user-agent": "ScreenshotPerfect/1.0 (Language=TypeScript)",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (!last) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new AmazonError(
        `Could not reach Amazon: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (res.ok) return res.json();
    if (res.status === 401 && !refreshedOn401) {
      refreshedOn401 = true;
      tokenCache = null;
      attempt--;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && !last) {
      await sleep(backoff(attempt));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as {
      errors?: { code?: string; message?: string }[];
    };
    const e = body.errors?.[0];
    const hint =
      res.status === 403 ? " (the SP-API app may lack the role needed for Catalog Items)" : "";
    throw new AmazonError(
      `Amazon catalog request failed: HTTP ${res.status}${e ? ` ${e.code}: ${e.message}` : ""}${hint}`,
    );
  }
  throw new AmazonError("Amazon lookup failed.");
}

// --- Response parsing ---------------------------------------------------------

type CatalogItem = {
  asin?: string;
  summaries?: {
    marketplaceId?: string;
    itemName?: string;
    brand?: string;
    browseClassification?: { displayName?: string };
  }[];
  images?: {
    marketplaceId?: string;
    images?: { variant?: string; link?: string; width?: number; height?: number }[];
  }[];
};

function forMarketplace<T extends { marketplaceId?: string }>(
  list: T[] | undefined,
  id: string,
): T | undefined {
  return list?.find((x) => x.marketplaceId === id) ?? list?.[0];
}

/** The largest MAIN image, falling back to the largest of any variant. */
function bestImage(item: CatalogItem, marketplaceId: string): string | undefined {
  const imgs = (forMarketplace(item.images, marketplaceId)?.images ?? []).filter((i) => i.link);
  const area = (i: { width?: number; height?: number }) => (i.width ?? 0) * (i.height ?? 0);
  const pick = (list: typeof imgs) => list.sort((a, b) => area(b) - area(a))[0]?.link;
  return pick(imgs.filter((i) => i.variant === "MAIN")) ?? pick([...imgs]);
}

export function toLookupResult(item: CatalogItem, marketplaceId: string): LookupResult | null {
  const s = forMarketplace(item.summaries, marketplaceId);
  const title = s?.itemName?.trim();
  if (!title) return null;
  return {
    title,
    brand: s?.brand?.trim() || undefined,
    category: s?.browseClassification?.displayName?.trim() || undefined,
    imageUrl: bestImage(item, marketplaceId),
  };
}

// --- Entry point ----------------------------------------------------------------

/** Looks up a scanned code on Amazon. Never throws: problems become a notice for the form. */
export async function lookupOnAmazon(
  rawCode: string,
  env: Env = process.env,
  f: FetchFn = fetch,
): Promise<LookupOutcome> {
  const cfg = loadConfig(env);
  if (!cfg) return { result: null, notice: NOTICE_NOT_SET_UP };

  const parsed = classifyBarcode(rawCode);
  if (!parsed) return { result: null, notice: NOTICE_NO_MATCH };

  try {
    for (const type of parsed.types) {
      const data = (await spGet(cfg, f, {
        identifiers: parsed.code,
        identifiersType: type,
        marketplaceIds: cfg.marketplaceId,
        includedData: "summaries,images",
      })) as { items?: CatalogItem[] };
      const item = data.items?.[0];
      if (item) {
        const result = toLookupResult(item, cfg.marketplaceId);
        return result ? { result, notice: null } : { result: null, notice: NOTICE_NO_MATCH };
      }
    }
    return { result: null, notice: NOTICE_NO_MATCH };
  } catch (e) {
    console.error("amazon barcode lookup failed", e instanceof Error ? e.message : e);
    return { result: null, notice: NOTICE_UNAVAILABLE };
  }
}
