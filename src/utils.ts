import { readFile } from "node:fs/promises";

export function mergeDefined<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const next = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      next[key as keyof T] = value as T[keyof T];
    }
  }

  return next;
}

export function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }

  throw new Error(`Expected a boolean value, received "${value}".`);
}

export function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Expected an integer value, received "${value}".`);
  }

  return parsed;
}

export async function maybeReadStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text.length > 0 ? text : undefined;
}

export async function loadJsonValue(
  inlineJson?: string,
  jsonFile?: string,
): Promise<unknown> {
  let raw = inlineJson;

  if (jsonFile) {
    raw = await readFile(jsonFile, "utf8");
  }

  if (!raw) {
    raw = await maybeReadStdin();
  }

  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON input: ${message}`);
  }
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function maskSecret(value?: string): string | undefined {
  if (!value) {
    return value;
  }

  if (value.length <= 6) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
