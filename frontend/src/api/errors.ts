import { ApiError } from './client';

/**
 * Shared error-message extraction, mirroring the `ApiError` handling already inlined in
 * `NewProjectForm` / `ProjectSidebar`. Pulled into its own module (rather than exported from a
 * component file) so task components can share it without tripping the `only-export-components`
 * fast-refresh lint rule.
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
