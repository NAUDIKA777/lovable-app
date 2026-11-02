import type { CapacitorConfig } from "@capacitor/cli";

// This app is a thin Android shell around the published website (which needs its server,
// the PIN login and the Amazon lookup, so it can't be bundled as static files).
// CAP_SERVER_URL is the published site address, https only, for example https://your-site.lovable.app
const serverUrl = process.env["CAP_SERVER_URL"];
if (!serverUrl || !serverUrl.startsWith("https://")) {
  throw new Error("Set CAP_SERVER_URL to the published site address (https://...) before running cap sync/build.");
}

const config: CapacitorConfig = {
  appId: "com.strutworthy.scanner",
  appName: "Strutworthy Scanner",
  // Only shown if the site can't be reached; the app normally loads server.url.
  webDir: "android-shell",
  server: {
    url: serverUrl,
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
