/**
 * All endpoints live in this single file because this project only has ~10; if it grows,
 * split by resource (`projects.ts`, `tasks.ts`) and keep `request()` here. The error model and
 * its UI interpreters (`ApiError`, `toToastMessage`, ...) live in `errors.ts`.
 */

import { z } from 'zod';
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  PatchTaskRequest,
  ProjectResponse,
  ReorderProjectsRequest,
  ReorderTasksRequest,
  TaskResponse,
  UpdateProjectRequest,
} from './generated-schemas';
import { schemas } from './generated-schemas';
import { ApiError, ResponseValidationError, type ProblemDetails } from './errors';

const ProjectResponseSchema = schemas.ProjectResponse;
const TaskResponseSchema = schemas.TaskResponse;
const ProjectListResponseSchema = z.array(ProjectResponseSchema);
const TaskListResponseSchema = z.array(TaskResponseSchema);

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:5265';

async function request<T>(
  path: string,
  schema: z.ZodType<T> | undefined,
  init?: RequestInit,
): Promise<T> {
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

  const json: unknown = await response.json();
  if (!schema) {
    return json as T;
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    // Log the full ZodError and the raw body for debugging: the network tab shows the response
    // JSON but not which fields Zod rejected, and the thrown message is only a trimmed summary.
    // Dev-only: import.meta.env.DEV is statically replaced by Vite, so this branch (and the
    // console.error call) is dead-code-eliminated from production builds entirely.
    if (import.meta.env.DEV) {
      console.error(`Response validation failed for ${path}`, result.error, json);
    }
    throw new ResponseValidationError(path, result.error);
  }
  return result.data;
}

function toJsonBody(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

// ---- Projects ----

export function listProjects(): Promise<ProjectResponse[]> {
  return request('/api/projects', ProjectListResponseSchema);
}

export function createProject(data: CreateProjectRequest): Promise<ProjectResponse> {
  return request('/api/projects', ProjectResponseSchema, {
    method: 'POST',
    ...toJsonBody(data),
  });
}

export function updateProject(
  id: number,
  data: UpdateProjectRequest,
): Promise<ProjectResponse> {
  return request(`/api/projects/${id}`, ProjectResponseSchema, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

export function deleteProject(id: number): Promise<void> {
  return request(`/api/projects/${id}`, undefined, { method: 'DELETE' });
}

export function reorderProjects(data: ReorderProjectsRequest): Promise<ProjectResponse[]> {
  return request('/api/projects/reorder', ProjectListResponseSchema, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

// ---- Tasks ----

export function listTasks(projectId: number): Promise<TaskResponse[]> {
  return request(`/api/tasks?projectId=${projectId}`, TaskListResponseSchema);
}

export function createTask(data: CreateTaskRequest): Promise<TaskResponse> {
  return request('/api/tasks', TaskResponseSchema, {
    method: 'POST',
    ...toJsonBody(data),
  });
}

export function reorderTasks(data: ReorderTasksRequest): Promise<TaskResponse[]> {
  return request('/api/tasks/order', TaskListResponseSchema, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

// Backs field edits, complete/uncomplete, and move -- all four collapse into one partial-update
// request now that task routes are flat; see docs/ezra-evaluation-criteria-tradeoffs.md.
export function patchTask(id: number, data: PatchTaskRequest): Promise<TaskResponse> {
  return request(`/api/tasks/${id}`, TaskResponseSchema, {
    method: 'PATCH',
    ...toJsonBody(data),
  });
}

export function deleteTask(id: number): Promise<void> {
  return request(`/api/tasks/${id}`, undefined, { method: 'DELETE' });
}
