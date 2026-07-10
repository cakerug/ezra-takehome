/**
 * All endpoints live in this single file because this project only has ~10; if it grows,
 * split by resource (`projects.ts`, `tasks.ts`) and keep `request()`/`ApiError` here.
 */

import { z } from 'zod';
import type {
  CreateProjectRequest,
  CreateTaskRequest,
  MoveTaskRequest,
  ProjectResponse,
  ReorderTasksRequest,
  TaskResponse,
  UpdateProjectRequest,
  UpdateTaskRequest,
} from './generated-schemas';
import { schemas } from './generated-schemas';

const ProjectResponseSchema = schemas.ProjectResponse;
const TaskResponseSchema = schemas.TaskResponse;
const ProjectListResponseSchema = z.array(ProjectResponseSchema);
const TaskListResponseSchema = z.array(TaskResponseSchema);

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:5265';

/**
 * RFC 7807 ProblemDetails, see ExceptionHandlingMiddleware.cs.
 *
 * Hand-written, not generated: error bodies are written directly to the response stream by
 * ExceptionHandlingMiddleware after an exception is thrown, not returned from an endpoint's
 * declared return type. Swashbuckle builds the OpenAPI spec by inspecting endpoint return
 * types/ProducesResponseType attributes, so it never sees this path and omits ProblemDetails
 * from generated-schemas.ts entirely. Fixable by adding `.Produces<ProblemDetails>(status)` to
 * every endpoint chain for every status code it can throw, but that's per-endpoint boilerplate
 * for one shared shape -- not worth it here.
 */
interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  /** Present on 400 validation errors (ValidationProblemDetails); maps field name -> messages. */
  errors?: { [field: string]: string[] };
}

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

/**
 * Thrown when the server responded successfully (2xx) but the JSON body didn't match the Zod
 * schema we generated from the backend's OpenAPI spec -- i.e. a client-side validation failure,
 * not a server error. Distinct from `ApiError` so callers (and anyone reading the surfaced
 * message) can tell "the API rejected our request" apart from "we rejected the API's response."
 * Keeps the underlying `ZodError` on `.zodError` for full detail.
 */
export class ResponseValidationError extends Error {
  readonly path: string;
  readonly zodError: z.ZodError;

  constructor(path: string, zodError: z.ZodError) {
    super(`Response from ${path} failed client-side validation (Zod): ${zodError.message}`);
    this.name = 'ResponseValidationError';
    this.path = path;
    this.zodError = zodError;
  }
}

/**
 * Shared error-message extraction for ApiErrors.
 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.problem?.errors) {
      return Object.values(error.problem.errors).flat().join(' ');
    }
    return error.message;
  }
  return fallback;
}

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
    console.error(`Response validation failed for ${path}`, result.error, json);
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

// ---- Tasks ----

export function listTasks(projectId: number): Promise<TaskResponse[]> {
  return request(`/api/projects/${projectId}/tasks`, TaskListResponseSchema);
}

export function createTask(
  projectId: number,
  data: CreateTaskRequest,
): Promise<TaskResponse> {
  return request(`/api/projects/${projectId}/tasks`, TaskResponseSchema, {
    method: 'POST',
    ...toJsonBody(data),
  });
}

export function reorderTasks(
  projectId: number,
  data: ReorderTasksRequest,
): Promise<TaskResponse[]> {
  return request(`/api/projects/${projectId}/tasks/reorder`, TaskListResponseSchema, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

export function updateTask(id: number, data: UpdateTaskRequest): Promise<TaskResponse> {
  return request(`/api/tasks/${id}`, TaskResponseSchema, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}

export function deleteTask(id: number): Promise<void> {
  return request(`/api/tasks/${id}`, undefined, { method: 'DELETE' });
}

export function completeTask(id: number): Promise<TaskResponse> {
  return request(`/api/tasks/${id}/complete`, TaskResponseSchema, { method: 'PUT' });
}

export function uncompleteTask(id: number): Promise<TaskResponse> {
  return request(`/api/tasks/${id}/uncomplete`, TaskResponseSchema, { method: 'PUT' });
}

export function moveTask(id: number, data: MoveTaskRequest): Promise<TaskResponse> {
  return request(`/api/tasks/${id}/move`, TaskResponseSchema, {
    method: 'PUT',
    ...toJsonBody(data),
  });
}
