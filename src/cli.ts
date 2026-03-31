import { Command } from "commander";
import { pathToFileURL } from "node:url";

import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  isLoopbackRedirect,
  openBrowser,
  waitForOAuthCode,
} from "./auth.js";
import { TickTickClient } from "./client.js";
import {
  loadStoredConfig,
  resolveRuntimeConfig,
  saveStoredConfig,
  validateService,
} from "./config.js";
import type {
  CompletedTasksFilter,
  FilterTasksRequest,
  MoveTaskOperation,
  Project,
  RuntimeConfig,
  StoredConfig,
  Task,
  TokenResponse,
} from "./types.js";
import {
  loadJsonValue,
  maskSecret,
  mergeDefined,
  parseBoolean,
  parseInteger,
  printJson,
} from "./utils.js";

type CommonOptions = {
  configFile?: string;
  service?: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
};

type JsonOptions = {
  json?: string;
  jsonFile?: string;
};

type TickTickClientLike = Pick<
  TickTickClient,
  | "getTask"
  | "createTask"
  | "updateTask"
  | "completeTask"
  | "deleteTask"
  | "moveTasks"
  | "listCompletedTasks"
  | "filterTasks"
  | "listProjects"
  | "getProject"
  | "getProjectData"
  | "createProject"
  | "updateProject"
  | "deleteProject"
  | "requestRaw"
>;

export interface CliDependencies {
  buildAuthorizationUrl: typeof buildAuthorizationUrl;
  exchangeAuthorizationCode: typeof exchangeAuthorizationCode;
  isLoopbackRedirect: typeof isLoopbackRedirect;
  loadJsonValue: typeof loadJsonValue;
  loadStoredConfig: typeof loadStoredConfig;
  maskSecret: typeof maskSecret;
  mergeDefined: typeof mergeDefined;
  openBrowser: typeof openBrowser;
  printJson: typeof printJson;
  resolveRuntimeConfig: typeof resolveRuntimeConfig;
  saveStoredConfig: typeof saveStoredConfig;
  validateService: typeof validateService;
  waitForOAuthCode: typeof waitForOAuthCode;
  createClient: (config: RuntimeConfig) => TickTickClientLike;
  stderr: (text: string) => void;
}

const CONFIG_KEYS = new Set<keyof StoredConfig>([
  "service",
  "clientId",
  "clientSecret",
  "redirectUri",
  "scopes",
  "accessToken",
  "apiBaseUrl",
  "authBaseUrl",
]);

export const defaultCliDependencies: CliDependencies = {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  isLoopbackRedirect,
  loadJsonValue,
  loadStoredConfig,
  maskSecret,
  mergeDefined,
  openBrowser,
  printJson,
  resolveRuntimeConfig,
  saveStoredConfig,
  validateService,
  waitForOAuthCode,
  createClient: (config) => new TickTickClient(config),
  stderr: (text) => process.stderr.write(text),
};

export function createProgram(
  dependencies: CliDependencies = defaultCliDependencies,
): Command {
  const program = new Command();

  program
    .name("ticktick")
    .description("CLI wrapper for the TickTick Open API")
    .option("--config-file <path>", "Custom config file path")
    .option("--service <service>", 'Service: "ticktick" or "dida365"')
    .option("--api-base-url <url>", "Override the API base URL")
    .option("--auth-base-url <url>", "Override the OAuth base URL")
    .option("--access-token <token>", "Override the access token for a single command")
    .option("--client-id <id>", "Override the OAuth client id")
    .option("--client-secret <secret>", "Override the OAuth client secret")
    .option("--redirect-uri <uri>", "Override the OAuth redirect URI")
    .option("--scopes <scopes>", "Override the OAuth scopes");

  buildAuthCommands(program, dependencies);
  buildConfigCommands(program, dependencies);
  buildTaskCommands(program, dependencies);
  buildProjectCommands(program, dependencies);
  buildRequestCommand(program, dependencies);

  return program;
}

export async function main(
  argv: string[] = process.argv,
  dependencies: CliDependencies = defaultCliDependencies,
): Promise<void> {
  const program = createProgram(dependencies);

  try {
    await program.parseAsync(argv);
  } catch (error) {
    handleError(error, dependencies);
  }
}

export function handleError(
  error: unknown,
  dependencies: Pick<CliDependencies, "stderr"> = defaultCliDependencies,
): void {
  const message = error instanceof Error ? error.message : String(error);
  dependencies.stderr(`${message}\n`);
  process.exitCode = 1;
}

function buildAuthCommands(root: Command, dependencies: CliDependencies): void {
  const auth = root.command("auth").description("OAuth and token management");

  auth
    .command("url")
    .description("Print the OAuth authorize URL without opening a browser")
    .option("--state <value>", "Override the OAuth state value")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const options = command.optsWithGlobals<CommonOptions>() as CommonOptions & {
        state?: string;
      };
      const config = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(options, dependencies),
      );

      requireClientId(config);
      dependencies.printJson(dependencies.buildAuthorizationUrl(config, options.state));
    });

  auth
    .command("login")
    .description("Open the OAuth flow, exchange the code, and store the access token")
    .option("--timeout-ms <number>", "Timeout while waiting for the callback", parseInteger, 120000)
    .option("--show-secrets", "Include access token and refresh token in the output")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const options = command.optsWithGlobals<CommonOptions>() as CommonOptions & {
        timeoutMs: number;
        showSecrets?: boolean;
      };

      const config = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(options, dependencies),
      );
      requireClientCredentials(config);

      const { url, state } = dependencies.buildAuthorizationUrl(config);
      dependencies.stderr(`Authorize URL:\n${url}\n`);

      if (!dependencies.isLoopbackRedirect(config.redirectUri)) {
        dependencies.printJson({
          ok: false,
          reason:
            "redirect_uri is not a local HTTP callback. Open the URL above and then run `ticktick auth exchange <code>`.",
        });
        return;
      }

      dependencies.stderr(`Waiting for OAuth callback on ${config.redirectUri}...\n`);
      const codePromise = dependencies.waitForOAuthCode(
        config.redirectUri!,
        state,
        options.timeoutMs,
      );
      await dependencies.openBrowser(url);

      const code = await codePromise;
      const token = await dependencies.exchangeAuthorizationCode(config, code);
      await persistConfig(config, token, dependencies);

      dependencies.printJson(formatAuthSuccess(config, token, options.showSecrets, dependencies));
    });

  auth
    .command("exchange <code>")
    .description("Exchange an authorization code for an access token")
    .option("--show-secrets", "Include access token and refresh token in the output")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const [code] = args as [string, Command];
      const options = command.optsWithGlobals<CommonOptions>() as CommonOptions & {
        showSecrets?: boolean;
      };
      const config = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(options, dependencies),
      );

      requireClientCredentials(config);

      const token = await dependencies.exchangeAuthorizationCode(config, code);
      await persistConfig(config, token, dependencies);

      dependencies.printJson(formatAuthSuccess(config, token, options.showSecrets, dependencies));
    });

  auth
    .command("status")
    .description("Show the resolved auth configuration")
    .option("--show-secrets", "Include client secret and access token")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const options = command.optsWithGlobals<CommonOptions>() as CommonOptions & {
        showSecrets?: boolean;
      };
      const config = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(options, dependencies),
      );

      dependencies.printJson({
        service: config.service,
        configFile: config.configFile,
        clientId: config.clientId,
        clientSecret: options.showSecrets
          ? config.clientSecret
          : dependencies.maskSecret(config.clientSecret),
        redirectUri: config.redirectUri,
        scopes: config.scopes,
        accessToken: options.showSecrets
          ? config.accessToken
          : dependencies.maskSecret(config.accessToken),
        apiBaseUrl: config.apiBaseUrl,
        authBaseUrl: config.authBaseUrl,
      });
    });

  auth
    .command("logout")
    .description("Remove the stored access token from the config file")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const config = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(command.optsWithGlobals<CommonOptions>(), dependencies),
      );
      const stored = await dependencies.loadStoredConfig(config.configFile);

      delete stored.accessToken;
      await dependencies.saveStoredConfig(config.configFile, stored);

      dependencies.printJson({ ok: true });
    });
}

function buildConfigCommands(root: Command, dependencies: CliDependencies): void {
  const config = root.command("config").description("Read and write local CLI config");

  config
    .command("show")
    .description("Show the resolved configuration")
    .option("--show-secrets", "Include stored secrets")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const options = command.optsWithGlobals<CommonOptions>() as CommonOptions & {
        showSecrets?: boolean;
      };
      const resolved = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(options, dependencies),
      );

      dependencies.printJson({
        service: resolved.service,
        configFile: resolved.configFile,
        clientId: resolved.clientId,
        clientSecret: options.showSecrets
          ? resolved.clientSecret
          : dependencies.maskSecret(resolved.clientSecret),
        redirectUri: resolved.redirectUri,
        scopes: resolved.scopes,
        accessToken: options.showSecrets
          ? resolved.accessToken
          : dependencies.maskSecret(resolved.accessToken),
        apiBaseUrl: resolved.apiBaseUrl,
        authBaseUrl: resolved.authBaseUrl,
      });
    });

  config
    .command("set <key> <value>")
    .description("Set a config value in the local config file")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const [key, value] = args as [string, string, Command];
      const runtime = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(command.optsWithGlobals<CommonOptions>(), dependencies),
      );

      if (!CONFIG_KEYS.has(key as keyof StoredConfig)) {
        throw new Error(
          `Unsupported config key "${key}". Allowed keys: ${Array.from(CONFIG_KEYS).join(", ")}`,
        );
      }

      const stored = await dependencies.loadStoredConfig(runtime.configFile);
      const normalizedValue =
        key === "service" ? dependencies.validateService(value) : value;
      const next = { ...stored, [key]: normalizedValue };

      await dependencies.saveStoredConfig(runtime.configFile, next);
      dependencies.printJson(next);
    });

  config
    .command("unset <key>")
    .description("Remove a config value from the local config file")
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command;
      const [key] = args as [string, Command];
      const runtime = await dependencies.resolveRuntimeConfig(
        runtimeOverrides(command.optsWithGlobals<CommonOptions>(), dependencies),
      );

      if (!CONFIG_KEYS.has(key as keyof StoredConfig)) {
        throw new Error(
          `Unsupported config key "${key}". Allowed keys: ${Array.from(CONFIG_KEYS).join(", ")}`,
        );
      }

      const stored = await dependencies.loadStoredConfig(runtime.configFile);
      delete stored[key as keyof StoredConfig];
      await dependencies.saveStoredConfig(runtime.configFile, stored);

      dependencies.printJson(stored);
    });
}

function buildTaskCommands(root: Command, dependencies: CliDependencies): void {
  const task = root.command("task").description("Task endpoints");

  task
    .command("get <projectId> <taskId>")
    .description("Get a task by project id and task id")
    .action(async (...args: unknown[]) => {
      const [projectId, taskId] = args as [string, string, Command];
      await runClientCommand(args, dependencies, (client) => client.getTask(projectId, taskId));
    });

  withJsonBody(
    task
      .command("create")
      .description("Create a task")
      .option("--project-id <id>", "Project id")
      .option("--title <title>", "Task title")
      .option("--content <content>", "Task content")
      .option("--desc <desc>", "Task description")
      .option("--start-date <date>", "Start date in yyyy-MM-dd'T'HH:mm:ssZ format")
      .option("--due-date <date>", "Due date in yyyy-MM-dd'T'HH:mm:ssZ format")
      .option("--time-zone <tz>", "Time zone")
      .option("--repeat-flag <rrule>", "Recurring rule")
      .option("--priority <number>", "Priority", parseInteger)
      .option("--sort-order <number>", "Sort order", parseInteger)
      .option("--all-day <boolean>", "All day", parseBoolean),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          projectId?: string;
          title?: string;
          content?: string;
          desc?: string;
          startDate?: string;
          dueDate?: string;
          timeZone?: string;
          repeatFlag?: string;
          priority?: number;
          sortOrder?: number;
          allDay?: boolean;
        }
    >();

    const payload = (await loadObjectPayload(
      options,
      {
        projectId: options.projectId,
        title: options.title,
        content: options.content,
        desc: options.desc,
        startDate: options.startDate,
        dueDate: options.dueDate,
        timeZone: options.timeZone,
        repeatFlag: options.repeatFlag,
        priority: options.priority,
        sortOrder: options.sortOrder,
        isAllDay: options.allDay,
      },
      dependencies,
    )) as Partial<Task>;

    if (!payload.projectId || !payload.title) {
      throw new Error("Task creation requires both projectId and title.");
    }

    await runClientCommand(args, dependencies, (client) => client.createTask(payload));
  });

  withJsonBody(
    task
      .command("update <taskId>")
      .description("Update a task")
      .option("--project-id <id>", "Project id")
      .option("--title <title>", "Task title")
      .option("--content <content>", "Task content")
      .option("--desc <desc>", "Task description")
      .option("--start-date <date>", "Start date in yyyy-MM-dd'T'HH:mm:ssZ format")
      .option("--due-date <date>", "Due date in yyyy-MM-dd'T'HH:mm:ssZ format")
      .option("--time-zone <tz>", "Time zone")
      .option("--repeat-flag <rrule>", "Recurring rule")
      .option("--priority <number>", "Priority", parseInteger)
      .option("--sort-order <number>", "Sort order", parseInteger)
      .option("--all-day <boolean>", "All day", parseBoolean),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const [taskId] = args as [string, Command];
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          projectId?: string;
          title?: string;
          content?: string;
          desc?: string;
          startDate?: string;
          dueDate?: string;
          timeZone?: string;
          repeatFlag?: string;
          priority?: number;
          sortOrder?: number;
          allDay?: boolean;
        }
    >();

    const payload = (await loadObjectPayload(
      options,
      {
        id: taskId,
        projectId: options.projectId,
        title: options.title,
        content: options.content,
        desc: options.desc,
        startDate: options.startDate,
        dueDate: options.dueDate,
        timeZone: options.timeZone,
        repeatFlag: options.repeatFlag,
        priority: options.priority,
        sortOrder: options.sortOrder,
        isAllDay: options.allDay,
      },
      dependencies,
    )) as Partial<Task>;

    payload.id = taskId;

    if (!payload.projectId) {
      throw new Error("Task update requires projectId.");
    }

    await runClientCommand(args, dependencies, (client) => client.updateTask(taskId, payload));
  });

  task
    .command("complete <projectId> <taskId>")
    .description("Complete a task")
    .action(async (...args: unknown[]) => {
      const [projectId, taskId] = args as [string, string, Command];
      await runClientCommand(args, dependencies, (client) =>
        client.completeTask(projectId, taskId),
      );
    });

  task
    .command("delete <projectId> <taskId>")
    .description("Delete a task")
    .action(async (...args: unknown[]) => {
      const [projectId, taskId] = args as [string, string, Command];
      await runClientCommand(args, dependencies, (client) =>
        client.deleteTask(projectId, taskId),
      );
    });

  withJsonBody(
    task
      .command("move")
      .description("Move one or more tasks between projects")
      .option("--from-project-id <id>", "Source project id")
      .option("--to-project-id <id>", "Destination project id")
      .option("--task-id <id>", "Task id"),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          fromProjectId?: string;
          toProjectId?: string;
          taskId?: string;
        }
    >();

    let payload = (await dependencies.loadJsonValue(
      options.json,
      options.jsonFile,
    )) as MoveTaskOperation[] | undefined;

    if (!payload) {
      if (!options.fromProjectId || !options.toProjectId || !options.taskId) {
        throw new Error(
          "Provide --json/--json-file or all of --from-project-id, --to-project-id, and --task-id.",
        );
      }

      payload = [
        {
          fromProjectId: options.fromProjectId,
          toProjectId: options.toProjectId,
          taskId: options.taskId,
        },
      ];
    }

    if (!Array.isArray(payload)) {
      throw new Error("Move payload must be a JSON array.");
    }

    await runClientCommand(args, dependencies, (client) => client.moveTasks(payload));
  });

  withJsonBody(
    task
      .command("completed")
      .description("List completed tasks")
      .option("--project-id <id>", "Project id", collectString, [])
      .option("--start-date <date>", "Start of completedTime range")
      .option("--end-date <date>", "End of completedTime range"),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          projectId?: string[];
          startDate?: string;
          endDate?: string;
        }
    >();

    const payload = (await loadObjectPayload(
      options,
      {
        projectIds:
          options.projectId && options.projectId.length > 0 ? options.projectId : undefined,
        startDate: options.startDate,
        endDate: options.endDate,
      },
      dependencies,
    )) as CompletedTasksFilter;

    await runClientCommand(args, dependencies, (client) => client.listCompletedTasks(payload));
  });

  withJsonBody(
    task
      .command("filter")
      .description("Filter tasks")
      .option("--project-id <id>", "Project id", collectString, [])
      .option("--start-date <date>", "Start date lower bound")
      .option("--end-date <date>", "Start date upper bound")
      .option("--priority <number>", "Priority filter", collectInteger, [])
      .option("--tag <tag>", "Tag filter", collectString, [])
      .option("--status <number>", "Status filter", collectInteger, []),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          projectId?: string[];
          startDate?: string;
          endDate?: string;
          priority?: number[];
          tag?: string[];
          status?: number[];
        }
    >();

    const payload = (await loadObjectPayload(
      options,
      {
        projectIds:
          options.projectId && options.projectId.length > 0 ? options.projectId : undefined,
        startDate: options.startDate,
        endDate: options.endDate,
        priority:
          options.priority && options.priority.length > 0 ? options.priority : undefined,
        tag: options.tag && options.tag.length > 0 ? options.tag : undefined,
        status: options.status && options.status.length > 0 ? options.status : undefined,
      },
      dependencies,
    )) as FilterTasksRequest;

    await runClientCommand(args, dependencies, (client) => client.filterTasks(payload));
  });
}

function buildProjectCommands(root: Command, dependencies: CliDependencies): void {
  const project = root.command("project").description("Project endpoints");

  project
    .command("list")
    .description("List user projects")
    .action(async (...args: unknown[]) => {
      await runClientCommand(args, dependencies, (client) => client.listProjects());
    });

  project
    .command("get <projectId>")
    .description("Get a project by id")
    .action(async (...args: unknown[]) => {
      const [projectId] = args as [string, Command];
      await runClientCommand(args, dependencies, (client) => client.getProject(projectId));
    });

  project
    .command("data <projectId>")
    .description("Get a project together with tasks and columns")
    .action(async (...args: unknown[]) => {
      const [projectId] = args as [string, Command];
      await runClientCommand(args, dependencies, (client) => client.getProjectData(projectId));
    });

  withJsonBody(
    project
      .command("create")
      .description("Create a project")
      .option("--name <name>", "Project name")
      .option("--color <color>", 'Project color, for example "#F18181"')
      .option("--sort-order <number>", "Sort order", parseInteger)
      .option("--view-mode <mode>", 'View mode: "list", "kanban", or "timeline"')
      .option("--kind <kind>", 'Kind: "TASK" or "NOTE"'),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          name?: string;
          color?: string;
          sortOrder?: number;
          viewMode?: string;
          kind?: string;
        }
    >();

    const payload = (await loadObjectPayload(
      options,
      {
        name: options.name,
        color: options.color,
        sortOrder: options.sortOrder,
        viewMode: options.viewMode,
        kind: options.kind,
      },
      dependencies,
    )) as Partial<Project>;

    if (!payload.name) {
      throw new Error("Project creation requires name.");
    }

    await runClientCommand(args, dependencies, (client) => client.createProject(payload));
  });

  withJsonBody(
    project
      .command("update <projectId>")
      .description("Update a project")
      .option("--name <name>", "Project name")
      .option("--color <color>", 'Project color, for example "#F18181"')
      .option("--sort-order <number>", "Sort order", parseInteger)
      .option("--view-mode <mode>", 'View mode: "list", "kanban", or "timeline"')
      .option("--kind <kind>", 'Kind: "TASK" or "NOTE"'),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const [projectId] = args as [string, Command];
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          name?: string;
          color?: string;
          sortOrder?: number;
          viewMode?: string;
          kind?: string;
        }
    >();

    const payload = (await loadObjectPayload(
      options,
      {
        name: options.name,
        color: options.color,
        sortOrder: options.sortOrder,
        viewMode: options.viewMode,
        kind: options.kind,
      },
      dependencies,
    )) as Partial<Project>;

    await runClientCommand(args, dependencies, (client) =>
      client.updateProject(projectId, payload),
    );
  });

  project
    .command("delete <projectId>")
    .description("Delete a project")
    .action(async (...args: unknown[]) => {
      const [projectId] = args as [string, Command];
      await runClientCommand(args, dependencies, (client) => client.deleteProject(projectId));
    });
}

function buildRequestCommand(root: Command, dependencies: CliDependencies): void {
  withJsonBody(
    root
      .command("request <method> <path>")
      .description("Send a raw request to the configured API base URL, or to a full URL")
      .option("--no-auth", "Skip bearer auth on this request"),
  ).action(async (...args: unknown[]) => {
    const command = args.at(-1) as Command;
    const [method, path] = args as [string, string, Command];
    const options = command.optsWithGlobals<
      CommonOptions &
        JsonOptions & {
          auth?: boolean;
        }
    >();

    const config = await dependencies.resolveRuntimeConfig(
      runtimeOverrides(options, dependencies),
    );
    const client = dependencies.createClient(config);
    const body = await dependencies.loadJsonValue(options.json, options.jsonFile);
    const result = await client.requestRaw(method.toUpperCase(), path, body, {
      auth: options.auth,
    });

    dependencies.printJson(result ?? { ok: true });
  });
}

function withJsonBody(command: Command): Command {
  return command
    .option("--json <json>", "Inline JSON body")
    .option("--json-file <path>", "Path to a JSON body file");
}

function runtimeOverrides(
  options: CommonOptions,
  dependencies: Pick<CliDependencies, "validateService">,
) {
  return {
    configFile: options.configFile,
    service: options.service ? dependencies.validateService(options.service) : undefined,
    apiBaseUrl: options.apiBaseUrl,
    authBaseUrl: options.authBaseUrl,
    accessToken: options.accessToken,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    redirectUri: options.redirectUri,
    scopes: options.scopes,
  };
}

async function runClientCommand(
  args: unknown[],
  dependencies: CliDependencies,
  runner: (client: TickTickClientLike, config: RuntimeConfig) => Promise<unknown>,
): Promise<void> {
  const command = args.at(-1) as Command;
  const config = await dependencies.resolveRuntimeConfig(
    runtimeOverrides(command.optsWithGlobals<CommonOptions>(), dependencies),
  );
  const client = dependencies.createClient(config);
  const result = await runner(client, config);

  dependencies.printJson(result ?? { ok: true });
}

async function loadObjectPayload(
  options: JsonOptions,
  flags: Record<string, unknown>,
  dependencies: Pick<CliDependencies, "loadJsonValue" | "mergeDefined">,
): Promise<Record<string, unknown>> {
  const loaded = await dependencies.loadJsonValue(options.json, options.jsonFile);

  if (loaded === undefined) {
    return dependencies.mergeDefined({}, flags);
  }

  if (!isPlainObject(loaded)) {
    throw new Error("Expected a JSON object payload.");
  }

  return dependencies.mergeDefined(loaded, flags);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function persistConfig(
  runtime: RuntimeConfig,
  token: TokenResponse,
  dependencies: Pick<CliDependencies, "loadStoredConfig" | "saveStoredConfig">,
): Promise<void> {
  const stored = await dependencies.loadStoredConfig(runtime.configFile);
  const next: StoredConfig = {
    ...stored,
    service: runtime.service,
    clientId: runtime.clientId,
    clientSecret: runtime.clientSecret,
    redirectUri: runtime.redirectUri,
    scopes: runtime.scopes,
    apiBaseUrl: runtime.apiBaseUrl,
    authBaseUrl: runtime.authBaseUrl,
    accessToken: token.access_token,
  };

  await dependencies.saveStoredConfig(runtime.configFile, next);
}

function formatAuthSuccess(
  runtime: RuntimeConfig,
  token: TokenResponse,
  showSecrets: boolean | undefined,
  dependencies: Pick<CliDependencies, "maskSecret">,
) {
  return {
    ok: true,
    message: "Authorization complete.",
    service: runtime.service,
    configFile: runtime.configFile,
    redirectUri: runtime.redirectUri,
    scope: token.scope ?? runtime.scopes,
    tokenType: token.token_type,
    expiresIn: token.expires_in,
    accessToken: showSecrets
      ? token.access_token
      : dependencies.maskSecret(token.access_token),
    refreshToken: token.refresh_token
      ? showSecrets
        ? token.refresh_token
        : dependencies.maskSecret(token.refresh_token)
      : undefined,
  };
}

function requireClientCredentials(config: RuntimeConfig): void {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Client credentials are required. Set TICKTICK_CLIENT_ID and TICKTICK_CLIENT_SECRET or use `ticktick config set`.",
    );
  }
}

function requireClientId(config: RuntimeConfig): void {
  if (!config.clientId) {
    throw new Error(
      "Client id is required. Set TICKTICK_CLIENT_ID or use `ticktick config set clientId ...`.",
    );
  }
}

function collectString(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function collectInteger(value: string, previous: number[] = []): number[] {
  return [...previous, parseInteger(value)];
}

function isDirectExecution(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}

if (isDirectExecution()) {
  await main();
}
