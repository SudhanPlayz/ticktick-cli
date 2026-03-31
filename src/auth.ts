import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RuntimeConfig, TokenResponse } from "./types.js";

const execFileAsync = promisify(execFile);

export function buildAuthorizationUrl(
  config: RuntimeConfig,
  state: string = randomUUID(),
): { url: string; state: string } {
  const url = new URL("/oauth/authorize", config.authBaseUrl);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("client_id", config.clientId ?? "");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", config.redirectUri ?? "");
  url.searchParams.set("response_type", "code");

  return { url: url.toString(), state };
}

export async function exchangeAuthorizationCode(
  config: RuntimeConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Client credentials are required. Provide them with flags, env vars, or `ticktick config set`.",
    );
  }

  const tokenUrl = new URL("/oauth/token", config.authBaseUrl);
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    scope: config.scopes,
    redirect_uri: config.redirectUri ?? "",
  });

  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const raw = await response.text();
  const parsed = raw.length > 0 ? JSON.parse(raw) : {};

  if (!response.ok) {
    throw new Error(
      `Token exchange failed with status ${response.status}: ${JSON.stringify(parsed)}`,
    );
  }

  return parsed as TokenResponse;
}

export function isLoopbackRedirect(redirectUri?: string): boolean {
  if (!redirectUri) {
    return false;
  }

  const parsed = new URL(redirectUri);
  return (
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(parsed.hostname)
  );
}

export async function waitForOAuthCode(
  redirectUri: string,
  expectedState: string,
  timeoutMs = 120_000,
): Promise<string> {
  const redirect = new URL(redirectUri);
  const hostname = redirect.hostname === "localhost" ? "127.0.0.1" : redirect.hostname;
  const port = Number.parseInt(redirect.port || "80", 10);
  const callbackPath = redirect.pathname || "/";

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the OAuth callback."));
    }, timeoutMs);

    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirect.origin);

      if (requestUrl.pathname !== callbackPath) {
        response.statusCode = 404;
        response.end("Not Found");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");

      if (!code) {
        response.statusCode = 400;
        response.end("Missing authorization code.");
        return;
      }

      if (state !== expectedState) {
        response.statusCode = 400;
        response.end("State mismatch.");
        clearTimeout(timeout);
        server.close();
        reject(new Error("OAuth state mismatch."));
        return;
      }

      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        "<html><body><h1>TickTick CLI</h1><p>Authorization complete. You can close this window.</p></body></html>",
      );

      clearTimeout(timeout);
      server.close();
      resolve(code);
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(port, hostname);
  });
}

export async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url]);
      return;
    }

    if (process.platform === "darwin") {
      await execFileAsync("open", [url]);
      return;
    }

    await execFileAsync("xdg-open", [url]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Could not open a browser automatically: ${message}\n`);
  }
}
