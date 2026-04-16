import type { Env } from "./env.js";
import { getLimits } from "./env.js";

function matchOrigin(allowed: string[], origin: string | null): string | null {
  if (!origin) return null;
  for (const pattern of allowed) {
    if (pattern === "*") return "*";
    if (pattern === origin) return origin;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (origin.startsWith(prefix)) return origin;
    }
    if (pattern.includes("*")) {
      const re = new RegExp(
        "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      if (re.test(origin)) return origin;
    }
  }
  return null;
}

export function corsHeaders(request: Request, env: Env): HeadersInit {
  const { allowedOrigins } = getLimits(env);
  const origin = request.headers.get("Origin");
  const allow = matchOrigin(allowedOrigins, origin);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allow) headers["Access-Control-Allow-Origin"] = allow;
  return headers;
}

export function handlePreflight(request: Request, env: Env): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
