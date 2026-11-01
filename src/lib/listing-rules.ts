// Pure, browser-and-server-safe listing rules. Covered by src/test/listing-rules.test.ts.

export type PackCount = 1 | 2 | 3 | 4;
export const PACK_COUNTS: PackCount[] = [1, 2, 3, 4];
export const PIN_LENGTH = 6;
export const SESSION_DAYS = 30;

/** Strip non-digits and clamp to 6 characters. */
export function sanitizePin(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

export function isValidPinShape(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

/** Package weight = unit weight × pack count, rounded to 2 decimals. */
export function packageWeight(unitWeightOz: number | null | undefined, packCount: number): number | null {
  if (unitWeightOz == null || !Number.isFinite(unitWeightOz)) return null;
  return Math.round(unitWeightOz * packCount * 100) / 100;
}

const SUFFIX_RE = /\s*\(Pack of \d+\)\s*$/i;

/** Remove any trailing "(Pack of N)" suffixes (handles accidental doubles). */
export function stripPackSuffix(title: string): string {
  let t = title;
  while (SUFFIX_RE.test(t)) t = t.replace(SUFFIX_RE, "");
  return t.trim();
}

/** Build the display title from the base title and pack count. */
export function titleForPack(baseTitle: string, packCount: number): string {
  const base = stripPackSuffix(baseTitle);
  return packCount > 1 ? `${base} (Pack of ${packCount})` : base;
}

export type ImageState = {
  packCount: PackCount;
  baseImage: string | null;
  mainImage: string | null;
};

/**
 * A new studio-white photo arrived. Keep the chosen pack count; for packs, the
 * main image must be regenerated from the new base (needsComposite = true).
 */
export function applyNewBaseImage(state: ImageState, newBase: string): ImageState & { needsComposite: boolean } {
  return {
    packCount: state.packCount,
    baseImage: newBase,
    mainImage: newBase,
    needsComposite: state.packCount > 1,
  };
}

/** Change pack count. Single restores the plain base photo. */
export function applyPackCount(state: ImageState, packCount: PackCount): ImageState & { needsComposite: boolean } {
  if (packCount === 1) return { packCount, baseImage: state.baseImage, mainImage: state.baseImage, needsComposite: false };
  return { ...state, packCount, needsComposite: state.baseImage != null };
}

/** Race guard: only apply a composite if nothing changed since the request began. */
export function shouldApplyComposite(
  requested: { packCount: number; baseImage: string | null },
  current: { packCount: number; baseImage: string | null },
): boolean {
  return requested.packCount === current.packCount && requested.baseImage === current.baseImage && current.packCount > 1;
}

export type LookupResult = {
  title?: string | undefined;
  description?: string | undefined;
  brand?: string | undefined;
  category?: string | undefined;
  imageUrl?: string | undefined;
};

export type FormFields = {
  barcode: string;
  baseTitle: string;
  description: string;
  brand: string;
  category: string;
};

/**
 * Merge a barcode lookup into the form. Never drops the scanned barcode, and a
 * missing/failed lookup (null) leaves everything the user typed intact.
 */
export function mergeLookup<T extends FormFields>(form: T, barcode: string, result: LookupResult | null): T {
  const next = { ...form, barcode };
  if (!result) return next;
  return {
    ...next,
    baseTitle: result.title?.trim() || form.baseTitle,
    description: result.description?.trim() || form.description,
    brand: result.brand?.trim() || form.brand,
    category: result.category?.trim() || form.category,
  };
}

/** Horizontal staggered layout for N copies inside a square canvas. */
export function packLayout(count: number, canvasSize: number, itemW: number, itemH: number) {
  const pad = canvasSize * 0.08;
  const usableW = canvasSize - pad * 2;
  const usableH = canvasSize - pad * 2;
  const overlap = 0.28; // each copy overlaps the previous by 28%
  const totalUnits = 1 + (count - 1) * (1 - overlap);
  const staggerY = 0.06;
  const scale = Math.min(usableW / (itemW * totalUnits), usableH / (itemH * (1 + staggerY * (count - 1))));
  const w = itemW * scale;
  const h = itemH * scale;
  const groupW = w * totalUnits;
  const groupH = h * (1 + staggerY * (count - 1));
  const startX = (canvasSize - groupW) / 2;
  const startY = (canvasSize - groupH) / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: startX + i * w * (1 - overlap),
    // back copies sit higher; front (last) copy is lowest
    y: startY + (count - 1 - i) * 0 + i * h * staggerY,
    w,
    h,
  }));
}
