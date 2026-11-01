import { describe, expect, it } from "vitest";
import {
  applyNewBaseImage, applyPackCount, isValidPinShape, mergeLookup, packageWeight, packLayout,
  sanitizePin, shouldApplyComposite, titleForPack,
} from "@/lib/listing-rules";
import { signToken, timingSafeEqualStr, verifyToken } from "@/lib/session.server";

describe("PIN", () => {
  it("strips non-digits and caps at 6", () => expect(sanitizePin("12a3-45 678")).toBe("123456"));
  it("requires exactly 6 digits", () => {
    expect(isValidPinShape("12345")).toBe(false);
    expect(isValidPinShape("123456")).toBe(true);
  });
  it("rejects a wrong PIN", async () => {
    expect(await timingSafeEqualStr("111111", "123456")).toBe(false);
    expect(await timingSafeEqualStr("123456", "123456")).toBe(true);
  });
  it("unlock token expires and rejects tampering", async () => {
    const now = Date.now();
    const t = await signToken("s3cret", now + 30 * 864e5);
    expect(await verifyToken("s3cret", t, now)).toBe(true);
    expect(await verifyToken("s3cret", t, now + 31 * 864e5)).toBe(false);
    expect(await verifyToken("other", t, now)).toBe(false);
    expect(await verifyToken("s3cret", undefined, now)).toBe(false); // locked (cookie cleared)
  });
});

describe("package weight", () => {
  it.each([[1, 4.5], [2, 9], [3, 13.5], [4, 18]])("pack of %i → %f oz", (n, w) => expect(packageWeight(4.5, n)).toBe(w));
  it("null without unit weight", () => expect(packageWeight(null, 3)).toBeNull());
});

describe("title suffix", () => {
  it("replaces instead of doubling", () => {
    const three = titleForPack("Hair Gel", 3);
    expect(three).toBe("Hair Gel (Pack of 3)");
    expect(titleForPack(three, 2)).toBe("Hair Gel (Pack of 2)");
    expect(titleForPack("Hair Gel (Pack of 3) (Pack of 3)", 4)).toBe("Hair Gel (Pack of 4)");
    expect(titleForPack(three, 1)).toBe("Hair Gel");
  });
});

describe("pack composite layout", () => {
  it.each([2, 3, 4])("%i copies fit inside the canvas, staggered", (n) => {
    const slots = packLayout(n, 1200, 300, 600);
    expect(slots).toHaveLength(n);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(1200);
      expect(s.y + s.h).toBeLessThanOrEqual(1200);
    }
    expect(slots[1]!.x).toBeGreaterThan(slots[0]!.x);
    expect(slots[1]!.y).not.toBe(slots[0]!.y);
  });
});

describe("pack count across new photos", () => {
  it("keeps 3-pack when a new studio photo arrives and asks to regenerate", () => {
    const next = applyNewBaseImage({ packCount: 3, baseImage: "old", mainImage: "old-comp" }, "new");
    expect(next.packCount).toBe(3);
    expect(next.baseImage).toBe("new");
    expect(next.needsComposite).toBe(true);
  });
  it("switching to Single restores the plain photo", () => {
    const next = applyPackCount({ packCount: 3, baseImage: "base", mainImage: "comp" }, 1);
    expect(next.mainImage).toBe("base");
    expect(next.needsComposite).toBe(false);
  });
  it("drops stale composites", () => {
    expect(shouldApplyComposite({ packCount: 3, baseImage: "a" }, { packCount: 2, baseImage: "a" })).toBe(false);
    expect(shouldApplyComposite({ packCount: 3, baseImage: "a" }, { packCount: 3, baseImage: "b" })).toBe(false);
    expect(shouldApplyComposite({ packCount: 3, baseImage: "a" }, { packCount: 3, baseImage: "a" })).toBe(true);
  });
});

describe("barcode lookup merge", () => {
  const typed = { barcode: "", baseTitle: "My title", description: "Mine", brand: "", category: "" };
  it("missing credentials/no result keeps typed data and the barcode", () => {
    expect(mergeLookup(typed, "0123456789012", null)).toEqual({ ...typed, barcode: "0123456789012" });
  });
  it("result prefills but empty fields don't wipe typed values", () => {
    const m = mergeLookup(typed, "1", { title: "Catalog", description: "", brand: "Acme" });
    expect(m).toMatchObject({ barcode: "1", baseTitle: "Catalog", description: "Mine", brand: "Acme" });
  });
});
