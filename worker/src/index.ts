import { handleApiRequest } from "./router.js";
import type { CanonicalSnapshot } from "../../schemas/index.js";

export interface Env {
  // Cloudflare KV or static asset binding if configured
  DATA_STORE?: KVNamespace;
  DATA_JSON?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // If request is not /api/v1/*, pass through or return 404
    if (!url.pathname.startsWith("/api/v1/")) {
      return new Response("Not found", { status: 404 });
    }

    let snapshot: CanonicalSnapshot | null = null;
    let historySnapshots: CanonicalSnapshot[] = [];

    // Load data from KV or embedded/fetch source
    try {
      if (env.DATA_STORE) {
        const currentRaw = await env.DATA_STORE.get("current.json");
        if (currentRaw) {
          snapshot = JSON.parse(currentRaw);
        }
      } else if (env.DATA_JSON) {
        snapshot = JSON.parse(env.DATA_JSON);
      } else {
        // Fallback: fetch static asset /data/current.json hosted on Pages
        const dataUrl = new URL("/data/current.json", request.url);
        const dataRes = await fetch(dataUrl.toString());
        if (dataRes.ok) {
          snapshot = await dataRes.json();
        }
      }
    } catch (err) {
      console.error("Failed to load canonical data in Worker:", err);
    }

    const apiRes = await handleApiRequest({
      snapshot,
      historySnapshots,
      requestUrl: request.url,
      method: request.method,
      corsOrigin: "*"
    });

    return new Response(apiRes.body, {
      status: apiRes.status,
      headers: apiRes.headers
    });
  }
};
