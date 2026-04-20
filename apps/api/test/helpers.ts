import { SELF } from "cloudflare:test";

export interface SignupResult {
  email: string;
  apiKey: string;
  workspaceId: string;
  userId: string;
  authHeaders: Record<string, string>;
}

let counter = 0;

/** Bootstrap a fresh user + workspace + API key via the dev-signup endpoint. */
export async function devSignup(prefix = "user"): Promise<SignupResult> {
  counter += 1;
  const email = `${prefix}-${counter}-${Date.now()}@test.local`;
  const res = await SELF.fetch("http://test.local/api/auth/dev-signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, displayName: "Test User", workspaceName: "Test Workspace" }),
  });
  if (res.status !== 201) {
    throw new Error(`dev-signup failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    user: { id: string };
    workspace: { id: string };
    apiKey: { secret: string };
  };
  return {
    email,
    apiKey: body.apiKey.secret,
    workspaceId: body.workspace.id,
    userId: body.user.id,
    authHeaders: {
      authorization: `Bearer ${body.apiKey.secret}`,
      "content-type": "application/json",
    },
  };
}
