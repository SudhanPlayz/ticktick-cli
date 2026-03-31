import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveRuntimeConfig, saveStoredConfig } from "../config.js";

test("resolveRuntimeConfig applies defaults, stored config, env, and overrides in order", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ticktick-cli-config-"));
  const configFile = path.join(tempDir, "config.json");

  try {
    await saveStoredConfig(configFile, {
      service: "ticktick",
      clientId: "stored-client",
      clientSecret: "stored-secret",
      redirectUri: "http://127.0.0.1:9000/callback",
      scopes: "tasks:read",
      accessToken: "stored-token",
    });

    const resolved = await resolveRuntimeConfig(
      {
        configFile,
        scopes: "tasks:read tasks:write",
      },
      {
        TICKTICK_ACCESS_TOKEN: "env-token",
        TICKTICK_API_BASE_URL: "https://api.example.test",
      },
    );

    assert.equal(resolved.clientId, "stored-client");
    assert.equal(resolved.clientSecret, "stored-secret");
    assert.equal(resolved.redirectUri, "http://127.0.0.1:9000/callback");
    assert.equal(resolved.scopes, "tasks:read tasks:write");
    assert.equal(resolved.accessToken, "env-token");
    assert.equal(resolved.apiBaseUrl, "https://api.example.test");
    assert.equal(resolved.authBaseUrl, "https://ticktick.com");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
