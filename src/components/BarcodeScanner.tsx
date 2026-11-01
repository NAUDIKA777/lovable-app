import { useEffect, useRef, useState } from "react";
import { CameraOff, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ErrorKind = "denied" | "nocamera" | "other";

export function BarcodeScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const [error, setError] = useState<ErrorKind | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState("");
  const done = useRef(false);

  useEffect(() => {
    let scanner: { stop: () => Promise<void> } | null = null;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const s = new Html5Qrcode("sw-scanner");
        scanner = s;
        await s.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 260, height: 140 } },
          (text) => {
            if (done.current) return;
            done.current = true;
            s.stop().catch(() => {}).finally(() => onScan(text.trim()));
          },
          () => {},
        );
      } catch (e) {
        if (cancelled) return;
        const msg = `${(e as Error)?.name ?? ""} ${(e as Error)?.message ?? e}`;
        setError(/Permission|NotAllowed|denied/i.test(msg) ? "denied" : /NotFound|no camera|Requested device/i.test(msg) ? "nocamera" : "other");
      }
    })();
    return () => {
      cancelled = true;
      if (scanner && !done.current) scanner.stop().catch(() => {});
    };
  }, [onScan, attempt]);

  const code = manual.replace(/\s/g, "");

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background">
      <div className="flex items-center justify-between p-4">
        <h2 className="font-display text-lg">Scan barcode</h2>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      {error ? (
        <div role="alert" className="mx-4 space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-destructive/15 text-destructive"><CameraOff className="size-5" /></span>
            <h3 className="font-display text-base leading-tight">
              {error === "denied" ? "Camera access is blocked" : error === "nocamera" ? "No camera found" : "Camera didn't start"}
            </h3>
          </div>

          {error === "denied" ? (
            <>
              <p className="text-sm text-muted-foreground">Chrome is blocking the camera for this app. To allow it:</p>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>Tap the <strong>settings icon</strong> (or lock icon) at the left of Chrome's address bar.</li>
                <li>Tap <strong>Permissions</strong>, then <strong>Camera</strong>.</li>
                <li>Choose <strong>Allow</strong>.</li>
                <li>Come back here and tap <strong>Try again</strong>.</li>
              </ol>
              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer text-foreground">Still blocked? Or using the home-screen app?</summary>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5">
                  <li>Open Chrome ⋮ menu → <strong>Settings</strong> → <strong>Site settings</strong> → <strong>Camera</strong>.</li>
                  <li>Make sure Camera is on, and this site isn't under <strong>Blocked</strong>.</li>
                  <li>If Chrome itself is blocked: Android <strong>Settings</strong> → <strong>Apps</strong> → <strong>Chrome</strong> → <strong>Permissions</strong> → <strong>Camera</strong> → <strong>Allow</strong>.</li>
                </ol>
              </details>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {error === "nocamera" ? "This device has no rear camera available." : "Another app may be using the camera. Close it and try again."}
            </p>
          )}

          <Button className="h-11 w-full rounded-xl" onClick={() => setAttempt((n) => n + 1)}><RotateCcw /> Try again</Button>
        </div>
      ) : (
        <div id="sw-scanner" key={attempt} className="mx-4 overflow-hidden rounded-xl bg-card" />
      )}

      <form
        className="mx-4 mt-4 space-y-2"
        onSubmit={(e) => { e.preventDefault(); if (code) { done.current = true; onScan(code); } }}
      >
        <p className="text-sm text-muted-foreground">{error ? "Or type the barcode number:" : "Point the rear camera at the barcode, or type it:"}</p>
        <div className="flex gap-2">
          <Input inputMode="numeric" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="e.g. 012345678905" />
          <Button type="submit" variant="secondary" disabled={!code}>Use</Button>
        </div>
      </form>
    </div>
  );
}
