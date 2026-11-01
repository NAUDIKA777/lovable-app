import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Lock, Plus, Package } from "lucide-react";
import { getLockState, lock } from "@/lib/auth.functions";
import { listProducts } from "@/lib/products.functions";
import { PinScreen } from "@/components/PinScreen";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Strutworthy Companion — Inventory" },
      { name: "description", content: "Private inventory and listing tool." },
      { property: "og:title", content: "Strutworthy Companion" },
      { property: "og:description", content: "Private inventory and listing tool." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: async () => {
    const { unlocked } = await getLockState();
    if (!unlocked) return { unlocked: false as const, products: [] };
    return { unlocked: true as const, products: await listProducts() };
  },
  component: Home,
});

const statusStyle: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  ready: "bg-accent text-accent-foreground",
  listed: "bg-primary text-primary-foreground",
  sold: "bg-success text-success-foreground",
};

function Home() {
  const { unlocked, products } = Route.useLoaderData();
  const router = useRouter();
  const lockFn = useServerFn(lock);
  if (!unlocked) return <PinScreen />;

  return (
    <main className="mx-auto min-h-dvh max-w-md pb-28">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="font-display text-lg leading-none">Inventory</h1>
          <p className="text-xs text-muted-foreground">{products.length} listings</p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => { await lockFn(); await router.invalidate(); }}>
          <Lock className="size-4" /> Lock
        </Button>
      </header>
      {products.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-24 text-center text-muted-foreground">
          <Package className="size-10" />
          <p>No listings yet. Tap + to add your first product.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 p-4">
          {products.map((p) => (
            <li key={p.id}>
              <Link to="/listing/$id" params={{ id: p.id }} className="block overflow-hidden rounded-2xl border border-border bg-card shadow-card active:scale-[0.98] transition-transform">
                <div className="aspect-square bg-studio">
                  {p.image_url ? <img src={p.image_url} alt={p.title} className="size-full object-contain" loading="lazy" /> : <div className="flex size-full items-center justify-center text-muted-foreground"><Package /></div>}
                </div>
                <div className="space-y-1 p-3">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">{p.title || "Untitled"}</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-display">{p.price != null ? `$${Number(p.price).toFixed(2)}` : "—"}</span>
                    <span className="text-muted-foreground">Qty {p.quantity}</span>
                  </div>
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusStyle[p.status] ?? ""}`}>{p.status}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/listing/$id" params={{ id: "new" }} aria-label="Add listing" className="fixed bottom-6 right-6 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-glow">
        <Plus className="size-7" />
      </Link>
    </main>
  );
}
