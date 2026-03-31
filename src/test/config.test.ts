import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultConfigFilePath,
  loadStoredConfig,
  resolveRuntimeConfig,
  saveStoredConfig,
  validateService,
} from "../config.js";

test("defaultConfigFilePath uses the correct OS-specific defaults", () => {
  const originalAppData = process.env.APPDATA;
  process.env.APPDATA = "C:\\Runtime\\AppData";

  assert.equal(
    defaultConfigFilePath({
      platform: "win32",
      appData: "C:\\Users\\sudha\\AppData\\Roaming",
      homeDir: "C:\\Users\\sudha",
    }),
    "C:\\Users\\sudha\\AppData\\Roaming\\ticktick-cli\\config.json",
  );

  assert.equal(
    defaultConfigFilePath({
      platform: "darwin",
      homeDir: "/Users/sudha",
    }),
    "/Users/sudha/Library/Application Support/ticktick-cli/config.json",
  );

  assert.equal(
    defaultConfigFilePath({
      platform: "linux",
      homeDir: "/home/sudha",
    }),
    "/home/sudha/.config/ticktick-cli/config.json",
  );

  assert.equal(
    defaultConfigFilePath({
      platform: "win32",
      appData: "",
      homeDir: "C:\\Users\\sudha",
    }),
    "C:\\Users\\sudha\\.config\\ticktick-cli\\config.json",
  );

  assert.equal(
    defaultConfigFilePath({
      platform: "win32",
    }),
    "C:\\Runtime\\AppData\\ticktick-cli\\config.json",
  );

  assert.equal(
    defaultConfigFilePath({
      platform: "linux",
    }),
    path.posix.join(os.homedir(), ".config", "ticktick-cli", "config.json"),
  );

  process.env.APPDATA = originalAppData;
});

test("loadStoredConfig handles missing files and invalid JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ticktick-cli-config-"));
  const missingFile = path.join(tempDir, "missing.json");
  const invalidFile = path.join(tempDir, "invalid.json");

  try {
    assert.deepEqual(await loadStoredConfig(missingFile), {});

    await writeFile(invalidFile, "{invalid", "utf8");
    await assert.rejects(() => loadStoredConfig(invalidFile), SyntaxError);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("validateService rejects unsupported values", () => {
  assert.equal(validateService("ticktick"), "ticktick");
  assert.equal(validateService("dida365"), "dida365");
  assert.throws(() => validateService("nope"), /Unsupported service "nope"/);
});

test("resolveRuntimeConfig applies defaults, stored config, env, and overrides in order", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ticktick-cli-config-"));
  const configFile = path.join(tempDir, "config.json");
  const envConfigFile = path.join(tempDir, "env-config.json");
  const storedUrlsFile = path.join(tempDir, "stored-urls.json");

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

    await saveStoredConfig(storedUrlsFile, {
      apiBaseUrl: "https://api.stored.test",
      authBaseUrl: "https://auth.stored.test",
    });

    const storedUrls = await resolveRuntimeConfig(
      { configFile: storedUrlsFile },
      {},
    );

    assert.equal(storedUrls.apiBaseUrl, "https://api.stored.test");
    assert.equal(storedUrls.authBaseUrl, "https://auth.stored.test");

    const dida = await resolveRuntimeConfig(
      { configFile, service: "dida365" },
      {},
    );

    assert.equal(dida.service, "dida365");
    assert.equal(dida.apiBaseUrl, "https://api.dida365.com");
    assert.equal(dida.authBaseUrl, "https://dida365.com");

    await assert.rejects(
      () =>
        resolveRuntimeConfig(
          { configFile },
          { TICKTICK_SERVICE: "invalid-service" },
        ),
      /Unsupported service "invalid-service"/,
    );

    const defaultsOnly = await resolveRuntimeConfig({ configFile: path.join(tempDir, "missing.json") }, {});
    assert.equal(defaultsOnly.service, "ticktick");
    assert.equal(defaultsOnly.redirectUri, "http://127.0.0.1:18463/callback");

    await saveStoredConfig(envConfigFile, {
      service: "ticktick",
      clientId: "stored-client",
      clientSecret: "stored-secret",
    });

    const envOnly = await resolveRuntimeConfig(
      {},
      {
        TICKTICK_CONFIG_FILE: envConfigFile,
        TICKTICK_SERVICE: "dida365",
        TICKTICK_CLIENT_ID: "env-client",
        TICKTICK_CLIENT_SECRET: "env-secret",
        TICKTICK_REDIRECT_URI: "http://127.0.0.1:9999/callback",
        TICKTICK_SCOPES: "tasks:read",
        TICKTICK_ACCESS_TOKEN: "env-token",
        TICKTICK_API_BASE_URL: "https://api.env.test",
        TICKTICK_AUTH_BASE_URL: "https://auth.env.test",
      },
    );

    assert.equal(envOnly.configFile, envConfigFile);
    assert.equal(envOnly.service, "dida365");
    assert.equal(envOnly.clientId, "env-client");
    assert.equal(envOnly.clientSecret, "env-secret");
    assert.equal(envOnly.redirectUri, "http://127.0.0.1:9999/callback");
    assert.equal(envOnly.scopes, "tasks:read");
    assert.equal(envOnly.accessToken, "env-token");
    assert.equal(envOnly.apiBaseUrl, "https://api.env.test");
    assert.equal(envOnly.authBaseUrl, "https://auth.env.test");

    const overrideOnly = await resolveRuntimeConfig(
      {
        configFile,
        service: "ticktick",
        clientId: "override-client",
        clientSecret: "override-secret",
        redirectUri: "http://127.0.0.1:7000/callback",
        scopes: "tasks:write",
        accessToken: "override-token",
        apiBaseUrl: "https://api.override.test",
        authBaseUrl: "https://auth.override.test",
      },
      {},
    );

    assert.equal(overrideOnly.clientId, "override-client");
    assert.equal(overrideOnly.clientSecret, "override-secret");
    assert.equal(overrideOnly.redirectUri, "http://127.0.0.1:7000/callback");
    assert.equal(overrideOnly.scopes, "tasks:write");
    assert.equal(overrideOnly.accessToken, "override-token");
    assert.equal(overrideOnly.apiBaseUrl, "https://api.override.test");
    assert.equal(overrideOnly.authBaseUrl, "https://auth.override.test");

    const originalConfigFile = process.env.TICKTICK_CONFIG_FILE;
    process.env.TICKTICK_CONFIG_FILE = envConfigFile;

    try {
      const fromProcessEnv = await resolveRuntimeConfig();
      assert.equal(fromProcessEnv.configFile, envConfigFile);
    } finally {
      process.env.TICKTICK_CONFIG_FILE = originalConfigFile;
    }

    const fromDefaultPath = await resolveRuntimeConfig({}, {});
    assert.equal(fromDefaultPath.configFile, defaultConfigFilePath());
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
