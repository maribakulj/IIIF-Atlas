import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { devSignup } from "./helpers.js";

describe("POST /api/auth/dev-signup", () => {
  it("creates user, workspace, and a usable API key", async () => {
    const res = await SELF.fetch("http://test.local/api/auth/dev-signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `signup-${Date.now()}@test.local`,
        displayName: "Sign Up",
        workspaceName: "My Workspace",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { id: string; email: string };
      workspace: { id: string; name: string };
      apiKey: { secret: string; prefix: string };
    };
    expect(body.user.id).toBeTruthy();
    expect(body.workspace.name).toBe("My Workspace");
    expect(body.apiKey.secret.startsWith("iia_")).toBe(true);
    expect(body.apiKey.prefix).toBe(body.apiKey.secret.slice(0, 12));

    // The freshly minted key should authenticate /api/auth/me.
    const me = await SELF.fetch("http://test.local/api/auth/me", {
      headers: { authorization: `Bearer ${body.apiKey.secret}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as {
      user: { email: string };
      activeWorkspace: { id: string };
    };
    expect(meBody.user.email).toContain("@test.local");
    expect(meBody.activeWorkspace?.id).toBe(body.workspace.id);
  });

  it("rejects malformed email", async () => {
    const res = await SELF.fetch("http://test.local/api/auth/dev-signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("/api/auth/api-keys", () => {
  it("lists, mints, and revokes API keys", async () => {
    const a = await devSignup("keys");

    const created = await SELF.fetch("http://test.local/api/auth/api-keys", {
      method: "POST",
      headers: a.authHeaders,
      body: JSON.stringify({ name: "Browser extension" }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { key: { id: string; secret: string } };
    expect(body.key.secret.startsWith("iia_")).toBe(true);

    const list = await SELF.fetch("http://test.local/api/auth/api-keys", {
      headers: a.authHeaders,
    });
    const listBody = (await list.json()) as {
      keys: Array<{ id: string; revokedAt: string | null }>;
    };
    expect(listBody.keys.some((k) => k.id === body.key.id)).toBe(true);

    const revoked = await SELF.fetch(`http://test.local/api/auth/api-keys/${body.key.id}`, {
      method: "DELETE",
      headers: a.authHeaders,
    });
    expect(revoked.status).toBe(204);

    // The revoked key must no longer authenticate.
    const probe = await SELF.fetch("http://test.local/api/auth/me", {
      headers: { authorization: `Bearer ${body.key.secret}` },
    });
    expect(probe.status).toBe(401);
  });
});

describe("workspace isolation", () => {
  it("user A cannot read user B's items, even by direct id", async () => {
    const a = await devSignup("iso-a");
    const b = await devSignup("iso-b");

    // A creates an item.
    const cap = await SELF.fetch("http://test.local/api/captures", {
      method: "POST",
      headers: a.authHeaders,
      body: JSON.stringify({
        pageUrl: "https://example.com/private",
        imageUrl: "https://example.com/private.jpg",
        mode: "reference",
      }),
    });
    expect(cap.status).toBe(201);
    const created = (await cap.json()) as { item: { id: string; slug: string } };

    // B cannot list it.
    const listB = await SELF.fetch("http://test.local/api/items", { headers: b.authHeaders });
    const listBodyB = (await listB.json()) as { items: Array<{ id: string }> };
    expect(listBodyB.items.some((x) => x.id === created.item.id)).toBe(false);

    // B cannot fetch it directly.
    const direct = await SELF.fetch(`http://test.local/api/items/${created.item.id}`, {
      headers: b.authHeaders,
    });
    expect(direct.status).toBe(404);

    // A still sees it.
    const directA = await SELF.fetch(`http://test.local/api/items/${created.item.id}`, {
      headers: a.authHeaders,
    });
    expect(directA.status).toBe(200);
  });

  it("invalid bearer token yields 401, not 500", async () => {
    const res = await SELF.fetch("http://test.local/api/items", {
      headers: { authorization: "Bearer iia_DOES-NOT-EXIST" },
    });
    expect(res.status).toBe(401);
  });
});
