import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createProgram,
  defaultCliDependencies,
  handleError,
  main,
  type CliDependencies,
} from "../cli.js";
import type {
  CompletedTasksFilter,
  FilterTasksRequest,
  MoveTaskOperation,
  Project,
  RuntimeConfig,
  StoredConfig,
  Task,
} from "../types.js";

type ClientCall = { method: string; args: unknown[] };

type CliHarness = {
  clientCalls: ClientCall[];
  dependencies: CliDependencies;
  errors: string[];
  outputs: unknown[];
  savedConfigs: StoredConfig[];
  storedConfig: StoredConfig;
};

function createCliHarness(
  runtimePatch: Partial<RuntimeConfig> = {},
): CliHarness {
  const outputs: unknown[] = [];
  const errors: string[] = [];
  const savedConfigs: StoredConfig[] = [];
  let storedConfig: StoredConfig = {
    service: "ticktick",
    clientId: "stored-client",
    clientSecret: "stored-secret",
    redirectUri: "http://127.0.0.1:18463/callback",
    scopes: "tasks:read tasks:write",
    accessToken: "stored-access-token",
    apiBaseUrl: "https://api.ticktick.com",
    authBaseUrl: "https://ticktick.com",
  };

  const runtimeConfig: RuntimeConfig = {
    service: "ticktick",
    configFile: "memory-config.json",
    clientId: "stored-client",
    clientSecret: "stored-secret",
    redirectUri: "http://127.0.0.1:18463/callback",
    scopes: "tasks:read tasks:write",
    accessToken: "stored-access-token",
    apiBaseUrl: "https://api.ticktick.com",
    authBaseUrl: "https://ticktick.com",
    ...runtimePatch,
  };

  const clientCalls: ClientCall[] = [];
  const record = (method: string, ...args: unknown[]) => {
    clientCalls.push({ method, args });
  };

  const client = {
    getTask: async (projectId: string, taskId: string) => {
      record("getTask", projectId, taskId);
      return { projectId, taskId };
    },
    createTask: async (payload: Partial<Task>) => {
      record("createTask", payload);
      return payload;
    },
    updateTask: async (taskId: string, payload: Partial<Task>) => {
      record("updateTask", taskId, payload);
      return payload;
    },
    completeTask: async (projectId: string, taskId: string) => {
      record("completeTask", projectId, taskId);
      return undefined;
    },
    deleteTask: async (projectId: string, taskId: string) => {
      record("deleteTask", projectId, taskId);
      return undefined;
    },
    moveTasks: async (payload: MoveTaskOperation[]) => {
      record("moveTasks", payload);
      return payload.map((operation) => ({
        id: operation.taskId,
        etag: `etag-${operation.taskId}`,
      }));
    },
    listCompletedTasks: async (payload: CompletedTasksFilter) => {
      record("listCompletedTasks", payload);
      return [{ id: "completed-task-1", projectId: payload.projectIds?.[0] }];
    },
    filterTasks: async (payload: FilterTasksRequest) => {
      record("filterTasks", payload);
      return [{ id: "filtered-task-1", status: payload.status?.[0] }];
    },
    listProjects: async () => {
      record("listProjects");
      return [{ id: "project-1" }];
    },
    getProject: async (projectId: string) => {
      record("getProject", projectId);
      return { id: projectId };
    },
    getProjectData: async (projectId: string) => {
      record("getProjectData", projectId);
      return { project: { id: projectId } };
    },
    createProject: async (payload: Partial<Project>) => {
      record("createProject", payload);
      return payload;
    },
    updateProject: async (projectId: string, payload: Partial<Project>) => {
      record("updateProject", projectId, payload);
      return payload;
    },
    deleteProject: async (projectId: string) => {
      record("deleteProject", projectId);
      return undefined;
    },
    requestRaw: async (
      method: string,
      path: string,
      body?: unknown,
      options?: { auth?: boolean },
    ) => {
      record("requestRaw", method, path, body, options);
      return undefined;
    },
  };

  const dependencies: CliDependencies = {
    ...defaultCliDependencies,
    buildAuthorizationUrl: (_config, state) => ({
      url: "https://auth.example.test/authorize",
      state: state ?? "generated-state",
    }),
    createClient: () => client,
    exchangeAuthorizationCode: async () => ({ access_token: "token-123" }),
    isLoopbackRedirect: (redirectUri) => redirectUri?.startsWith("http://127.0.0.1") ?? false,
    loadJsonValue: async (inlineJson?: string, jsonFile?: string) => {
      if (inlineJson) {
        return JSON.parse(inlineJson);
      }

      if (jsonFile) {
        return JSON.parse(await readFile(jsonFile, "utf8"));
      }

      return undefined;
    },
    loadStoredConfig: async () => ({ ...storedConfig }),
    printJson: (value) => {
      outputs.push(value);
    },
    resolveRuntimeConfig: async (overrides = {}) => ({
      ...runtimeConfig,
      service: overrides.service ?? runtimeConfig.service,
      configFile: overrides.configFile ?? runtimeConfig.configFile,
      clientId: overrides.clientId ?? runtimeConfig.clientId,
      clientSecret: overrides.clientSecret ?? runtimeConfig.clientSecret,
      redirectUri: overrides.redirectUri ?? runtimeConfig.redirectUri,
      scopes: overrides.scopes ?? runtimeConfig.scopes,
      accessToken: overrides.accessToken ?? runtimeConfig.accessToken,
      apiBaseUrl: overrides.apiBaseUrl ?? runtimeConfig.apiBaseUrl,
      authBaseUrl: overrides.authBaseUrl ?? runtimeConfig.authBaseUrl,
    }),
    saveStoredConfig: async (_configFile, next) => {
      storedConfig = { ...next };
      savedConfigs.push({ ...next });
    },
    stderr: (text) => {
      errors.push(text);
    },
    waitForOAuthCode: async () => "auth-code",
  };

  return {
    clientCalls,
    dependencies,
    errors,
    outputs,
    savedConfigs,
    get storedConfig() {
      return storedConfig;
    },
  };
}

async function runCli(
  harness: CliHarness,
  args: string[],
): Promise<{ exitCode?: number }> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await main(["node", "ticktick", ...args], harness.dependencies);
    return { exitCode: process.exitCode };
  } finally {
    process.exitCode = previousExitCode;
  }
}

test("createProgram registers the documented top-level commands", () => {
  const program = createProgram();
  const commands = program.commands.map((command) => command.name());

  assert.deepEqual(commands, ["auth", "config", "task", "project", "request"]);
});

test("defaultCliDependencies expose the production client and stderr writer", () => {
  const client = defaultCliDependencies.createClient({
    service: "ticktick",
    configFile: "test-config.json",
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "http://127.0.0.1:18463/callback",
    scopes: "tasks:read tasks:write",
    accessToken: "access-token",
    apiBaseUrl: "https://api.ticktick.com",
    authBaseUrl: "https://ticktick.com",
  });

  assert.equal(client.constructor.name, "TickTickClient");

  let stderr = "";
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    defaultCliDependencies.stderr("stderr-output");
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.equal(stderr, "stderr-output");
});

test("handleError reports both Error and string failures", () => {
  let stderr = "";
  const dependencies = { stderr: (text: string) => { stderr += text; } };
  const previousExitCode = process.exitCode;

  try {
    process.exitCode = undefined;
    handleError(new Error("boom"), dependencies);
    assert.equal(process.exitCode, 1);
    assert.match(stderr, /boom/);

    process.exitCode = undefined;
    stderr = "";
    handleError("plain failure", dependencies);
    assert.equal(process.exitCode, 1);
    assert.match(stderr, /plain failure/);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("auth commands cover url, login, exchange, status, and logout flows", async () => {
  const missingClientIdHarness = createCliHarness({ clientId: undefined });
  const missingClientId = await runCli(missingClientIdHarness, ["auth", "url"]);
  assert.equal(missingClientId.exitCode, 1);
  assert.match(missingClientIdHarness.errors.join(""), /Client id is required/);

  const missingCredentialsHarness = createCliHarness({ clientSecret: undefined });
  const missingCredentials = await runCli(missingCredentialsHarness, ["auth", "exchange", "code"]);
  assert.equal(missingCredentials.exitCode, 1);
  assert.match(missingCredentialsHarness.errors.join(""), /Client credentials are required/);

  const missingClientForExchangeHarness = createCliHarness({ clientId: undefined });
  const missingClientForExchange = await runCli(missingClientForExchangeHarness, ["auth", "exchange", "code"]);
  assert.equal(missingClientForExchange.exitCode, 1);
  assert.match(missingClientForExchangeHarness.errors.join(""), /Client credentials are required/);

  const authUrlHarness = createCliHarness();
  await runCli(authUrlHarness, ["auth", "url", "--state", "fixed-state"]);
  assert.deepEqual(authUrlHarness.outputs.at(-1), {
    url: "https://auth.example.test/authorize",
    state: "fixed-state",
  });

  const noLoopbackHarness = createCliHarness({
    redirectUri: "https://example.com/callback",
  });
  noLoopbackHarness.dependencies.isLoopbackRedirect = () => false;
  await runCli(noLoopbackHarness, ["auth", "login"]);
  assert.deepEqual(noLoopbackHarness.outputs.at(-1), {
    ok: false,
    reason:
      "redirect_uri is not a local HTTP callback. Open the URL above and then run `ticktick auth exchange <code>`.",
  });

  const loginHarness = createCliHarness();
  await runCli(loginHarness, ["auth", "login", "--timeout-ms", "500"]);
  assert.match(loginHarness.errors.join(""), /Authorize URL:/);
  assert.equal(loginHarness.savedConfigs.at(-1)?.accessToken, "token-123");
  assert.deepEqual(loginHarness.outputs.at(-1), { access_token: "token-123" });

  const exchangeHarness = createCliHarness();
  await runCli(exchangeHarness, ["auth", "exchange", "manual-code"]);
  assert.equal(exchangeHarness.savedConfigs.at(-1)?.accessToken, "token-123");

  const statusHarness = createCliHarness();
  await runCli(statusHarness, ["auth", "status"]);
  assert.equal(
    (statusHarness.outputs.at(-1) as { clientSecret: string }).clientSecret,
    "sto***ret",
  );
  await runCli(statusHarness, ["auth", "status", "--show-secrets"]);
  assert.equal(
    (statusHarness.outputs.at(-1) as { clientSecret: string }).clientSecret,
    "stored-secret",
  );

  const logoutHarness = createCliHarness();
  await runCli(logoutHarness, ["auth", "logout"]);
  assert.equal(logoutHarness.savedConfigs.at(-1)?.accessToken, undefined);
  assert.deepEqual(logoutHarness.outputs.at(-1), { ok: true });
});

test("config commands validate keys and persist expected values", async () => {
  const showHarness = createCliHarness();
  await runCli(showHarness, ["--service", "dida365", "config", "show", "--show-secrets"]);
  assert.equal((showHarness.outputs.at(-1) as { service: string }).service, "dida365");
  assert.equal(
    (showHarness.outputs.at(-1) as { clientSecret: string }).clientSecret,
    "stored-secret",
  );
  await runCli(showHarness, ["config", "show"]);
  assert.equal(
    (showHarness.outputs.at(-1) as { clientSecret: string }).clientSecret,
    "sto***ret",
  );

  const setHarness = createCliHarness();
  await runCli(setHarness, ["config", "set", "service", "dida365"]);
  assert.equal(setHarness.savedConfigs.at(-1)?.service, "dida365");
  await runCli(setHarness, ["config", "set", "clientId", "next-client-id"]);
  assert.equal(setHarness.savedConfigs.at(-1)?.clientId, "next-client-id");

  const unsetHarness = createCliHarness();
  await runCli(unsetHarness, ["config", "unset", "clientSecret"]);
  assert.equal(unsetHarness.savedConfigs.at(-1)?.clientSecret, undefined);

  const badSetHarness = createCliHarness();
  const badSet = await runCli(badSetHarness, ["config", "set", "nope", "value"]);
  assert.equal(badSet.exitCode, 1);
  assert.match(badSetHarness.errors.join(""), /Unsupported config key "nope"/);

  const badUnsetHarness = createCliHarness();
  const badUnset = await runCli(badUnsetHarness, ["config", "unset", "nope"]);
  assert.equal(badUnset.exitCode, 1);
  assert.match(badUnsetHarness.errors.join(""), /Unsupported config key "nope"/);
});

test("task, project, and request commands delegate payloads correctly", async () => {
  const harness = createCliHarness();

  await runCli(harness, ["task", "get", "project-1", "task-1"]);
  await runCli(harness, [
    "task",
    "create",
    "--project-id",
    "project-1",
    "--title",
    "Ship v1",
    "--all-day",
    "true",
  ]);
  await runCli(harness, [
    "task",
    "update",
    "task-1",
    "--project-id",
    "project-1",
    "--priority",
    "3",
  ]);
  await runCli(harness, ["task", "complete", "project-1", "task-1"]);
  await runCli(harness, ["task", "delete", "project-1", "task-1"]);
  await runCli(harness, [
    "task",
    "move",
    "--from-project-id",
    "source",
    "--to-project-id",
    "target",
    "--task-id",
    "task-1",
  ]);
  await runCli(harness, [
    "task",
    "completed",
    "--project-id",
    "project-1",
    "--project-id",
    "project-2",
    "--start-date",
    "2026-03-01T00:00:00+0000",
  ]);
  await runCli(harness, [
    "task",
    "completed",
    "--end-date",
    "2026-03-02T00:00:00+0000",
  ]);
  await runCli(harness, [
    "task",
    "filter",
    "--project-id",
    "project-1",
    "--project-id",
    "project-2",
    "--priority",
    "1",
    "--priority",
    "3",
    "--tag",
    "urgent",
    "--tag",
    "home",
    "--status",
    "0",
    "--status",
    "2",
  ]);
  await runCli(harness, [
    "task",
    "filter",
    "--start-date",
    "2026-03-01T00:00:00+0000",
  ]);
  await runCli(harness, ["project", "list"]);
  await runCli(harness, ["project", "get", "project-1"]);
  await runCli(harness, ["project", "data", "project-1"]);
  await runCli(harness, ["project", "create", "--name", "Inbox", "--kind", "TASK"]);
  await runCli(harness, [
    "project",
    "create",
    "--json",
    '{"name":"Json Inbox","kind":"TASK"}',
    "--color",
    "#F18181",
  ]);
  await runCli(harness, ["project", "update", "project-1", "--color", "#F18181"]);
  await runCli(harness, ["project", "delete", "project-1"]);
  await runCli(harness, [
    "request",
    "POST",
    "/open/v1/project",
    "--no-auth",
    "--json",
    '{"name":"Inbox"}',
  ]);
  await runCli(harness, ["request", "GET", "/open/v1/project"]);

  assert.deepEqual(
    harness.clientCalls.map((call) => call.method),
    [
      "getTask",
      "createTask",
      "updateTask",
      "completeTask",
      "deleteTask",
      "moveTasks",
      "listCompletedTasks",
      "listCompletedTasks",
      "filterTasks",
      "filterTasks",
      "listProjects",
      "getProject",
      "getProjectData",
      "createProject",
      "createProject",
      "updateProject",
      "deleteProject",
      "requestRaw",
      "requestRaw",
    ],
  );

  assert.deepEqual(harness.outputs.at(-1), { ok: true });
});

test("CLI surfaces validation errors for malformed payloads and missing required fields", async () => {
  const createHarness = createCliHarness();
  const createResult = await runCli(createHarness, ["task", "create", "--title", "Missing project"]);
  assert.equal(createResult.exitCode, 1);
  assert.match(createHarness.errors.join(""), /Task creation requires both projectId and title/);

  const updateHarness = createCliHarness();
  const updateResult = await runCli(updateHarness, ["task", "update", "task-1"]);
  assert.equal(updateResult.exitCode, 1);
  assert.match(updateHarness.errors.join(""), /Task update requires projectId/);

  const moveHarness = createCliHarness();
  const moveResult = await runCli(moveHarness, ["task", "move"]);
  assert.equal(moveResult.exitCode, 1);
  assert.match(moveHarness.errors.join(""), /Provide --json\/--json-file or all of/);

  const moveJsonHarness = createCliHarness();
  const moveJsonResult = await runCli(moveJsonHarness, [
    "task",
    "move",
    "--json",
    '{"not":"an-array"}',
  ]);
  assert.equal(moveJsonResult.exitCode, 1);
  assert.match(moveJsonHarness.errors.join(""), /Move payload must be a JSON array/);

  const projectCreateHarness = createCliHarness();
  const projectCreateResult = await runCli(projectCreateHarness, ["project", "create"]);
  assert.equal(projectCreateResult.exitCode, 1);
  assert.match(projectCreateHarness.errors.join(""), /Project creation requires name/);

  const badJsonHarness = createCliHarness();
  const badJsonResult = await runCli(badJsonHarness, [
    "project",
    "create",
    "--json",
    "[1,2,3]",
  ]);
  assert.equal(badJsonResult.exitCode, 1);
  assert.match(badJsonHarness.errors.join(""), /Expected a JSON object payload/);
});
