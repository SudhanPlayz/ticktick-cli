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

test("TickTickClient wrapper methods map to the documented endpoints", async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const client = new TickTickClient(
    config,
    (async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method,
        body: init?.body ? String(init.body) : undefined,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  await client.getTask("project-1", "task-1");
  await client.createTask({ title: "Task", projectId: "project-1" });
  await client.updateTask("task-1", { id: "task-1", projectId: "project-1" });
  await client.completeTask("project-1", "task-1");
  await client.deleteTask("project-1", "task-1");
  await client.moveTasks([{ fromProjectId: "a", toProjectId: "b", taskId: "c" }]);
  await client.listCompletedTasks({ projectIds: ["project-1"] });
  await client.filterTasks({ status: [0] });
  await client.listProjects();
  await client.getProject("project-1");
  await client.getProjectData("project-1");
  await client.createProject({ name: "Inbox" });
  await client.updateProject("project-1", { name: "Inbox" });
  await client.deleteProject("project-1");

  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url}`),
    [
      "GET https://api.ticktick.com/open/v1/project/project-1/task/task-1",
      "POST https://api.ticktick.com/open/v1/task",
      "POST https://api.ticktick.com/open/v1/task/task-1",
      "POST https://api.ticktick.com/open/v1/project/project-1/task/task-1/complete",
      "DELETE https://api.ticktick.com/open/v1/project/project-1/task/task-1",
      "POST https://api.ticktick.com/open/v1/task/move",
      "POST https://api.ticktick.com/open/v1/task/completed",
      "POST https://api.ticktick.com/open/v1/task/filter",
      "GET https://api.ticktick.com/open/v1/project",
      "GET https://api.ticktick.com/open/v1/project/project-1",
      "GET https://api.ticktick.com/open/v1/project/project-1/data",
      "POST https://api.ticktick.com/open/v1/project",
      "POST https://api.ticktick.com/open/v1/project/project-1",
      "DELETE https://api.ticktick.com/open/v1/project/project-1",
    ],
  );
});

test("TickTickClient requestRaw requires auth by default and handles 204/non-json responses", async () => {
  const unauthenticated = new TickTickClient({ ...config, accessToken: undefined });

  await assert.rejects(
    () => unauthenticated.requestRaw("GET", "/open/v1/project"),
    /No access token available/,
  );

  let callCount = 0;
  const client = new TickTickClient(
    config,
    (async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response(null, { status: 204 });
      }

      return new Response("plain-text-response", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }) as typeof fetch,
  );

  assert.equal(await client.requestRaw("DELETE", "/open/v1/project/project-1"), undefined);
  assert.equal(await client.requestRaw("GET", "/open/v1/project/project-1"), "plain-text-response");

  const publicClient = new TickTickClient(
    { ...config, accessToken: undefined },
    (async () =>
      new Response("public-response", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })) as typeof fetch,
  );

  const noAuthResult = await publicClient.requestRaw("GET", "https://example.test/public", undefined, {
    auth: false,
  });
  assert.equal(noAuthResult, "public-response");
});

test("TickTickClient throws typed errors for JSON and text failures and can skip auth", async () => {
  const jsonFailure = new TickTickClient(
    config,
    (async () =>
      new Response(JSON.stringify({ message: "boom" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
  );

  await assert.rejects(() => jsonFailure.listProjects(), (error: unknown) => {
    assert.ok(error instanceof TickTickApiError);
    assert.equal(error.status, 403);
    assert.deepEqual(error.payload, { message: "boom" });
    return true;
  });

  const textFailure = new TickTickClient(
    config,
    (async () =>
      new Response("bad gateway", {
        status: 502,
        headers: { "Content-Type": "text/plain" },
      })) as typeof fetch,
  );

  await assert.rejects(() => textFailure.requestRaw("GET", "/open/v1/project"), (error: unknown) => {
    assert.ok(error instanceof TickTickApiError);
    assert.equal(error.status, 502);
    assert.equal(error.payload, "bad gateway");
    return true;
  });

  let authHeader: string | null = null;
  const noAuthClient = new TickTickClient(
    config,
    (async (_input, init) => {
      authHeader = ((init?.headers as Record<string, string>)?.Authorization ?? null);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );

  const result = await noAuthClient.requestRaw(
    "POST",
    "https://example.test/custom",
    { hello: "world" },
    { auth: false },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(authHeader, null);

  const emptySuccess = new TickTickClient(
    config,
    (async () =>
      new Response("", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
  );

  assert.equal(
    await emptySuccess.requestRaw("GET", "/open/v1/project", undefined, { auth: true }),
    undefined,
  );

  const noBodyError = new TickTickApiError(500, undefined);
  assert.equal(noBodyError.message, "TickTick API request failed with status 500: No response body");

  const emptyFailure = new TickTickClient(
    config,
    (async () =>
      new Response("", {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch,
  );

  await assert.rejects(() => emptyFailure.requestRaw("GET", "/open/v1/project"), (error: unknown) => {
    assert.ok(error instanceof TickTickApiError);
    assert.equal(error.status, 500);
    assert.equal(error.payload, "");
    return true;
  });
});
