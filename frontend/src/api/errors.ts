/**
 * The API error model and how to interpret it for the UI. Kept separate from `client.ts` (which
 * makes the requests) so the network plumbing isn't mixed with error types and user-facing copy.
 * `client.ts`'s `request()` throws these; components turn them into inline field errors
 * (`extractFieldErrors`) or a generic toast message (`toToastMessage`).
 */
import { z } from 'zod';

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
export interface ProblemDetails {
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
 * one, so callers -- e.g. React Query mutations -- can inspect `status` and `problem.errors` to
 * render field-level feedback.
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
 * Field-validation messages from a 400 `ApiError` (per-field messages, joined), or `null` if the
 * error isn't a field-validation failure. Forms render this inline next to the fields it
 * describes; every other failure is surfaced generically via `toToastMessage`.
 */
export function extractFieldErrors(error: unknown): string | null {
  if (error instanceof ApiError && error.problem?.errors) {
    return Object.values(error.problem.errors).flat().join(' ');
  }
  return null;
}

/**
 * Message for the shared error `Toast`, used for failures that don't belong next to a specific
 * form field (formless actions, and non-validation form failures). Deliberately generic: the
 * server's raw `detail`/`title` is logged, not shown, so users aren't handed status codes or
 * stack-trace-flavored text they can't act on.
 *
 * The one exception worth distinguishing is connectivity: a `fetch` that never reached the server
 * rejects with a `TypeError` (offline, server down, DNS/CORS), which is on the user's end and
 * fixed by retrying -- so it gets an actionable "check your connection" message instead. HTTP
 * errors (`ApiError`) and bad response shapes (`ResponseValidationError`) are genuine failures the
 * user can't do anything about, so they stay generic.
 */
export function toToastMessage(error: unknown): string {
  if (error instanceof TypeError) {
    return 'Unable to reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}
