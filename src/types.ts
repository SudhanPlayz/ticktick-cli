export type TickTickService = "ticktick" | "dida365";

export interface ChecklistItem {
  id?: string;
  title?: string;
  status?: number;
  completedTime?: string;
  isAllDay?: boolean;
  sortOrder?: number;
  startDate?: string;
  timeZone?: string;
}

export interface Task {
  id?: string;
  projectId?: string;
  title?: string;
  isAllDay?: boolean;
  completedTime?: string;
  content?: string;
  desc?: string;
  dueDate?: string;
  items?: ChecklistItem[];
  priority?: number;
  reminders?: string[];
  repeatFlag?: string;
  sortOrder?: number;
  startDate?: string;
  status?: number;
  timeZone?: string;
  kind?: "TEXT" | "NOTE" | "CHECKLIST" | string;
  etag?: string;
}

export interface TaskWithProject extends Task {
  projectName?: string;
}

export interface Project {
  id?: string;
  name?: string;
  color?: string;
  sortOrder?: number;
  closed?: boolean;
  groupId?: string;
  viewMode?: "list" | "kanban" | "timeline" | string;
  permission?: "read" | "write" | "comment" | string;
  kind?: "TASK" | "NOTE" | string;
}

export interface Column {
  id?: string;
  projectId?: string;
  name?: string;
  sortOrder?: number;
}

export interface ProjectData {
  project?: Project;
  tasks?: Task[];
  columns?: Column[];
}

export interface MoveTaskOperation {
  fromProjectId: string;
  toProjectId: string;
  taskId: string;
}

export interface MoveTaskResult {
  id: string;
  etag: string;
}

export interface CompletedTasksFilter {
  projectIds?: string[];
  startDate?: string;
  endDate?: string;
}

export interface FilterTasksRequest {
  projectIds?: string[];
  startDate?: string;
  endDate?: string;
  priority?: number[];
  tag?: string[];
  status?: number[];
}

export interface StoredConfig {
  service?: TickTickService;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string;
  accessToken?: string;
  apiBaseUrl?: string;
  authBaseUrl?: string;
}

export interface RuntimeConfig extends StoredConfig {
  service: TickTickService;
  configFile: string;
  scopes: string;
  apiBaseUrl: string;
  authBaseUrl: string;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  [key: string]: unknown;
}
