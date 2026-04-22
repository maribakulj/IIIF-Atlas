/**
 * Unit tests for recordAudit. The function must *never* throw — audit
 * bookkeeping is explicitly best-effort — and must write the expected
 * row shape when the context is well-formed. Tests bootstrap a real
 * workspace+user via devSignup so the foreign-key constraints in
 * audit_log(workspace_id, actor_user_id) are satisfied.
 */

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { recordAudit } from "../src/audit.js";
import type { Env } from "../src/env.js";
import { devSignup } from "./helpers.js";

describe("recordAudit", () => {
  it("persists a row with the full context and JSON details", async () => {
    const auth = await devSignup("audit-unit");
    const subjectId = `subj-${Math.random().toString(36).slice(2)}`;
    await recordAudit(
      env as unknown as Env,
      { workspaceId: auth.workspaceId, userId: auth.userId },
      "item.create",
      "item",
      subjectId,
      { note: "hi" },
    );
    const row = await env.DB.prepare(
      `SELECT workspace_id, actor_user_id, verb, subject_type, subject_id, details_json
         FROM audit_log
        WHERE subject_id = ?`,
    )
      .bind(subjectId)
      .first<{
        workspace_id: string | null;
        actor_user_id: string | null;
        verb: string;
        subject_type: string;
        subject_id: string;
        details_json: string | null;
      }>();
    expect(row).not.toBeNull();
    expect(row?.workspace_id).toBe(auth.workspaceId);
    expect(row?.actor_user_id).toBe(auth.userId);
    expect(row?.verb).toBe("item.create");
    expect(row?.subject_type).toBe("item");
    expect(JSON.parse(row?.details_json ?? "null")).toEqual({ note: "hi" });
  });

  it("accepts a null context (system actor, no workspace)", async () => {
    const subjectId = `sys-${Math.random().toString(36).slice(2)}`;
    await recordAudit(env as unknown as Env, null, "item.ingest.failed", "item", subjectId);
    const row = await env.DB.prepare(
      `SELECT workspace_id, actor_user_id, details_json FROM audit_log WHERE subject_id = ?`,
    )
      .bind(subjectId)
      .first<{
        workspace_id: string | null;
        actor_user_id: string | null;
        details_json: string | null;
      }>();
    expect(row).not.toBeNull();
    expect(row?.workspace_id).toBeNull();
    expect(row?.actor_user_id).toBeNull();
    expect(row?.details_json).toBeNull();
  });

  it("accepts a system context with userId=null", async () => {
    const auth = await devSignup("audit-sys");
    const subjectId = `sysuser-${Math.random().toString(36).slice(2)}`;
    await recordAudit(
      env as unknown as Env,
      { workspaceId: auth.workspaceId, userId: null },
      "item.ingest.ready",
      "item",
      subjectId,
    );
    const row = await env.DB.prepare(
      `SELECT workspace_id, actor_user_id FROM audit_log WHERE subject_id = ?`,
    )
      .bind(subjectId)
      .first<{ workspace_id: string | null; actor_user_id: string | null }>();
    expect(row?.workspace_id).toBe(auth.workspaceId);
    expect(row?.actor_user_id).toBeNull();
  });

  it("never throws, even when the DB prepare call rejects", async () => {
    const broken = {
      DB: {
        prepare: () => ({
          bind: () => ({ run: () => Promise.reject(new Error("boom")) }),
        }),
      },
    } as unknown as Env;
    await expect(
      recordAudit(broken, { workspaceId: "w", userId: "u" }, "v", "t", "id"),
    ).resolves.toBeUndefined();
  });
});
