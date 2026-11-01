import { createFileRoute } from "@tanstack/react-router";
import { handleAppBarcode } from "@/lib/app-api.server";

export const Route = createFileRoute("/api/app/barcode/$code")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleAppBarcode(request, params.code),
    },
  },
});
