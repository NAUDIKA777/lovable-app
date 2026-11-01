import { createFileRoute } from "@tanstack/react-router";
import { editImage } from "@/lib/image-gateway.server";
import { isUnlocked } from "@/lib/session.server";

const PROMPT =
  "Keep the exact product completely unchanged — same shape, label, colors, text and proportions. " +
  "Remove the original background and place the product centered on a seamless pure white (#FFFFFF) studio background " +
  "with soft even studio lighting and a subtle natural contact shadow directly beneath it. Professional e-commerce product photo. No props, no text.";

export const Route = createFileRoute("/api/studio-photo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isUnlocked())) return new Response("Locked", { status: 401 });
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        const incoming = await request.formData();
        const image = incoming.get("image");
        if (!(image instanceof File)) return new Response("Photo required", { status: 400 });
        if (image.size > 10 * 1024 * 1024) return new Response("Photo too large (10MB max)", { status: 413 });
        const form = new FormData();
        form.set("image", image);
        form.set("prompt", PROMPT);
        form.set("size", "1024x1024");
        form.set("stream", String(incoming.get("stream") ?? "true"));
        const upstream = await editImage(apiKey, form);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
