<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- Private single-user app: every data read/write goes through PIN-gated server functions (`requireUnlocked` in src/lib/session.server.ts) using the service-role client; the `products` table has no client policies. Why: no user accounts, the signed HttpOnly cookie is the only gate.
- Listing rules (PIN shape, pack titles, package weight, pack/photo state) are pure functions in src/lib/listing-rules.ts, tested in src/test/listing-rules.test.ts. Why: business rules stay testable outside the UI.
- Canvas/photo helpers (src/lib/image-tools.ts) and the barcode scanner are dynamically imported in the browser only. Why: they break server rendering.
- Studio-photo cleanup streams through the server route /api/studio-photo, not a server function. Why: server functions can't stream images or accept multipart uploads.
- Photos are stored as JPEG data URLs on the product row; no storage buckets. Why: keeps photos private with no public URLs.
