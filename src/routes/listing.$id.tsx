import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useRef, useState } from "react";
import { ArrowLeft, Camera, ImageIcon, ScanBarcode, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getLockState } from "@/lib/auth.functions";
import { deleteProduct, fetchImageAsDataUrl, getProduct, lookupBarcode, saveProduct } from "@/lib/products.functions";
import {
  applyNewBaseImage, applyPackCount, mergeLookup, packageWeight, shouldApplyComposite, titleForPack,
  PACK_COUNTS, type PackCount, type ImageState,
} from "@/lib/listing-rules";
import { streamImage } from "@/lib/stream-image";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/listing/$id")({
  head: () => ({
    meta: [
      { title: "Edit listing — Strutworthy Companion" },
      { name: "description", content: "Create or edit a private product listing." },
      { property: "og:title", content: "Edit listing — Strutworthy Companion" },
      { property: "og:description", content: "Create or edit a private product listing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: async ({ params }) => {
    const { unlocked } = await getLockState();
    if (!unlocked) throw redirect({ to: "/" });
    if (params.id === "new") return { product: null };
    const product = await getProduct({ data: { id: params.id } });
    if (!product) throw redirect({ to: "/" });
    return { product };
  },
  component: ListingPage,
});

type Status = "draft" | "ready" | "listed" | "sold";
const STATUSES: Status[] = ["draft", "ready", "listed", "sold"];

function ListingPage() {
  const { product } = Route.useLoaderData();
  const navigate = useNavigate();
  const save = useServerFn(saveProduct);
  const del = useServerFn(deleteProduct);
  const lookup = useServerFn(lookupBarcode);
  const fetchImg = useServerFn(fetchImageAsDataUrl);

  const [f, setF] = useState({
    barcode: product?.barcode ?? "",
    baseTitle: product?.base_title ?? "",
    description: product?.description ?? "",
    brand: product?.brand ?? "",
    category: product?.category ?? "",
    size: product?.size ?? "",
    price: product?.price != null ? String(product.price) : "",
    quantity: String(product?.quantity ?? 1),
    status: (product?.status ?? "draft") as Status,
    unitWeight: product?.unit_weight_oz != null ? String(product.unit_weight_oz) : "",
  });
  const [img, setImg] = useState<ImageState>({
    packCount: (product?.pack_count ?? 1) as PackCount,
    baseImage: product?.base_image_url ?? null,
    mainImage: product?.image_url ?? null,
  });
  const imgRef = useRef(img);
  imgRef.current = img;
  const [preview, setPreview] = useState<{ src: string; final: boolean } | null>(null);
  const [studioBusy, setStudioBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const regenerate = useCallback(async (state: ImageState) => {
    if (!state.baseImage || state.packCount === 1) return;
    const requested = { packCount: state.packCount, baseImage: state.baseImage };
    setComposing(true);
    try {
      const { buildPackComposite } = await import("@/lib/image-tools");
      const out = await buildPackComposite(requested.baseImage, requested.packCount);
      if (shouldApplyComposite(requested, imgRef.current)) setImg((s) => ({ ...s, mainImage: out }));
    } catch {
      toast.error("Couldn't build the pack photo.");
    } finally {
      setComposing(false);
    }
  }, []);

  function applyBase(newBase: string) {
    const next = applyNewBaseImage(imgRef.current, newBase);
    imgRef.current = next;
    setImg(next);
    if (next.needsComposite) void regenerate(next);
  }

  function choosePack(n: PackCount) {
    const next = applyPackCount(imgRef.current, n);
    imgRef.current = next;
    setImg(next);
    if (next.needsComposite) void regenerate(next);
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast.error("That photo is too large."); return; }
    setStudioBusy(true);
    setPreview(null);
    try {
      const { downscaleFile, toJpegDataUrl } = await import("@/lib/image-tools");
      const blob = await downscaleFile(file, 1536);
      if (blob.size > 10 * 1024 * 1024) throw new Error("Photo too large after resizing (10MB max).");
      const form = new FormData();
      form.append("image", new File([blob], "photo.jpg", { type: "image/jpeg" }));
      let finalSrc = "";
      await streamImage("/api/studio-photo", form, (src, isFinal) => {
        setPreview({ src, final: isFinal });
        if (isFinal) finalSrc = src;
      });
      applyBase(await toJpegDataUrl(finalSrc, 1200));
      setPreview(null);
      toast.success("Studio photo ready");
    } catch (e) {
      setPreview(null);
      toast.error((e as Error).message.slice(0, 160) || "Photo cleanup failed.");
    } finally {
      setStudioBusy(false);
    }
  }

  const onScan = useCallback(async (code: string) => {
    setScanning(false);
    setF((s) => mergeLookup(s, code, null)); // barcode saved immediately
    setNotice("Looking up product…");
    try {
      const { result, notice } = await lookup({ data: { code } });
      setF((s) => mergeLookup(s, code, result));
      setNotice(notice);
      if (result?.imageUrl && !imgRef.current.baseImage) {
        const { dataUrl } = await fetchImg({ data: { url: result.imageUrl } });
        if (dataUrl) {
          const { toJpegDataUrl } = await import("@/lib/image-tools");
          applyBase(await toJpegDataUrl(dataUrl, 1200));
        }
      }
    } catch {
      setNotice("Lookup failed — barcode saved, fill details by hand.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const price = f.price.trim() === "" ? null : Number(f.price);
    if (f.status !== "draft" && (price == null || Number.isNaN(price))) { toast.error("Add a price before marking ready or listed."); return; }
    setSaving(true);
    try {
      const unit = f.unitWeight.trim() === "" ? null : Number(f.unitWeight);
      await save({
        data: {
          id: product?.id,
          barcode: f.barcode.trim(),
          base_title: f.baseTitle.trim(),
          description: f.description,
          brand: f.brand,
          category: f.category,
          size: f.size,
          price: price != null && !Number.isNaN(price) ? price : null,
          quantity: Math.max(0, Math.floor(Number(f.quantity) || 0)),
          status: f.status,
          base_image_url: img.baseImage,
          image_url: img.mainImage,
          pack_count: img.packCount,
          unit_weight_oz: unit != null && !Number.isNaN(unit) ? unit : null,
        },
      });
      toast.success("Saved");
      navigate({ to: "/" });
    } catch (err) {
      toast.error((err as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!product || !confirm("Delete this listing?")) return;
    await del({ data: { id: product.id } });
    navigate({ to: "/" });
  }


  const unitNum = f.unitWeight.trim() === "" ? null : Number(f.unitWeight);
  const pkgWeight = packageWeight(unitNum, img.packCount);
  const shown = preview?.src ?? img.mainImage;

  return (
    <main className="mx-auto min-h-dvh max-w-md pb-32">
      {scanning && <BarcodeScanner onScan={onScan} onClose={() => setScanning(false)} />}
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/90 px-2 py-2 backdrop-blur">
        <Button asChild variant="ghost" size="icon"><Link to="/" aria-label="Back"><ArrowLeft /></Link></Button>
        <h1 className="flex-1 font-display text-lg">{product ? "Edit listing" : "New listing"}</h1>
        {product && <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete}><Trash2 className="text-destructive" /></Button>}
      </header>

      <form onSubmit={onSave} className="space-y-6 p-4">
        <Button type="button" variant="secondary" className="h-12 w-full rounded-2xl" onClick={() => setScanning(true)}>
          <ScanBarcode /> Scan Barcode to Prefill
        </Button>
        {notice && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{notice}</p>}

        <section className="space-y-3">
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-studio">
            {shown ? (
              <img src={shown} alt="Product" className={`size-full object-contain transition-[filter] duration-500 ${preview && !preview.final ? "blur-2xl" : "blur-0"}`} />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 text-studio-muted"><ImageIcon className="size-8" /><span className="text-sm">No photo yet</span></div>
            )}
            {(studioBusy || composing) && (
              <span className="absolute bottom-3 left-3 rounded-full bg-foreground/80 px-3 py-1 text-xs text-background">{studioBusy ? "Cleaning up to studio white…" : "Building pack photo…"}</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-11 rounded-xl" disabled={studioBusy} onClick={() => cameraRef.current?.click()}><Camera /> Take Photo</Button>
            <Button type="button" variant="outline" className="h-11 rounded-xl" disabled={studioBusy} onClick={() => libraryRef.current?.click()}><ImageIcon /> From Library</Button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void handlePhoto(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={libraryRef} type="file" accept="image/*" hidden onChange={(e) => { void handlePhoto(e.target.files?.[0]); e.target.value = ""; }} />

          {img.baseImage && (
            <div>
              <Label className="mb-2 block">Pack quantity</Label>
              <div className="grid grid-cols-4 gap-2" role="radiogroup">
                {PACK_COUNTS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={img.packCount === n} onClick={() => choosePack(n)}
                    className={`rounded-xl border py-2 text-sm font-medium ${img.packCount === n ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
                    {n === 1 ? "1x Single" : `${n}-Pack`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        <Field label="Title"><Input value={f.baseTitle} onChange={set("baseTitle")} placeholder="Product title" /></Field>
        {img.packCount > 1 && <p className="-mt-4 text-xs text-muted-foreground">Listed as: {titleForPack(f.baseTitle, img.packCount)}</p>}
        <Field label="Description"><Textarea rows={5} value={f.description} onChange={set("description")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price ($)"><Input inputMode="decimal" value={f.price} onChange={set("price")} placeholder="0.00" /></Field>
          <Field label="Quantity"><Input inputMode="numeric" value={f.quantity} onChange={set("quantity")} /></Field>
          <Field label="Brand"><Input value={f.brand} onChange={set("brand")} /></Field>
          <Field label="Size"><Input value={f.size} onChange={set("size")} /></Field>
          <Field label="Category"><Input value={f.category} onChange={set("category")} /></Field>
          <Field label="Barcode (base unit)"><Input inputMode="numeric" value={f.barcode} onChange={set("barcode")} /></Field>
          <Field label="Unit weight (oz)"><Input inputMode="decimal" value={f.unitWeight} onChange={set("unitWeight")} /></Field>
          <Field label="Package weight (oz)"><Input readOnly value={pkgWeight ?? ""} placeholder="auto" className="bg-muted" /></Field>
        </div>
        <Field label="Status">
          <div className="grid grid-cols-4 gap-2">
            {STATUSES.map((s) => (
              <button key={s} type="button" onClick={() => setF((x) => ({ ...x, status: s }))}
                className={`rounded-xl border py-2 text-xs font-semibold uppercase tracking-wide ${f.status === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>{s}</button>
            ))}
          </div>
        </Field>

        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 p-4 backdrop-blur">
          <div className="mx-auto max-w-md">
            <Button type="submit" size="lg" className="h-12 w-full rounded-2xl text-base" disabled={saving || studioBusy || composing}>{saving ? "Saving…" : "Save listing"}</Button>
          </div>
        </div>
      </form>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
