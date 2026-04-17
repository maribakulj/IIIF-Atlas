import type { Env } from "./env.js";

export type RouteHandler = (
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, (m) => {
          keys.push(m.slice(1));
          return "([^/]+)";
        }) +
        "/?$",
    );
    this.routes.push({ method: method.toUpperCase(), pattern, keys, handler });
    return this;
  }

  get(p: string, h: RouteHandler) {
    return this.add("GET", p, h);
  }
  post(p: string, h: RouteHandler) {
    return this.add("POST", p, h);
  }
  patch(p: string, h: RouteHandler) {
    return this.add("PATCH", p, h);
  }
  del(p: string, h: RouteHandler) {
    return this.add("DELETE", p, h);
  }

  async handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1] ?? "");
      });
      return r.handler(req, env, ctx, params);
    }
    return null;
  }
}
