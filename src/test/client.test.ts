import assert from "node:assert/strict";
import test from "node:test";

import { TickTickApiError, TickTickClient } from "../client.js";
import type { RuntimeConfig } from "../types.js";

const config: RuntimeConfig = {
  service: "ticktick",
  configFile: "test-config.json",
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://127.0.0.1:18463/callback",
  scopes: "tasks:read tasks:write",
  accessToken: "token-abc",
  apiBaseUrl: "https://api.ticktick.com",
  authBaseUrl: "https://ticktick.com",
};

test("TickTickClient sends bearer token and JSON body", async () => {
  let captured: { url?: string; method?: string; auth?: string; body?: string } = {};

  const client = new TickTickClient(
    config,
    (async (input, init) => {
      captured = {
        url: String(input),
        method: init?.method,
        auth: (init?.headers as Record<string, string>).Authorization,
        body: String(init?.body),
      };

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  const result = await client.createProject({ name: "Inbox" });

  assert.deepEqual(result, { ok: true });
  assert.equal(captured.url, "https://api.ticktick.com/open/v1/project");
  assert.equal(captured.method, "POST");
  assert.equal(captured.auth, "Bearer token-abc");
  assert.equal(captured.body, JSON.stringify({ name: "Inbox" }));
});

test("TickTickClient throws a typed error for non-2xx responses", async () => {
  const client = new TickTickClient(
    config,
    (async () =>
      new Response(JSON.stringify({ message: "boom" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
  );

  await assert.rejects(() => client.listProjects(), (error: unknown) => {
    assert.ok(error instanceof TickTickApiError);
    assert.equal(error.status, 403);
    return true;
  });
});

test("requestRaw can send full URLs without bearer auth", async () => {
  let captured: { url?: string; auth?: string | null } = {};

  const client = new TickTickClient(
    config,
    (async (input, init) => {
      captured = {
        url: String(input),
        auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
      };

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  const result = await client.requestRaw(
    "POST",
    "https://example.test/custom",
    { hello: "world" },
    { auth: false },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(captured.url, "https://example.test/custom");
  assert.equal(captured.auth, null);
});
