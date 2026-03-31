import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  loadJsonValue,
  maskSecret,
  maybeReadStdin,
  mergeDefined,
  parseBoolean,
  parseInteger,
  printJson,
} from "../utils.js";

test("mergeDefined overwrites only defined values", () => {
  assert.deepEqual(
    mergeDefined(
      { keep: "value", replace: "before" },
      { replace: "after", skip: undefined },
    ),
    { keep: "value", replace: "after" },
  );
});

test("parseBoolean handles true/false inputs and rejects invalid values", () => {
  assert.equal(parseBoolean("true"), true);
  assert.equal(parseBoolean("YES"), true);
  assert.equal(parseBoolean("0"), false);
  assert.equal(parseBoolean("No"), false);
  assert.throws(() => parseBoolean("maybe"), /Expected a boolean value/);
});

test("parseInteger handles valid and invalid input", () => {
  assert.equal(parseInteger("42"), 42);
  assert.throws(() => parseInteger("not-a-number"), /Expected an integer value/);
});

test("maybeReadStdin returns undefined for tty and reads buffered input", async () => {
  const ttyInput = Object.assign(Readable.from([]), { isTTY: true });
  assert.equal(await maybeReadStdin(ttyInput), undefined);

  const streamInput = Object.assign(Readable.from(["  hello world  "]), { isTTY: false });
  assert.equal(await maybeReadStdin(streamInput), "hello world");

  const bufferInput = Object.assign(Readable.from([Buffer.from("  buffered  ")]), { isTTY: false });
  assert.equal(await maybeReadStdin(bufferInput), "buffered");

  const emptyInput = Object.assign(Readable.from(["   "]), { isTTY: false });
  assert.equal(await maybeReadStdin(emptyInput), undefined);
});

test("loadJsonValue supports inline JSON, files, stdin, empty input, and invalid JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ticktick-cli-utils-"));
  const jsonFile = path.join(tempDir, "payload.json");

  try {
    await writeFile(jsonFile, '{"file":true}', "utf8");

    assert.deepEqual(await loadJsonValue('{"inline":true}'), { inline: true });
    assert.deepEqual(await loadJsonValue(undefined, jsonFile), { file: true });
    assert.deepEqual(
      await loadJsonValue(
        undefined,
        undefined,
        Object.assign(Readable.from(['{"stdin":true}']), { isTTY: false }),
      ),
      { stdin: true },
    );
    assert.equal(
      await loadJsonValue(
        undefined,
        undefined,
        Object.assign(Readable.from([]), { isTTY: true }),
      ),
      undefined,
    );

    await assert.rejects(
      () => loadJsonValue("{bad-json}"),
      /Failed to parse JSON input/,
    );

    const originalParse = JSON.parse;
    JSON.parse = (() => {
      throw "string-failure";
    }) as typeof JSON.parse;

    try {
      await assert.rejects(
        () => loadJsonValue('{"inline":true}'),
        /Failed to parse JSON input: string-failure/,
      );
    } finally {
      JSON.parse = originalParse;
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("printJson and maskSecret behave as expected", () => {
  let output = "";
  printJson({ ok: true }, (text) => {
    output += text;
  });

  assert.equal(output, '{\n  "ok": true\n}\n');

  let defaultOutput = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    defaultOutput += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    printJson({ defaultWriter: true });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(defaultOutput, '{\n  "defaultWriter": true\n}\n');
  assert.equal(maskSecret(undefined), undefined);
  assert.equal(maskSecret("short"), "*****");
  assert.equal(maskSecret("very-secret-value"), "ver***lue");
});
