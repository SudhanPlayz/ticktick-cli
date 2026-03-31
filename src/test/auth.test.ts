import assert from "node:assert/strict";
import test from "node:test";

import { buildAuthorizationUrl, exchangeAuthorizationCode } from "../auth.js";
import type { RuntimeConfig } from "../types.js";

const baseConfig: RuntimeConfig = {
  service: "ticktick",
  configFile: "test-config.json",
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://127.0.0.1:18463/callback",
  scopes: "tasks:read tasks:write",
  accessToken: undefined,
  apiBaseUrl: "https://api.ticktick.com",
  authBaseUrl: "https://ticktick.com",
};

test("buildAuthorizationUrl includes the documented OAuth query parameters", () => {
  const { url, state } = buildAuthorizationUrl(baseConfig, "state-123");
  const parsed = new URL(url);

  assert.equal(parsed.origin, "https://ticktick.com");
  assert.equal(parsed.pathname, "/oauth/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "client-id");
  assert.equal(parsed.searchParams.get("scope"), "tasks:read tasks:write");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:18463/callback");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("state"), "state-123");
  assert.equal(state, "state-123");
});

test("exchangeAuthorizationCode posts urlencoded data with basic auth", async () => {
  let request: {
    url?: URL;
    headers?: HeadersInit;
    body?: string;
  } = {};

  const token = await exchangeAuthorizationCode(
    baseConfig,
    "auth-code",
    (async (input, init) => {
      request = {
        url: new URL(String(input)),
        headers: init?.headers,
        body: init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body),
      };

      return new Response(JSON.stringify({ access_token: "token-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  assert.equal(request.url?.toString(), "https://ticktick.com/oauth/token");
  assert.match(String((request.headers as Record<string, string>).Authorization), /^Basic /);
  assert.equal(
    request.body,
    "grant_type=authorization_code&code=auth-code&scope=tasks%3Aread+tasks%3Awrite&redirect_uri=http%3A%2F%2F127.0.0.1%3A18463%2Fcallback",
  );
  assert.equal(token.access_token, "token-123");
});
