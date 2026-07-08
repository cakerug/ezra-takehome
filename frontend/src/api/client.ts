/**
 * "Client" = the HTTP client for this API (fetch wrapper + one function per endpoint), a common
 * naming convention (cf. `apiClient.ts`, generated SDKs). All endpoints live in this single file
 * because this project only has ~10; if it grows, split by resource (`projects.ts`, `tasks.ts`)
 * and keep `request()`/`ApiError` here.
 */

import type {
  CreateProjectRequest,
  CreateTaskRequest,
  MoveTaskRequest,
  ProblemDetails,
  ProjectResponse,
  ReorderTasksRequest,
  TaskResponse,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from './types';

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:5265';

/**
 * Error thrown by `request()` for any non-2xx response. Wraps the parsed `ProblemDetails` body
 * (including the per-field `errors` map on 400 validation failures) when the server returned
 * one, so callers -- e.g. React Query mutations in later units -- can inspect `status` and
 * `problem.errors` to render field-level feedback.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null) {
    super(problem?.detail ?? problem?.title ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let problem: ProblemDetails | null = null;
    try {
      problem = (await response.json()) as ProblemDetails;
    } catch {
      // Body wasn't JSON (or was empty) -- leave problem as null, ApiError falls back to status.
    }
    throw new ApiError(response.status, problem);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function toJsonBody(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

// ---- Projects ----

export function listProjects(): Promise<ProjectResponse[]> {
  return request<ProjectResponse[]>('/api/projects');
}

export function createProject(data: CreateProjectRequest): Promise<ProjectResponse> {
  return request<ProjectResponse>('/api/projects', {
    method: 'POST',
    ...toJsonBody(data),
  });
}

export function updateProject(
  id: number,
  data: UpdateProjectRequest,
): Promise<ProjectResponse> {
  return request<ProjectResponse>(`/api/projects/${id}`, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

export function deleteProject(id: number): Promise<void> {
  return request<void>(`/api/projects/${id}`, { method: 'DELETE' });
}

// ---- Tasks ----

export function listTasks(projectId: number): Promise<TaskResponse[]> {
  return request<TaskResponse[]>(`/api/projects/${projectId}/tasks`);
}

export function createTask(
  projectId: number,
  data: CreateTaskRequest,
): Promise<TaskResponse> {
  return request<TaskResponse>(`/api/projects/${projectId}/tasks`, {
    method: 'POST',
    ...toJsonBody(data),
  });
}

export function reorderTasks(
  projectId: number,
  data: ReorderTasksRequest,
): Promise<TaskResponse[]> {
  return request<TaskResponse[]>(`/api/projects/${projectId}/tasks/reorder`, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

export function updateTask(id: number, data: UpdateTaskRequest): Promise<TaskResponse> {
  return request<TaskResponse>(`/api/tasks/${id}`, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

export function deleteTask(id: number): Promise<void> {
  return request<void>(`/api/tasks/${id}`, { method: 'DELETE' });
}

export function completeTask(id: number): Promise<TaskResponse> {
  return request<TaskResponse>(`/api/tasks/${id}/complete`, { method: 'PUT' });
}

export function uncompleteTask(id: number): Promise<TaskResponse> {
  return request<TaskResponse>(`/api/tasks/${id}/uncomplete`, { method: 'PUT' });
}

export function moveTask(id: number, data: MoveTaskRequest): Promise<TaskResponse> {
  return request<TaskResponse>(`/api/tasks/${id}/move`, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}
