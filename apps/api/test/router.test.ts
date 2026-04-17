import { describe, expect, it } from "vitest";
import { Router } from "../src/router.js";

function mkReq(method: string, path: string) {
  return new Request(`http://test.local${path}`, { method });
}

const dummyEnv = {} as never;
const dummyCtx = {} as never;

describe("Router", () => {
  it("matches a static GET", async () => {
    const router = new Router().get("/foo", () => new Response("ok"));
    const res = await router.handle(mkReq("GET", "/foo"), dummyEnv, dummyCtx);
    expect(res?.status).toBe(200);
  });

  it("extracts path params", async () => {
    let captured: Record<string, string> | null = null;
    const router = new Router().get("/items/:id", (_req, _env, _ctx, params) => {
      captured = params;
      return new Response("ok");
    });
    await router.handle(mkReq("GET", "/items/abc123"), dummyEnv, dummyCtx);
    expect(captured).toEqual({ id: "abc123" });
  });

  it("does not match a different method", async () => {
    const router = new Router().get("/foo", () => new Response("ok"));
    const res = await router.handle(mkReq("POST", "/foo"), dummyEnv, dummyCtx);
    expect(res).toBeNull();
  });

  it("does not match across path segments", async () => {
    const router = new Router().get("/items/:id", () => new Response("ok"));
    const res = await router.handle(mkReq("GET", "/items/abc/extra"), dummyEnv, dummyCtx);
    expect(res).toBeNull();
  });

  it("decodes percent-encoded params", async () => {
    let captured: Record<string, string> | null = null;
    const router = new Router().get("/items/:id", (_req, _env, _ctx, params) => {
      captured = params;
      return new Response("ok");
    });
    await router.handle(mkReq("GET", "/items/foo%20bar"), dummyEnv, dummyCtx);
    expect(captured?.id).toBe("foo bar");
  });
});
