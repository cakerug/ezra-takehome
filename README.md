# Todo Task Management App

This is a take-home project for an interview.

## Product Scope

At a base level, a Todo app must be able to:
- Create, read, update, delete tasks
  - Creating multiple tasks should be easy
- Check off tasks

After that, I chose two organizational features that I think are the minimum needed to make a todo app useful:
- **Projects**: You need to be able to group tasks. This allows different contexts of tasks to exist in one application (e.g., a grocery list vs a chore list vs a work list).
  - Create projects that contain tasks
  - Move tasks between projects
  - Delete projects and tasks (tasks are deleted with the project)
- **Reordering Tasks**: You need to be able reorder tasks in order to sequence them according to whatever criteria makes sense to you (priority or the chronological order you want to do them in).

Then I added a few more features for fun:
- Add a description to a task
- Hiding the projects sidebar to focus on a specific list
- Reorder projects


## Backend Scope

The backend features I decided to include were driven by three things:
1. production-readiness (security, maintainability, debuggability)
2. how easy it was to implement (if it was a few lines and isolated to one file, I'd generally add it)
3. demonstrating concepts for an interview

The backend features I added:
- Interactive API docs (Swagger UI) are available at `http://localhost:5265/swagger` once the
  server is running.
- A liveness endpoint is exposed at `http://localhost:5265/health` (returns `200 Healthy`) for
  uptime checks.
- Rate limiter

Missing features for a production-ready app:
- **authentication**: I felt it was out of scope for this take-home exercise. I would most likely not reinvent the wheel and use something off-the-shelf like Auth0.
- Error tracking/observability (e.g., Sentry)
- Product analytics (e.g., Google Analytics, Pendo, Amplitude)


## Setup

### Prerequisites

- .NET SDK 10.0 (the backend targets `net10.0`)
- Node.js

### Backend

```bash
cd backend/TodoApi
dotnet run
```

- Serves on `http://localhost:5265` by default (see `Properties/launchSettings.json`).
- On first run, EF Core migrations apply automatically and the database is seeded with a couple of example projects and tasks.
- The SQLite database file is created alongside the project (`todo.db`); data persists across
  restarts.

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
    - Can make this a shared .env variable through scripts, but fine for this application

Run the frontend test suite (Vitest + React Testing Library component tests) from `frontend/`:

```bash
cd frontend
npm test
```

Other useful scripts: `npm run build` (type-check + production build), `npm run lint`

## AI Usage
I had an LLM generate a plan, I reviewed the plan, an LLM executed on the plan, an LLM reviewed the code and then I reviewed the code, in particular the parts I thought were important architecturally and made changes as I saw fit. Notably at the planning stage and code review stages, I had agents with different focuses (e.g., security, user experience) evaluate the plans from different perspectives.

Some core changes I made to what the LLM built:
- changed the API - it had more "RPC"-style but I prefer resource-based APIs as much as is reasonable. Easier to understand b/c it's more standardized (RESTful). The original had tasks nested under projects but even though that's the current data architecture, I could easily see tasks living inside other containers like filtered lists or search results.
- I changed how it handled backend-frontend communicate to have the shapes generated for the frontend, making the backend the source of truth here. The LLM had already enabled Swagger (it is only a few lines), so this wasn't that much more work.
- They used render-props for project selection when simple lifted state management was sufficient
- It originally used MVC controllers with services but I simplified it to use the Minimal API because it removed a lot of unnecessary layers of indirection.

## Architecture

- **Backend:** ASP.NET Core Minimal API (no MVC controllers) + EF Core over SQLite. Business
  logic lives in plain static "operations" functions per entity (`ProjectOperations`,
  `TaskOperations`) rather than a repository/service layer. Cross-cutting concerns — a global
  exception-handling middleware mapping errors to `ProblemDetails`, and field validation helpers — sit in front of the endpoints.
- **Frontend:** React + TypeScript + Vite. `@tanstack/react-query` owns server state (fetching,
  caching, mutation lifecycle) instead of hand-rolled fetch/useState. `@dnd-kit/core` drives
  drag-and-drop reordering within a project. A small typed `fetch` wrapper (`api/client.ts`)
  centralizes the base URL and JSON handling and normalizes error responses into an `ApiError`
  carrying the parsed `ProblemDetails` body.
- **Communication:** REST/JSON.

```
UI (React) --REST/JSON--> API (ASP.NET Core Minimal API) --EF Core--> SQLite file
```

## Trade-offs / key decisions made

The decisions I made were based on: (1) not trying to over-engineer something -- focusing on what would be necessary for a solo developer product; (2) any explicit criteria called out in the instructions; (3) something that I would actually use; (4) making it production-ready (within reason).

- **Frontend-Backend Communication**:
    - **Typesafety**: Although kind of unnecessary for an app this scale (developer of 1), because it was explicitly mentioned that one of the evaluation criteria was in this area and because the OpenAPI endpoint was easy to generate, I implemented zod for compile time and runtime type checking. I did not add CI/CD for ensuring the generated types were validated.
    - **Query Framework**: I used react-query because our product/data schema is simple and it gives free caching, retry, request deduping, etc. Instead of configuring it with a longer staleTime or any optimistic writes, I erred towards more refetching because it's cheap, esp with react-query's caching and refetch in background and request deduping. The caching also makes it easy to avoid prop-drilling without paying for an extra fetch. React-query also gives retry, loading/error states for free.
- **Mutations are mostly pessimistic, not optimistic-with-rollback.** The UI doesn't reflect a create, edit, delete, or moving between projects, instead it invalidates the relevant cache with react-query and re-fetches. Simpler to implement correctly than optimistic updates with rollback, at the cost of a small perceived-latency hit. The only exception is reordering which looked jumpy if we did that.
- **API Versioning**: Did not version the API. In practice, for small-scale apps this adds additional work and is unnecessary. You can deploy during low-traffic time to avoid any mismatches.
- **State management**: Didn't use redux/zustand or even contexts -- unnecessary for this small app. Didn't have that much state to manage.
- **Style system**: Decided on a BEM (Block-Element-Modifier) style system because it's simple and works for a single developer. Likely the next step at scale is to evolve this to CSS Modules to avoid possible class name conflicts. That would have been easy enough to do since [Vite enables this](https://vite.dev/guide/features#css-modules).
 

## Future Work

### Additional Product Features
- Authentication
- Task search
- Task labels
- Subtasks
- Project / task urls - i.e., routing

There are many directions to take a todo app after the above (e.g., an inbox, scheduling, due dates, recurring tasks, etc) but, in my opinion, the above are the next layer of features that any todo app should have.

### User experience polish
- Responsive layout
- Drag and drop between projects
- Better menu for moving projects (scroll)
- Better task detail view (make ... menu items easier to edit there)
- Toasts replace each other instead of stacking
- Turn the seed data into tutorial tasks.

### At Scale
- Move off of SQLite, something relational would work well - e.g., postgres
- Move to an API Gateway with a rate limiter, load balancer, etc. Remove the in-memory rate-limiter we have right now.
- Infinite scroll (frontend virtualization) / pagination
- Reordering tasks takes the entire list of tasks right now. This was a reasonable trade-off for simplicity but would need to change that for large task lists.
- CI/CD for generated types, running tests
- I don't log client-side errors to anything. Would add Sentry at scale (also for the backend, but there are at least server-side logs for that right now)
- Product analytics (e.g., Pendo, Amplitude)
- Switch ids from ints to uuids to make sharding easier (no id conflicts) 
- More standardized validation layer (e.g., FluentValidation, ZodSharp)
- e2e tests
