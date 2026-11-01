import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";
import { unlock } from "@/lib/auth.functions";
import { sanitizePin } from "@/lib/listing-rules";
import { Button } from "@/components/ui/button";

export function PinScreen() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unlockFn = useServerFn(unlock);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length !== 6) return setError("Enter all 6 digits.");
    setBusy(true);
    setError(null);
    try {
      const r = await unlockFn({ data: { pin } });
      if (!r.ok) {
        setError(r.error);
        setPin("");
      } else await router.invalidate();
    } catch {
      setError("Couldn't check the PIN. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-hero px-6">
      <div className="text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-glow">
          <Lock className="size-6" />
        </div>
        <h1 className="font-display text-2xl leading-tight">Strutworthy</h1>
        <p className="text-sm text-muted-foreground">Confidence in Motion — Companion</p>
      </div>
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <label htmlFor="pin" className="sr-only">6-digit PIN</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(sanitizePin(e.target.value)); setError(null); }}
          className="w-full rounded-2xl border border-input bg-card px-4 py-4 text-center font-display text-3xl tracking-[0.6em] outline-none focus:ring-2 focus:ring-ring"
          placeholder="••••••"
        />
        <div className="flex justify-center gap-2" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={`size-2 rounded-full ${i < pin.length ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>
        {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
        <Button type="submit" size="lg" className="h-12 w-full rounded-2xl text-base" disabled={busy || pin.length !== 6}>
          {busy ? "Checking…" : "Unlock"}
        </Button>
      </form>
    </main>
  );
}
