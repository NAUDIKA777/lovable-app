import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUnlocked } from "./session.server";
import { packageWeight, titleForPack, type LookupResult } from "./listing-rules";

async function admin() {
  await requireUnlocked();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const LIST_COLS = "id,title,price,quantity,status,image_url,pack_count,updated_at";

export const listProducts = createServerFn({ method: "GET" }).handler(async () => {
  const db = await admin();
  const { data, error } = await db.from("products").select(LIST_COLS).order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
});

export const getProduct = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: row, error } = await db.from("products").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

const productSchema = z.object({
  id: z.string().uuid().optional(),
  barcode: z.string().max(64).default(""),
  base_title: z.string().max(300).default(""),
  description: z.string().max(10000).default(""),
  brand: z.string().max(200).default(""),
  category: z.string().max(200).default(""),
  size: z.string().max(100).default(""),
  price: z.number().nonnegative().nullable(),
  quantity: z.number().int().nonnegative(),
  status: z.enum(["draft", "ready", "listed", "sold"]),
  base_image_url: z.string().max(4_000_000).nullable(),
  image_url: z.string().max(4_000_000).nullable(),
  pack_count: z.number().int().min(1).max(4),
  unit_weight_oz: z.number().nonnegative().nullable(),
});

export const saveProduct = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => productSchema.parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const row = {
      ...data,
      barcode: data.barcode || null,
      title: titleForPack(data.base_title, data.pack_count),
      package_weight_oz: packageWeight(data.unit_weight_oz, data.pack_count),
      updated_at: new Date().toISOString(),
    };
    const { id, ...rest } = row;
    const q = id ? db.from("products").update(rest).eq("id", id).select("id").single() : db.from("products").insert(rest).select("id").single();
    const { data: saved, error } = await q;
    if (error) throw new Error(error.message);
    return { id: saved.id as string };
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { error } = await db.from("products").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const lookupBarcode = createServerFn({ method: "POST" })
  .inputValidator((d: { code: string }) => z.object({ code: z.string().regex(/^[0-9A-Za-z-]{4,32}$/) }).parse(d))
  .handler(async ({ data }): Promise<{ result: LookupResult | null; notice: string | null }> => {
    await requireUnlocked();
    const key = process.env["BARCODE_API_KEY"];
    if (!key) return { result: null, notice: "Barcode lookup isn't set up yet — barcode saved, fill details by hand." };
    const provider = (process.env["BARCODE_PROVIDER"] ?? "go-upc").toLowerCase();
    try {
      if (provider === "barcodespider") {
        const r = await fetch(`https://api.barcodespider.com/v1/lookup?upc=${encodeURIComponent(data.code)}`, { headers: { token: key } });
        if (!r.ok) return { result: null, notice: "No match found — fill details by hand." };
        const j = (await r.json()) as { item_attributes?: Record<string, string> };
        const a = j.item_attributes;
        if (!a?.["title"]) return { result: null, notice: "No match found — fill details by hand." };
        return { result: { title: a["title"], description: a["description"], brand: a["brand"], category: a["category"], imageUrl: a["image"] }, notice: null };
      }
      const r = await fetch(`https://go-upc.com/api/v1/code/${encodeURIComponent(data.code)}`, { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return { result: null, notice: "No match found — fill details by hand." };
      const j = (await r.json()) as { product?: { name?: string; description?: string; brand?: string; category?: string; imageUrl?: string } };
      const p = j.product;
      if (!p?.name) return { result: null, notice: "No match found — fill details by hand." };
      return { result: { title: p.name, description: p.description, brand: p.brand, category: p.category, imageUrl: p.imageUrl }, notice: null };
    } catch (e) {
      console.error("barcode lookup failed", e);
      return { result: null, notice: "Lookup unavailable right now — barcode saved." };
    }
  });

/** Fetch a remote catalog photo server-side and return a data URL (avoids canvas CORS taint). */
export const fetchImageAsDataUrl = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string }) => z.object({ url: z.string().url().startsWith("https://").or(z.string().url().startsWith("http://")) }).parse(d))
  .handler(async ({ data }) => {
    await requireUnlocked();
    const r = await fetch(data.url);
    if (!r.ok) return { dataUrl: null };
    const type = r.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return { dataUrl: null };
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 8_000_000) return { dataUrl: null };
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { dataUrl: `data:${type};base64,${btoa(bin)}` };
  });
