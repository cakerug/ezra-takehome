/**
 * TypeScript mirrors of the backend DTOs in `backend/TodoApi/Dtos/ProjectDtos.cs` and
 * `backend/TodoApi/Dtos/TaskDtos.cs`. Field names and optionality match the C# types exactly.
 *
 * These are maintained by hand, so they can drift from the C# DTOs. A tool like Zod would only
 * dedupe types within TS; to actually share the source of truth across languages, the equivalent
 * here is generating one side from the other via OpenAPI: Swashbuckle (already common in
 * ASP.NET Core) emits an OpenAPI spec from the C# DTOs, and `openapi-typescript` turns that spec
 * into these TS types automatically, so they can't drift.
 */

// ---- Projects ----

export interface ProjectResponse {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name: string;
  description?: string;
}

// ---- Tasks ----

export interface TaskResponse {
  id: number;
  title: string;
  description: string | null;
  projectId: number;
  order: number;
  isComplete: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateTaskRequest {
  title: string;
  description?: string;
}

export interface UpdateTaskRequest {
  title: string;
  description?: string;
}

export interface MoveTaskRequest {
  targetProjectId: number;
}

export interface ReorderTasksRequest {
  orderedTaskIds: number[];
}

// ---- Errors (RFC 7807 ProblemDetails, see ExceptionHandlingMiddleware.cs) ----

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  /** Present on 400 validation errors (ValidationProblemDetails); maps field name -> messages. */
  errors?: { [field: string]: string[] };
}
