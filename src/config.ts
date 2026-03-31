import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RuntimeConfig, StoredConfig, TickTickService } from "./types.js";

const DEFAULT_SCOPES = "tasks:read tasks:write";
const DEFAULT_SERVICE: TickTickService = "ticktick";

const SERVICE_DEFAULTS: Record<
  TickTickService,
  { apiBaseUrl: string; authBaseUrl: string }
> = {
  ticktick: {
    apiBaseUrl: "https://api.ticktick.com",
    authBaseUrl: "https://ticktick.com",
  },
  dida365: {
    apiBaseUrl: "https://api.dida365.com",
    authBaseUrl: "https://dida365.com",
  },
};

export interface RuntimeOverrides extends Partial<StoredConfig> {
  configFile?: string;
}

export interface DefaultConfigPathOptions {
  platform?: NodeJS.Platform;
  appData?: string;
  homeDir?: string;
}

export function defaultConfigFilePath(options: DefaultConfigPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const appData = options.appData ?? process.env.APPDATA;
  const homeDir = options.homeDir ?? os.homedir();
  const pathModule = platform === "win32" ? path.win32 : path.posix;

  if (platform === "win32" && appData) {
    return pathModule.join(appData, "ticktick-cli", "config.json");
  }

  if (platform === "darwin") {
    return pathModule.join(
      homeDir,
      "Library",
      "Application Support",
      "ticktick-cli",
      "config.json",
    );
  }

  return pathModule.join(homeDir, ".config", "ticktick-cli", "config.json");
}

export async function loadStoredConfig(configFile: string): Promise<StoredConfig> {
  try {
    const raw = await readFile(configFile, "utf8");
    return JSON.parse(raw) as StoredConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

export async function saveStoredConfig(
  configFile: string,
  config: StoredConfig,
): Promise<void> {
  await mkdir(path.dirname(configFile), { recursive: true });
  await writeFile(configFile, JSON.stringify(config, null, 2), "utf8");
}

export function validateService(service: string): TickTickService {
  if (service === "ticktick" || service === "dida365") {
    return service;
  }

  throw new Error(`Unsupported service "${service}". Use "ticktick" or "dida365".`);
}

function envConfig(env: NodeJS.ProcessEnv): StoredConfig {
  return {
    service: env.TICKTICK_SERVICE
      ? validateService(env.TICKTICK_SERVICE)
      : undefined,
    clientId: env.TICKTICK_CLIENT_ID,
    clientSecret: env.TICKTICK_CLIENT_SECRET,
    redirectUri: env.TICKTICK_REDIRECT_URI,
    scopes: env.TICKTICK_SCOPES,
    accessToken: env.TICKTICK_ACCESS_TOKEN,
    apiBaseUrl: env.TICKTICK_API_BASE_URL,
    authBaseUrl: env.TICKTICK_AUTH_BASE_URL,
  };
}

export async function resolveRuntimeConfig(
  overrides: RuntimeOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeConfig> {
  const configFile = overrides.configFile ?? env.TICKTICK_CONFIG_FILE ?? defaultConfigFilePath();
  const stored = await loadStoredConfig(configFile);
  const fromEnv = envConfig(env);

  const service =
    overrides.service ?? fromEnv.service ?? stored.service ?? DEFAULT_SERVICE;
  const defaults = SERVICE_DEFAULTS[service];

  return {
    service,
    configFile,
    clientId: overrides.clientId ?? fromEnv.clientId ?? stored.clientId,
    clientSecret:
      overrides.clientSecret ?? fromEnv.clientSecret ?? stored.clientSecret,
    redirectUri:
      overrides.redirectUri ??
      fromEnv.redirectUri ??
      stored.redirectUri ??
      "http://127.0.0.1:18463/callback",
    scopes: overrides.scopes ?? fromEnv.scopes ?? stored.scopes ?? DEFAULT_SCOPES,
    accessToken:
      overrides.accessToken ?? fromEnv.accessToken ?? stored.accessToken,
    apiBaseUrl:
      overrides.apiBaseUrl ?? fromEnv.apiBaseUrl ?? stored.apiBaseUrl ?? defaults.apiBaseUrl,
    authBaseUrl:
      overrides.authBaseUrl ??
      fromEnv.authBaseUrl ??
      stored.authBaseUrl ??
      defaults.authBaseUrl,
  };
}
