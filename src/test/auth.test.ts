import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  getOAuthCallbackBinding,
  isLoopbackRedirect,
  openBrowser,
  openBrowserWith,
  waitForOAuthCode,
} from "../auth.js";
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

async function startServer(port: number): Promise<ReturnType<typeof createServer>> {
  const server = createServer((_request, response) => response.end("busy"));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test("buildAuthorizationUrl supports explicit and generated state values", () => {
  const explicit = buildAuthorizationUrl(baseConfig, "state-123");
  const parsed = new URL(explicit.url);

  assert.equal(parsed.origin, "https://ticktick.com");
  assert.equal(parsed.pathname, "/oauth/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "client-id");
  assert.equal(parsed.searchParams.get("scope"), "tasks:read tasks:write");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:18463/callback");
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("state"), "state-123");
  assert.equal(explicit.state, "state-123");

  const generated = buildAuthorizationUrl(baseConfig);
  assert.match(generated.state, /^[0-9a-f-]{36}$/i);

  const blankFields = buildAuthorizationUrl(
    {
      ...baseConfig,
      clientId: undefined,
      redirectUri: undefined,
    },
    "state-blank",
  );
  const blankParsed = new URL(blankFields.url);
  assert.equal(blankParsed.searchParams.get("client_id"), "");
  assert.equal(blankParsed.searchParams.get("redirect_uri"), "");
});

test("exchangeAuthorizationCode validates credentials and request/response handling", async () => {
  await assert.rejects(
    () => exchangeAuthorizationCode({ ...baseConfig, clientSecret: undefined }, "code"),
    /Client credentials are required/,
  );
  await assert.rejects(
    () => exchangeAuthorizationCode({ ...baseConfig, clientId: undefined }, "code"),
    /Client credentials are required/,
  );

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

  await assert.rejects(
    () =>
      exchangeAuthorizationCode(
        baseConfig,
        "auth-code",
        (async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          })) as typeof fetch,
      ),
    /Token exchange failed with status 400/,
  );

  await assert.rejects(
    () =>
      exchangeAuthorizationCode(
        baseConfig,
        "auth-code",
        (async () =>
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })) as typeof fetch,
      ),
    /Token exchange returned invalid JSON/,
  );

  const emptyResponse = await exchangeAuthorizationCode(
    {
      ...baseConfig,
      redirectUri: undefined,
    },
    "auth-code",
    (async (_input, init) => {
      request = {
        headers: init?.headers,
        body: init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body),
      };

      return new Response("", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  assert.deepEqual(emptyResponse, {});
  assert.match(request.body ?? "", /redirect_uri=/);

  const originalParse = JSON.parse;
  JSON.parse = (() => {
    throw "boom";
  }) as typeof JSON.parse;

  try {
    await assert.rejects(
      () =>
        exchangeAuthorizationCode(
          baseConfig,
          "auth-code",
          (async () =>
            new Response('{"access_token":"token-123"}', {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })) as typeof fetch,
        ),
      /Token exchange returned invalid JSON: boom/,
    );
  } finally {
    JSON.parse = originalParse;
  }

  const port = await getAvailablePort();
  const tokenServer = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ access_token: "default-fetch-token" }));
  });
  await new Promise<void>((resolve) => tokenServer.listen(port, "127.0.0.1", resolve));

  try {
    const defaultFetchToken = await exchangeAuthorizationCode(
      {
        ...baseConfig,
        authBaseUrl: `http://127.0.0.1:${port}`,
      },
      "auth-code",
    );

    assert.equal(defaultFetchToken.access_token, "default-fetch-token");
  } finally {
    await new Promise<void>((resolve, reject) =>
      tokenServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("isLoopbackRedirect accepts only local http callbacks", () => {
  assert.equal(isLoopbackRedirect(undefined), false);
  assert.equal(isLoopbackRedirect("http://127.0.0.1:18463/callback"), true);
  assert.equal(isLoopbackRedirect("http://localhost:18463/callback"), true);
  assert.equal(isLoopbackRedirect("https://127.0.0.1:18463/callback"), false);
  assert.equal(isLoopbackRedirect("http://example.com/callback"), false);
});

test("getOAuthCallbackBinding normalizes hostname and default ports", () => {
  assert.deepEqual(
    getOAuthCallbackBinding("http://localhost/callback"),
    {
      hostname: "127.0.0.1",
      port: 80,
      callbackPath: "/callback",
    },
  );

  assert.deepEqual(
    getOAuthCallbackBinding("http://127.0.0.1:18463"),
    {
      hostname: "127.0.0.1",
      port: 18463,
      callbackPath: "/",
    },
  );
});

test("waitForOAuthCode handles 404 and missing-code requests before succeeding", async () => {
  const port = await getAvailablePort();
  const promise = waitForOAuthCode(`http://127.0.0.1:${port}/callback`, "state-ok", 1000);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const wrongPath = await fetch(`http://127.0.0.1:${port}/wrong`);
  assert.equal(wrongPath.status, 404);
  assert.equal(await wrongPath.text(), "Not Found");

  const missingCode = await fetch(`http://127.0.0.1:${port}/callback?state=state-ok`);
  assert.equal(missingCode.status, 400);
  assert.equal(await missingCode.text(), "Missing authorization code.");

  const success = await fetch(`http://127.0.0.1:${port}/callback?code=oauth-code&state=state-ok`);
  assert.equal(success.status, 200);
  assert.match(await success.text(), /Authorization complete/);

  assert.equal(await promise, "oauth-code");
});

test("waitForOAuthCode supports localhost redirect hosts", async () => {
  const port = await getAvailablePort();
  const promise = waitForOAuthCode(`http://localhost:${port}/callback`, "state-local", 1000);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const response = await fetch(
    `http://127.0.0.1:${port}/callback?code=local-code&state=state-local`,
  );
  assert.equal(response.status, 200);
  assert.equal(await promise, "local-code");
});

test("waitForOAuthCode supports root callback paths", async () => {
  const port = await getAvailablePort();
  const promise = waitForOAuthCode(`http://127.0.0.1:${port}`, "state-root", 1000);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const response = await fetch(`http://127.0.0.1:${port}/?code=root-code&state=state-root`);
  assert.equal(response.status, 200);
  assert.equal(await promise, "root-code");
});

test("waitForOAuthCode rejects on state mismatch, timeout, and listen errors", async () => {
  const mismatchPort = await getAvailablePort();
  const mismatch = waitForOAuthCode(
    `http://127.0.0.1:${mismatchPort}/callback`,
    "expected",
    1000,
  );
  const mismatchAssertion = assert.rejects(mismatch, /OAuth state mismatch/);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const badState = await fetch(
    `http://127.0.0.1:${mismatchPort}/callback?code=oauth-code&state=wrong`,
  );
  assert.equal(badState.status, 400);
  assert.equal(await badState.text(), "State mismatch.");

  await mismatchAssertion;

  await assert.rejects(
    async () => {
      const timeoutPort = await getAvailablePort();
      return waitForOAuthCode(`http://127.0.0.1:${timeoutPort}/callback`, "expected", 10);
    },
    /Timed out waiting for the OAuth callback/,
  );

  const occupiedPort = await getAvailablePort();
  const occupied = await startServer(occupiedPort);

  try {
    await assert.rejects(
      () => waitForOAuthCode(`http://127.0.0.1:${occupiedPort}/callback`, "expected", 1000),
    );
  } finally {
    occupied.close();
  }
});

test("openBrowser and openBrowserWith dispatch to platform commands and report failures", async () => {
  const commands: Array<{ file: string; args: string[] }> = [];
  let stderr = "";

  const execFile = async (file: string, args: string[]) => {
    commands.push({ file, args });
  };

  await openBrowserWith("https://example.com", {
    platform: "win32",
    execFile,
  });
  await openBrowserWith("https://example.com", {
    platform: "darwin",
    execFile,
  });
  await openBrowserWith("https://example.com", {
    platform: "linux",
    execFile,
  });
  await openBrowser("https://example.com", {
    platform: "linux",
    execFile,
  } as never);

  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (() => true) as typeof process.stderr.write;

  try {
    await openBrowserWith("https://example.com", {
      platform: "linux",
    });
  } finally {
    process.stderr.write = originalStderrWrite;
  }

  await openBrowserWith("https://example.com", {
    execFile,
  });

  assert.deepEqual(commands, [
    { file: "cmd", args: ["/c", "start", "", "https://example.com"] },
    { file: "open", args: ["https://example.com"] },
    { file: "xdg-open", args: ["https://example.com"] },
    { file: "xdg-open", args: ["https://example.com"] },
    {
      file: process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open",
      args:
        process.platform === "win32"
          ? ["/c", "start", "", "https://example.com"]
          : ["https://example.com"],
    },
  ]);

  await openBrowserWith("https://example.com", {
    platform: "linux",
    execFile: async () => {
      throw new Error("boom");
    },
    stderr: (text) => {
      stderr += text;
    },
  });

  assert.match(stderr, /Could not open a browser automatically: boom/);

  stderr = "";
  await openBrowserWith("https://example.com", {
    platform: "linux",
    execFile: async () => {
      throw "string-failure";
    },
    stderr: (text) => {
      stderr += text;
    },
  });

  assert.match(stderr, /Could not open a browser automatically: string-failure/);
});
