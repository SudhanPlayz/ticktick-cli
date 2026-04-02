import type {
  CompletedTasksFilter,
  FilterTasksRequest,
  MoveTaskOperation,
  MoveTaskResult,
  Project,
  ProjectData,
  RuntimeConfig,
  Task,
  TaskWithProject,
} from "./types.js";

export class TickTickApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    const summary =
      typeof payload === "string"
        ? payload
        : payload
          ? JSON.stringify(payload)
          : "No response body";

    super(`TickTick API request failed with status ${status}: ${summary}`);
    this.name = "TickTickApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class TickTickClient {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async requestRaw<T>(
    method: string,
    pathOrUrl: string,
    body?: unknown,
    options: { auth?: boolean } = {},
  ): Promise<T | undefined> {
    const requiresAuth = options.auth ?? true;

    if (requiresAuth && !this.config.accessToken) {
      throw new Error(
        "No access token available. Run `ticktick auth login` or provide TICKTICK_ACCESS_TOKEN.",
      );
    }

    const url = /^https?:\/\//.test(pathOrUrl)
      ? pathOrUrl
      : `${this.config.apiBaseUrl}${pathOrUrl}`;

    const response = await this.fetchImpl(
      url,
      {
        method,
        headers: {
          ...(requiresAuth
            ? { Authorization: `Bearer ${this.config.accessToken}` }
            : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
    );

    if (response.status === 204) {
      return undefined;
    }

    const raw = await response.text();
    const parsed = raw.length > 0 ? tryParseJson(raw) : undefined;

    if (!response.ok) {
      throw new TickTickApiError(response.status, parsed ?? raw);
    }

    return parsed as T | undefined;
  }

  getTask(projectId: string, taskId: string) {
    return this.requestRaw<Task>("GET", `/open/v1/project/${projectId}/task/${taskId}`);
  }

  createTask(payload: Partial<Task>) {
    return this.requestRaw<Task>("POST", "/open/v1/task", payload);
  }

  updateTask(taskId: string, payload: Partial<Task>) {
    return this.requestRaw<Task>("POST", `/open/v1/task/${taskId}`, payload);
  }

  completeTask(projectId: string, taskId: string) {
    return this.requestRaw<void>(
      "POST",
      `/open/v1/project/${projectId}/task/${taskId}/complete`,
    );
  }

  deleteTask(projectId: string, taskId: string) {
    return this.requestRaw<void>(
      "DELETE",
      `/open/v1/project/${projectId}/task/${taskId}`,
    );
  }

  moveTasks(payload: MoveTaskOperation[]) {
    return this.requestRaw<MoveTaskResult[]>("POST", "/open/v1/task/move", payload);
  }

  listCompletedTasks(payload: CompletedTasksFilter) {
    return this.requestRaw<Task[]>("POST", "/open/v1/task/completed", payload);
  }

  filterTasks(payload: FilterTasksRequest) {
    return this.requestRaw<Task[]>("POST", "/open/v1/task/filter", payload);
  }

  async listOpenTasksWithProjects(): Promise<TaskWithProject[]> {
    const tasks = ((await this.filterTasks({ status: [0] })) ?? []).filter(isOpenTask);
    const projectNames = new Map<string, string>();
    const projects = (await this.listProjects()) ?? [];

    for (const project of projects) {
      if (project.id && project.name) {
        projectNames.set(project.id, project.name);
      }
    }

    const missingProjectIds = Array.from(
      new Set(
        tasks
          .map((task) => task.projectId)
          .filter((projectId): projectId is string => Boolean(projectId && !projectNames.has(projectId))),
      ),
    );

    await Promise.all(
      missingProjectIds.map(async (projectId) => {
        const data = await this.getProjectData(projectId);
        const projectName = data?.project?.name ?? inferProjectName(projectId);

        if (projectName) {
          projectNames.set(projectId, projectName);
        }
      }),
    );

    return tasks.map((task) => ({
      ...task,
      projectName: task.projectId ? projectNames.get(task.projectId) ?? inferProjectName(task.projectId) : undefined,
    }));
  }

  listProjects() {
    return this.requestRaw<Project[]>("GET", "/open/v1/project");
  }

  getProject(projectId: string) {
    return this.requestRaw<Project>("GET", `/open/v1/project/${projectId}`);
  }

  getProjectData(projectId: string) {
    return this.requestRaw<ProjectData>("GET", `/open/v1/project/${projectId}/data`);
  }

  createProject(payload: Partial<Project>) {
    return this.requestRaw<Project>("POST", "/open/v1/project", payload);
  }

  updateProject(projectId: string, payload: Partial<Project>) {
    return this.requestRaw<Project>("POST", `/open/v1/project/${projectId}`, payload);
  }

  deleteProject(projectId: string) {
    return this.requestRaw<void>("DELETE", `/open/v1/project/${projectId}`);
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isOpenTask(task: Task): boolean {
  return !task.completedTime && task.status !== 2;
}

function inferProjectName(projectId?: string): string | undefined {
  if (!projectId) {
    return undefined;
  }

  if (projectId.startsWith("inbox")) {
    return "Inbox";
  }

  return undefined;
}
