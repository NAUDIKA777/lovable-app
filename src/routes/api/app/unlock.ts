import { createFileRoute } from "@tanstack/react-router";
import { handleAppUnlock } from "@/lib/app-api.server";

export const Route = createFileRoute("/api/app/unlock")({
  server: {
    handlers: {
      POST: ({ request }) => handleAppUnlock(request),
    },
  },
});
