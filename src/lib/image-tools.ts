// Browser-only canvas helpers. Only call from event handlers / effects.
import { packLayout } from "./listing-rules";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function canvasOf(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

/** Downscale a File to max `maxDim` px JPEG Blob. */
export async function downscaleFile(file: File, maxDim = 1536): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = canvasOf(img.width * s, img.height * s);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Re-encode any image src to JPEG data URL capped at maxDim. */
export async function toJpegDataUrl(src: string, maxDim = 1200): Promise<string> {
  const img = await loadImage(src);
  const s = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = canvasOf(img.width * s, img.height * s);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.88);
}

/** Bounding box of non-white pixels. */
function trimBox(img: HTMLImageElement) {
  const c = canvasOf(img.width, img.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i]! < 238 || data[i + 1]! < 238 || data[i + 2]! < 238) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height, canvas: c };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, canvas: c };
}

/** Cutout with white made transparent so copies can overlap cleanly. */
function cutout(img: HTMLImageElement) {
  const box = trimBox(img);
  const c = canvasOf(box.w, box.h);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(box.canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const m = Math.min(d.data[i]!, d.data[i + 1]!, d.data[i + 2]!);
    if (m > 246) d.data[i + 3] = 0;
    else if (m > 232) d.data[i + 3] = Math.round(((246 - m) / 14) * 255);
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** Build a 2/3/4-pack studio composite from the single-unit base image. */
export async function buildPackComposite(baseSrc: string, count: number, size = 1200): Promise<string> {
  const img = await loadImage(baseSrc);
  const piece = cutout(img);
  const c = canvasOf(size, size);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  for (const slot of packLayout(count, size, piece.width, piece.height)) {
    // contact shadow
    const g = ctx.createRadialGradient(slot.x + slot.w / 2, slot.y + slot.h, 0, slot.x + slot.w / 2, slot.y + slot.h, slot.w * 0.55);
    g.addColorStop(0, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(slot.x + slot.w / 2, slot.y + slot.h);
    ctx.scale(1, 0.12);
    ctx.translate(-(slot.x + slot.w / 2), -(slot.y + slot.h));
    ctx.fillStyle = g;
    ctx.fillRect(slot.x - slot.w * 0.1, slot.y + slot.h - slot.w * 0.6, slot.w * 1.2, slot.w * 1.2);
    ctx.restore();
    ctx.drawImage(piece, slot.x, slot.y, slot.w, slot.h);
  }
  return c.toDataURL("image/jpeg", 0.9);
}
