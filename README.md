# Todo Task Management App

A single-user, no-login to-do app: tasks (title, description) live inside projects (name,
description), including a seeded, undeletable default "Inbox" project for anything not explicitly
organized. Tasks can be manually reordered within a project and moved between any projects,
Inbox included. Checking a task off completes it rather than deleting it; deleting a non-default
project cascades to delete its tasks, gated by a confirmation dialog.

Built for Ezra's Full Stack Developer take-home. The full implementation plan (Product Contract,
Planning Contract, and per-unit implementation detail) lives at
`docs/plans/2026-07-02-001-feat-todo-task-management-plan.md`; this README summarizes the parts
of that document a reviewer needs without requiring the whole plan to be read first.

## Setup

### Prerequisites

- .NET SDK 10.0 (the backend targets `net10.0`)
- Node.js (a recent LTS; developed against Node via `fnm`) and npm

### Backend

```bash
cd backend/TodoApi
dotnet run
```

- Serves on `http://localhost:5265` by default (see `Properties/launchSettings.json`).
- On first run, EF Core migrations apply automatically and the database is seeded with the
  default "Inbox" project plus a couple of example projects and tasks, so the app is populated
  immediately rather than starting blank.
- The SQLite database file is created alongside the project (`todo.db`); data persists across
  restarts.
- Interactive API docs (Swagger UI) are available at `http://localhost:5265/swagger` once the
  server is running.
- A liveness endpoint is exposed at `http://localhost:5265/health` (returns `200 Healthy`) for
  uptime checks.
- Each request is tagged with a correlation ID (read from the `X-Correlation-Id` request header or
  generated), echoed back in the response header of the same name and included in every log line
  emitted while handling the request, so a request can be traced end-to-end in the console output.

Run the backend test suite (xUnit unit + integration tests, including cascade-delete against a
real SQLite connection) from `backend/`:

```bash
cd backend
dotnet test
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

- Serves on `http://localhost:5173` by default (Vite's default port).
- The API base URL is controlled by the `VITE_API_BASE_URL` env var, defaulting to
  `http://localhost:5265` to match the backend's default port. To override it, copy
  `frontend/.env.example` to `frontend/.env` and edit the value (the `.env` file itself is
  gitignored).
- The backend's CORS policy explicitly allows `http://localhost:5173` as the frontend origin; if
  you change the frontend's dev port, update the CORS policy in `backend/TodoApi/Program.cs` too.

Run the frontend test suite (Vitest + React Testing Library component tests) from `frontend/`:

```bash
cd frontend
npm test
```

Other useful scripts: `npm run build` (type-check + production build), `npm run lint` (oxlint).

## Architecture

- **Backend:** ASP.NET Core Minimal API (no MVC controllers) + EF Core over SQLite. Business
  logic lives in plain static "operations" functions per entity (`ProjectOperations`,
  `TaskOperations`) rather than a repository/service layer. Cross-cutting concerns — a global
  exception-handling middleware mapping errors to `ProblemDetails`, a correlation-ID middleware
  for structured logging, and field validation helpers — sit in front of the endpoints.
- **Frontend:** React + TypeScript + Vite. `@tanstack/react-query` owns server state (fetching,
  caching, mutation lifecycle) instead of hand-rolled fetch/useState. `@dnd-kit/core` drives
  drag-and-drop reordering within a project. A small typed `fetch` wrapper (`api/client.ts`)
  centralizes the base URL and JSON handling and normalizes error responses into an `ApiError`
  carrying the parsed `ProblemDetails` body.
- **Communication:** REST/JSON over CORS, no auth headers or cookies (see "Trade-offs" below).

```
UI (React) --REST/JSON--> API (ASP.NET Core Minimal API) --EF Core--> SQLite file
```

## Trade-offs and assumptions

These are deliberate scope decisions, not oversights — each traded some capability for a simpler,
more defensible MVP within the take-home's scope.

- **Single user, no authentication.** No login, no multi-tenancy. Called out explicitly rather
  than left implicit, since it's the biggest thing separating this from a deployable product.
- **Manual order instead of a priority field.** Reordering tasks within a project already lets the
  user express "do this before that" — a standalone priority field would just be a second,
  possibly-conflicting way to express the same intent, so it was cut.
- **Inbox is a real, seeded, undeletable project, not a null-project sentinel.** Every task always
  has a real `ProjectId`. This keeps move/reorder/delete logic uniform — moving a task to Inbox is
  exactly the same code path as moving it anywhere else — at the cost of one guard clause
  preventing the Inbox row itself from being deleted.
- **Project deletion cascades to its tasks, gated by a confirmation dialog.** Simpler data model
  than reassigning orphaned tasks to Inbox on delete, offset by requiring explicit user
  confirmation before anything destructive happens.
- **SQLite foreign-key enforcement had to be explicitly turned on** (`Foreign Keys=True` in the
  connection string). Unlike Postgres, SQLite disables FK enforcement by default per connection,
  and the cascade-delete-at-the-database-level path (as opposed to EF Core cascading only
  already-tracked in-memory entities) silently no-ops without it — with no error raised. This is
  the most load-bearing and least obvious technical decision in the project, and it's covered by
  a dedicated integration test against a real SQLite connection (not EF Core's InMemory provider,
  which doesn't model FK/cascade behavior at all).
- **No repository or injected-service layer over EF Core.** Plain static functions taking
  `AppDbContext` directly give the reuse-across-endpoints and test-without-HTTP benefits a service
  layer would provide, without the class/interface/DI ceremony that would add indirection with no
  behavioral payoff at this scale.
- **Move-to-project is a dropdown, not cross-project drag-and-drop.** The API contract
  (`PUT /api/tasks/{id}/move`) is the same either way, so this is a frontend-only simplification —
  upgrading to drag-and-drop later wouldn't touch the backend.
- **Mutations are pessimistic, not optimistic-with-rollback.** The UI doesn't reflect a create,
  edit, delete, move, or reorder until the server confirms it; failures surface via inline
  field errors (validation) or a toast (everything else) without ever showing a stale/incorrect
  state. Simpler to implement correctly than optimistic updates with rollback, at the cost of a
  small perceived-latency hit.
- **Errors distinguish validation failures from everything else.** A 400 naming a specific field
  (e.g., "Title must be at most 200 characters") renders inline next to that field on the
  create/edit forms. Anything else — network failure, 500, a stale-resource 404 — surfaces via a
  generic toast, since there's no single field to attach it to.
- **Reordering resends the full ordered task-ID list**, and the backend renumbers sequentially.
  Simpler than a single-item move-with-reindex endpoint or fractional-index bookkeeping, and
  perfectly fine at single-user scale.
- **Completed tasks stay inline** (struck through, sorted to the bottom of their project) rather
  than moving to a separate "completed" view — keeps the list a single source of truth per
  project.
- **Field limits:** task title and project name are required, max 200 characters; task
  description and project description are optional, max 2000 characters.
- This app is local/dev-oriented given the no-auth design and is **not intended for public
  internet exposure** — stated here explicitly rather than left as an assumption a reviewer has
  to infer.
- **No security headers or HTTPS redirection.** Appropriate for a localhost dev app, but before
  any public exposure I'd add HSTS, `X-Content-Type-Options: nosniff`, a request-size limit, and
  TLS termination — alongside the authentication and rate limiting noted below.

### Known limitations accepted for this MVP

Small things I deliberately left as-is rather than build out, noted here so they're decisions
rather than gaps:

- **The "move to project" control is a native `<select>`.** On some platforms, arrow-keying
  through a closed select fires the move on each keystroke. The robust fix is a custom menu button;
  it wasn't worth the extra component for this scope, and the API contract wouldn't change.
- **The Inbox project can be renamed** (only its *deletion* is blocked). Renaming is harmless — it
  stays the seeded default — so no guard was added.
- **`ConfirmDialog` implements Escape-to-close and focus-on-open, but not a full focus trap.** The
  two behaviors a user actually reaches for are covered; trapping Tab within the modal is the
  remaining a11y refinement.
- **Reordering is pessimistic and single-flight in spirit.** Starting a second drag before the
  first reorder's response lands could compute from stale order; harmless at single-user scale, and
  the backend rejects any task-set mismatch. Concurrent writes that do slip through (e.g. moving a
  task into a project being deleted) return a `409 Conflict` rather than an opaque 500.

## What I'd do differently at scale / future work

These are scope cuts made for this MVP, each with a clear next step if this were headed to
production:

- **Authentication and multi-user support.** The single biggest gap versus a real product. A next
  version would add login, per-user data isolation, and probably a switch to a server that
  supports concurrent multi-tenant access patterns (connection pooling, etc. — SQLite is fine for
  a single local user but not for concurrent multi-user writes at scale).
- **Due dates, scheduling, recurrence, and reminders.** Dropped entirely rather than deferred as a
  "nice to have," since they represent a materially different feature set (calendar/scheduling
  logic) than organization-and-completion. A next version would add a due-date field, a
  notification/reminder mechanism, and probably a distinct "upcoming" view.
- **Flat, non-nested projects and tasks.** No sub-projects or sub-tasks. A next version might add
  a parent/child relationship, but that's a real data-model and UI change (indentation, recursive
  queries), not a small addition.
- **No rate limiting or abuse protection.** Reasonable to skip for a local, single-user, no-auth
  app, but would be required before any public exposure, alongside auth.
- **No horizontal scaling / multi-instance concerns.** The single SQLite file assumes a
  single-instance deployment. A production version handling real concurrent load would move to a
  networked database (e.g., Postgres) and stateless API instances behind a load balancer.
- **Drag-and-drop is reorder-within-project only, not cross-project.** Moving between projects
  uses a dropdown, which was a deliberate simplification (see Trade-offs); cross-project drag-and-
  drop is a reasonable frontend-only enhancement later, since the backend `move` endpoint already
  supports it.

## How I verified it works

- **Automated tests:** `dotnet test` (backend unit + integration tests, including cascade-delete
  against a real SQLite connection, correlation-ID propagation into logs, and concurrent-update
  conflict mapping) and `npm test` (frontend component tests with Vitest + React Testing Library,
  mocking the API client) both pass with zero failures.
- **Manual walkthrough:** ran both servers locally and walked the golden path in the browser —
  create a project, add tasks, reorder them, move a task to another project, complete a task,
  delete a task, delete a project (with confirmation) — checking the browser console for
  unhandled errors at each step.
