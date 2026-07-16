_Draft: proposed merged replacement for `MANUAL_README.md`, kept as a separate file for review. It folds the hand-written `MANUAL_README.md` content together with this doc's existing trade-off log and the architectural changes made since the last `MANUAL_README.md` edit. Nothing from the original of this file was removed — only added to and reordered._

# Ezra Take-Home — Decisions, Trade-offs & Evaluation Criteria Coverage

Ezra's brief ([docs/original_instructions.md](docs/original_instructions.md)) mixes technical evaluation criteria (backend framework, data store, frontend framework, FE/BE communication) with process and judgment criteria that aren't about the tech stack itself. This document tracks both: the concrete architectural decisions/trade-offs made while building, and where the [Todo Task Management App plan](docs/plans/2026-07-02-001-feat-todo-task-management-plan.md) already satisfies the non-technical criteria through decisions made during brainstorming — so they aren't re-litigated or lost by submission time.

## AI Flow

I had AI (fable) generate a plan, reviewed the plan, executed on the plan, reviewed their own code, and then I stepped through the main parts I thought were important (under Decisions made). Notably at the planning stage and code review stages, I used Every's compound engineering plugin's plan skill which applies agents that have different focuses (e.g., security, user experience, etc.) to evaluate the code thoroughly. You can see the plan it generated in `docs/plans`.

## Decisions made

Almost everything here is what I would do as this scales. There are a few dimensions to evaluate scale at: users, product surface area, developer team. Though they tend to move together, I like to think of them separately.

The decisions I made here are things I examined more closely in the output and things I prompted the AI to change. I also tried to document decisions in-line in code but have aggregated hopefully all of them here. I also indicated where I differed from the AI / prompted it to change their solution.

The decisions I made were based on:
- not trying to over-engineer something — focusing on what would be necessary for a solo developer product
- any explicit criteria called out in the instructions
- something that I would actually use
- making it production-ready (as a local app of course since I didn't add auth)
- Honestly, I was somewhat playing with the power of Fable also so some things I probably wouldn't have spent as much time on.

### Product decisions

- I drew inspiration from Todoist and Google Tasks.
- **Removed the "Inbox" / default-project concept in favor of user-orderable projects.** The app originally seeded a special mandatory "Inbox" project (`IsDefault = true`) that couldn't be deleted and that the frontend fell back to. I replaced that whole special case with a plain `Order` integer on `Project`: every project is an ordinary, deletable, drag-reorderable row, and the frontend simply falls back to the first project when there's no valid selection.
    - **Why:** a single-user local todo app doesn't need a privileged catch-all bucket, and maintaining a can't-be-deleted invariant (plus the "which project is default" fallback logic) was complexity that bought nothing. This is the "don't over-engineer a simple prompt" pitfall — removing an entity rather than maintaining one. See the `ReplaceIsDefaultWithProjectOrder` migration.
- **Dropped the project `Description` field entirely.** Projects are now just a name + order. The AI had modeled projects with an optional description (max 2000 chars) mirroring tasks; in practice a project is a lightweight bucket and the description field was never surfaced meaningfully in the UI. Removing it simplified the create/edit forms, the DTOs, and the validation. See the `DropProjectDescription` migration.

### Backend

#### API Versioning

Did not version the API. In practice, for small-scale apps this adds additional work and is unnecessary. You can deploy during low-traffic time to avoid any mismatches.

#### Project reordering: full-set-replace endpoint (`PUT /api/projects/reorder`)

Reordering projects sends the **entire** ordered list of project ids to the server, which validates and rewrites each project's `Order` to its array index. The same shape is used for task reordering.

**Why full-replace rather than a positional/delta PATCH ("move project X to index 3"):**
- It's idempotent and has no partial-state drift — the client sends the complete desired order and the server adopts exactly that, rather than the two sides trying to keep incremental position deltas in sync.
- The server validates hard: the submitted ids must contain no duplicates **and** must be exactly the set of projects that currently exist (`SetEquals`). A stale or malformed client list is rejected with a `ValidationException` instead of silently corrupting ordering.

**Trade-off:** the payload grows with the number of projects. For a single-user app with a handful of projects that's a non-issue; at much larger scale a paged/delta reordering scheme would be worth it.

#### Completed tasks are locked from field edits — enforced at the API, not just the UI

A completed task rejects field edits (`Title`/`Description`) at the operation layer with a `ForbiddenOperationException`; the client must reopen (uncomplete) it first. The complete/uncomplete toggle, move-to-project, and delete all stay allowed — only field edits are blocked.

**Why:** this is a genuine domain invariant, so it's enforced server-side and *mirrored* in the UI (locked detail dialog) rather than living only as a disabled button. Defense-in-depth: the rule holds even if a request bypasses the frontend.

#### CORS origin is environment-configurable, with a permissive-but-safe dev mode

The allowed frontend origin is read from configuration (`FrontendOrigins` env var, comma-separated) instead of being hard-coded, defaulting to Vite's dev port. In **development** the policy additionally allows *any* loopback origin (`localhost`/`127.0.0.1` on any port), because dev tooling assigns a free port that differs per run (Vite `autoPort`). **Production** stays locked to the configured allow-list.

**Why it's safe:** no credentials/cookies are involved (no auth yet), so a loopback-wildcard in dev doesn't expose anything, while production keeps a strict allow-list. This trades a small amount of dev-only permissiveness for not having to reconfigure CORS every time the dev port shifts.

#### Trade-off: autoincrement integer ids vs. UUIDs for `Project`/`Task`

Considered during a post-implementation review of `App.tsx`'s selected-project recovery logic and kept as-is: `Project.Id`/`TaskItem.Id` stay as SQLite `INTEGER PRIMARY KEY` (EF Core default autoincrement), not `Guid`.

**Why this came up:** SQLite's default integer autoincrement (no explicit `AUTOINCREMENT` keyword in the migration) can reuse a deleted row's id for a later-inserted row. If a user deletes a project and a new project happens to land on that same id while the frontend still holds the old id in `selectedProjectId` state from before the delete, the recovery logic could in principle treat the new project as a still-valid old selection. The current frontend code avoids this in practice by overwriting the stored selection (not just deriving a displayed one) as soon as it detects the selection is invalid — see `App.tsx`'s render-phase state-adjustment block.

**Why ints were kept anyway:**
- The failure mode requires a specific same-session interleaving (delete, then create, before the original client re-syncs) that's a stretch for a single-user local app, and is already fully closed by the existing recovery logic regardless of id type.
- This app is explicitly local/dev-only, single SQLite file, no auth (per the plan's Dependencies/Assumptions) — the scenarios where UUIDs earn their cost don't apply:
  - No independent/offline id generation across multiple systems needing to merge without a shared counter.
  - No public/multi-tenant exposure where sequential, guessable ids would leak information or enable enumeration/scraping.
  - No client-side pre-insert id assignment needed (e.g. optimistic UI that must reference an entity before the server confirms it).
- Autoincrement ints are smaller (4-8 bytes vs. 16), keep better index locality for inserts (sequential vs. UUIDv4's random scatter, which fragments SQLite's B-tree), and are far easier to reference in logs/debugging/support than Guids.

**Verdict:** keep autoincrement ints. Would revisit if the app's scope grew to include multi-instance sync, public exposure, or client-generated ids — none of which are in scope per the plan's Scope Boundaries.

#### Trade-off: soft deletes vs. hard deletes for `Project`/`Task`

Considered alongside the id discussion above and deferred: deletes stay hard deletes (real row removal, relying on SQLite FK cascade per U1), not soft deletes (an `IsDeleted` flag with rows retained).

**What soft deletes would buy:** undo support for accidental deletes, an audit/recovery trail, and — as a side effect — it would also close the id-reuse edge case above, since a "deleted" row's id is never actually freed for reuse.

**Why deferred:**
- No undo UI or endpoint exists or is planned; without one, soft-deleted rows would just be dead data with no user-facing benefit.
- Every read path (`listProjects`, `listTasks`) would need a `WHERE IsDeleted = false` filter added and consistently maintained — an easy place to introduce a bug that leaks "deleted" data back into the UI.
- The FK-cascade-delete behavior this app already relies on and tests against a real SQLite connection (U1) goes away — cascading a soft delete means manually walking `Project → Tasks` to mark both, rather than letting the database enforce it.
- Undo isn't in the brief or the plan's Scope Boundaries; adding it now would be speculative complexity for a single-user local MVP, the same over-architecting failure mode the plan explicitly avoids elsewhere.

**Verdict:** keep hard deletes. Would revisit if the product grew real users who need undo/recovery, at which point it's worth designing properly (including the read-path filtering and cascade rewrite) rather than bolting on now.

#### Tests moved with the behavior

The behavior changes above came with test changes rather than after them: `ProjectEndpointsTests` and `TaskEndpointsTests` were extended to cover reorder validation (duplicate ids, non-matching set) and the completed-task edit lock, and the seeder/data-model tests were updated for the `IsDefault`→`Order` and dropped-`Description` model changes. This is the "appropriate tests" criterion — the endpoint invariants that matter (reorder set-equality, completed-edit rejection) are asserted, not just the happy path.

#### Test structure: integration-first, real SQLite everywhere, no mocked DbContext

Six test files, ~1,484 lines, all in `TodoApi.Tests/`. Every test is integration-style — there is no unit-test tier that mocks `AppDbContext` or `Operations`:

- **Endpoint tests** (`ProjectEndpointsTests`, `TaskEndpointsTests`, `ApiDocumentationAndCorsTests`) spin up a real `WebApplicationFactory<Program>`, each with its own temp-file SQLite database (`RemoveAll<DbContextOptions<AppDbContext>>` + re-registered with a fresh connection string), and hit it over real HTTP. Requests flow through the actual middleware pipeline — CORS, `ExceptionHandlingMiddleware`, rate limiting — not a stubbed handler.
- **Model-level tests** (`DataModelTests`) skip HTTP and go straight at `AppDbContext` against a real SQLite temp file, specifically to assert `PRAGMA foreign_keys` is on and that project deletion actually cascades at the database level.
- **Middleware tests** (`ExceptionHandlingMiddlewareTests`) use a bespoke `WebApplicationFactory` with throwaway test-only endpoints (`/test/not-found`, `/test/boom`, etc.) mapped only inside the test — this exercises the exception→`ProblemDetails` mapping in isolation without depending on real business endpoints existing yet or coupling the test to their behavior.
- **`DbSeederTests`** covers the idempotency guard (seeding twice doesn't duplicate rows).

**Why real SQLite instead of EF Core's InMemory provider — stated directly in `DataModelTests`'s header comment:** InMemory doesn't model foreign keys or cascade behavior at all, so it would give a false-positive pass regardless of whether `Foreign Keys=True` is actually wired up. That pragma is called out as "the single most load-bearing, least obvious decision in this project" — SQLite has FK enforcement off by default per-connection, and EF's cascade-delete only reaches the database (rather than just cascading in-memory for entities already tracked) when a project's tasks aren't loaded into the deleting context. A provider swap to InMemory would silently stop testing the thing that actually matters here.

**Why this shape follows from the layering decision below:** `ProjectOperations`/`TaskOperations` are static methods that take a concrete `AppDbContext` — no interface to mock. Given that, a real (if temp-file, throwaway-per-test) SQLite connection is the cheapest way to get a trustworthy test, not a compromise. The cost is every test pays DB/HTTP-factory setup instead of a pure in-memory mock — acceptable at this suite's size (seconds, not minutes) but the same "no repository interface" trade-off flagged in the At-scale section below: once `Operations` need to be tested against complex business logic in isolation from persistence, this is what tips the scale toward introducing an interface.

**What's not covered:** no test asserts on log output (the `LogWarning` vs `LogError` severity split in `ExceptionHandlingMiddleware`, see below) — only response status/body. A minor gap, not a real risk at this scale.

#### Layering: thin Endpoints → static Operations → DbContext, no repository/service interfaces

Both `Endpoints/*.cs` files are declared as doing exactly one thing (per their own XML doc comments): parse the request, delegate to `Operations`, shape the response — "no business logic lives here." All of it — ordering (`NextOrderAsync`), the completed-task edit lock, reorder set-equality validation, response mapping (`ToResponse`) — sits in `ProjectOperations`/`TaskOperations`, plain `static` classes with no constructor, no injected interface, taking `AppDbContext` as an explicit parameter on every method (their doc comments say this directly: "no repository/unit-of-work abstraction and no injected service class").

**Why this shape:** it's the minimum indirection that still separates "HTTP concern" from "business rule." A repository layer over EF Core (which is already a unit-of-work/repository abstraction over the raw DB) would be an abstraction over an abstraction with no swappable implementation ever planned. Making `Operations` static rather than DI-injected services removes a whole category of "which lifetime do I register this with" decisions that don't matter when there's no interface to substitute.

**Trade-off:** without an interface, `Operations` can't be unit-tested with a mocked persistence layer — which is exactly why the test suite (above) is integration-style end to end. This is fine while `Operations` methods stay this size (10-40 lines, one responsibility each); it stops being fine once a method's business logic is complex enough that exercising it *only* through a full DB round-trip makes iterating on that logic slow. That's the concrete trigger named in At-scale below, not team size or LOC count in the abstract.

#### DTOs vs. domain models: separate wire shapes, hand-written mapping

`Dtos/ProjectDtos.cs`/`Dtos/TaskDtos.cs` define request/response types (`CreateProjectRequest`, `ProjectResponse`, etc.) that are distinct from the EF entities in `Models/` (`Project`, `TaskItem`), with a small private `ToResponse()` mapper at the bottom of each `Operations` class doing the field-by-field translation by hand (no AutoMapper/Mapster).

**Why a separate DTO layer instead of serializing the EF entities directly:**
- `ProjectResponse` deliberately excludes `Project.Tasks`, the navigation property — the DTO's own doc comment states this explicitly. Serializing `Project` directly would either need `[JsonIgnore]` bolted onto the domain model (coupling persistence shape to wire shape) or risk a circular `Project → Tasks → Project` reference during JSON serialization.
- Validation (`[Required]`, `[MaxLength(FieldLengths.ProjectName)]`) lives on the *request* DTOs, not the domain models — `CreateProjectRequest.Name` is validated, but `Project.Name` (the EF entity) has no attributes at all; its column width (`HasMaxLength(FieldLengths.ProjectName)`) is expressed separately via Fluent API in `AppDbContext.OnModelCreating`. This keeps "what shape is allowed over the wire" and "what the database column looks like" as two independently-stated facts rather than one attribute set serving both jobs.

**Trade-off:** the split means the same number is declared twice — once as a DataAnnotation on the DTO, once as Fluent API on the entity. Those two declarations are pinned to a shared `const` (`Models/FieldLengths.cs`) so they can't drift apart, but they remain two separate statements by design; see the next entry for why they can't collapse into one, and why the enforcement they provide is weaker than it looks.

#### Field-length constraints: declared twice, enforced once — and the constant that keeps them honest

The `[MaxLength]` on a request DTO and the `HasMaxLength` on the matching entity property look like the same rule stated twice. They aren't, and the difference is worth stating precisely because the naive reading ("it's enforced at the API, the DbContext, and the database") is wrong on two of the three counts. Verified empirically against this codebase rather than assumed:

| | API layer (DTO) | `AppDbContext` | SQLite |
|---|---|---|---|
| **Max length** | rejects with 400 | **no runtime effect** | **no runtime effect** |
| **Required** | rejects with 400 | no runtime effect | `NOT NULL` |

- **Max length is enforced at exactly one layer: the DTO.** A 5,000-character `Project.Name` saves straight through `SaveChanges()` with no error and stores at full length. Two independent reasons: EF Core never runs validation attributes at runtime (that was EF6 — `HasMaxLength` is *DDL metadata*, consumed only by the migration generator), and SQLite has no length enforcement at all. The generated DDL is literally `"Name" TEXT NOT NULL` — the 200 is gone. SQLite's dynamic type affinity means even an explicit `varchar(200)` would be ignored.
- **Required is enforced at the DTO and the database, but not by EF.** A null `Name` surfaces as `DbUpdateException` wrapping a `SqliteException` — that's EF forwarding SQLite's `NOT NULL` violation, not catching it itself. A third guard sits earlier still: C#'s `required string Name` makes it a compile-time error.

**Consequence worth knowing:** since the length limit lives only on the DTOs, anything writing outside an endpoint — `DbSeeder`, tests, any future background job — bypasses it entirely. Harmless today. It stops being harmless on a provider that honours column widths, where rows this app happily accepted on SQLite would start failing to insert.

**So why keep `HasMaxLength` at all:** portability insurance. It's inert on SQLite and becomes real DDL (`varchar(200)`) on Postgres or SQL Server. The genuine single-layer-enforcement fix on SQLite would be a `CHECK (length("Name") <= 200)` via `HasCheckConstraint` — deliberately not added, as the DTO limit is sufficient for the one write path that exists.

**Why the duplication can't be collapsed, despite looking like it should:**
- **Annotations on the entity instead of Fluent API** wouldn't help: the validator reads the class it binds to, so `[MaxLength]` on `Project.Name` does nothing for `CreateProjectRequest.Name`. The DTO attribute would still be needed, and the entity's copy would just move file. It also can't express everything — the UTC `ValueConverter` has no annotation equivalent — so model config would end up split across `Models/` *and* `OnModelCreating` instead of living in one place, and the entities would lose the POCO property of having zero EF knowledge.
- **Binding requests directly to entities** would unify them, at the cost of over-posting (clients could set `Id`, `Order`, `Tasks`) — the exact thing the DTO layer above exists to prevent.
- **Deriving validation from EF's model metadata at runtime** (`Model.FindEntityType(...).FindProperty(...).GetMaxLength()`) genuinely works — confirmed returning `200`/`True` off this `AppDbContext`. Rejected anyway: it trades a visible duplicate number for invisible reflection, can't feed attributes (so OpenAPI would need a matching custom schema filter), and forces a reviewer to learn a bespoke mechanism to understand why a request 400s.

This is a real ecosystem-level wart, not a local oversight. Django avoids it by refusing to split the model (`max_length=200` drives DDL, forms, and serializer alike) — buying one source of truth at the price of welding wire contract to DB schema. Rails and .NET both take the opposite bet: entity and wire contract are separate things allowed to diverge, and the price is declaring limits twice.

**What was done instead — `Models/FieldLengths.cs`:** three `const int`s (`ProjectName`, `TaskTitle`, `TaskDescription`) referenced from both layers, replacing nine scattered literals. `const` rather than `static readonly` because attribute arguments must be compile-time constants. **Deliberately one constant per field, not one shared `Name = 200`,** even though `ProjectName` and `TaskTitle` are both 200: those values match by coincidence, not because they're one policy, and collapsing coincidentally-equal values is the false-DRY trap — it couples two rules permanently, so the day task titles want more room, project names get dragged along. The drift the constant is meant to close is *between layers for a given field*, which it now makes impossible. **This is a convenience, not a unification** — the two layers stay independent by construction, which is the feature being paid for.

**Also dropped: three redundant `IsRequired()` calls** (on `Project.Name`, `TaskItem.Title`, and the `TaskItem → Project` relationship). With `<Nullable>enable</Nullable>`, EF's nullable-reference-type convention already maps non-nullable properties as required, and a non-nullable `int ProjectId` already makes the relationship required. Confirmed non-behavioural via `dotnet ef migrations has-pending-model-changes` → "No changes have been made to the model since the last migration": EF builds a byte-identical model without them, so no migration and no DDL change. A comment in `OnModelCreating` records why they're absent, since the convention is non-obvious enough that someone would otherwise add them back.

**On generating any of this instead (the schema-first alternative):** the pgtyped/dbmate model — SQL schema as single source, types derived — has no real .NET equivalent for the query-level part, and `dotnet ef dbcontext scaffold` (the schema→classes analog) is the *inverse* of this project's code-first migrations and would fight them. Worth noting for a provider swap: **the model is portable, the migrations are not.** `Data/Migrations/` is already SQLite-flavoured (`type: "INTEGER"`, `type: "TEXT"`, `.Annotation("Sqlite:Autoincrement", true)`), so `UseSqlite` → `UseNpgsql` is necessary but not sufficient — migrations would need regenerating, the UTC `ValueConverter` would become redundant (Npgsql maps `Kind=Utc` to `timestamptz` natively), and the `Foreign Keys=True` connection-string pragma is a SQLite-only wart.

#### Error handling strategy: exceptions as expected control flow, centralized to one middleware

Three custom exception types (`NotFoundException`, `ValidationException`, `ForbiddenOperationException`) plus EF's built-in `DbUpdateException` are all caught in exactly one place, `ExceptionHandlingMiddleware`, and mapped to `ProblemDetails`/`ValidationProblemDetails` responses (404 / 400 / 403 / 409 / 500 respectively). `Operations` methods just `throw`; no endpoint has a `try/catch`.

**Two validation paths that converge on the same response shape, not one:**
1. **Structural/field-shape validation** — `[Required]`, `[MaxLength]` on the request DTOs — is enforced by .NET 10's native Minimal API `AddValidation()`, which runs as an endpoint filter *before* the handler executes and short-circuits with its own 400 response. This path never throws, so `ExceptionHandlingMiddleware` never even sees it.
2. **Validation that needs DB state** — the reorder endpoints' duplicate-id and set-equality checks (`ProjectOperations.ReorderAsync`, `TaskOperations.ReorderAsync`) — can't be expressed as a static attribute, since it depends on which projects/tasks currently exist. This is expressed as a hand-thrown `TodoApi.Exceptions.ValidationException`, caught by the middleware.

`Program.cs` states directly why these two independent mechanisms end up looking identical to a client: `AddProblemDetails()` is configured with a `CustomizeProblemDetails` callback so the native-validation path's auto-generated response gets the same `Instance` field the middleware sets by hand — otherwise a client would see two subtly different error shapes depending on which validation path rejected the request. **Trade-off:** this is a real seam — two independent code paths whose output shape has to be kept in sync by hand rather than one unified validation pipeline. It's called out with an explicit comment in `Program.cs` precisely because it's the kind of thing that's easy to silently drift.

**Deliberate log-severity split:** `NotFoundException`/`ValidationException`/`ForbiddenOperationException` all log at `LogWarning` with message-only (no stack trace) — these are routine, expected outcomes (a stale client, a bad request), not bugs. Only the generic `catch (Exception ex)` fallback logs at `LogError` with the full exception. This means the log stream itself distinguishes "the API correctly rejected something" from "something actually broke," without needing a separate alerting rule to tell them apart later. The client-facing body for the unhandled-exception case is deliberately generic (no message, no stack trace) — full detail stays server-side in the log.

**`DbUpdateException` → 409, not 500:** covers races like a task's target project being deleted between validation and save (see `TaskOperations.MoveAsync`'s comment on this). Handling it centrally in the middleware means individual `Operations` methods don't each need a race-closing re-check — the comment in `MoveAsync` notes a re-check "can't close the window anyway," so the middleware catching the DB's own constraint violation is the actual fix, not a belt-and-suspenders addition.

#### EF Core migrations: three real migrations, auto-applied at startup

The migration history isn't a single `InitialCreate` — it already shows two schema changes after the fact (`ReplaceIsDefaultWithProjectOrder`, `DropProjectDescription`, both covered under Product decisions above), so this is evaluated as lived migration hygiene, not a hypothetical.

`Program.cs` calls `db.Database.Migrate()` unconditionally on every startup, before seeding. **Why this is fine here:** single SQLite file, single process, no concurrent instances — there's no "two instances race to apply the same migration" hazard because there's only ever one instance. **Trade-off / revisit trigger:** `Database.Migrate()` on startup is a known footgun the moment there's more than one instance of an app pointed at the same database (Postgres included) — concurrent `Migrate()` calls can race on the migrations-history table. At scale (see Database entry below), migrations should move to an explicit deploy step (`dotnet ef database update` in CI/CD, or an init container) that runs once, ahead of the app instances starting — not be left running from inside `Program.cs`.

#### Not done: CI gate on model-vs-migration drift

There's no `.github/workflows/` in this repo at all — no CI runs the tests, the build, or any drift check. Worth adding, and cheap:

```bash
dotnet ef migrations has-pending-model-changes --project backend/TodoApi
```

This is the same command already used by hand to confirm the dropped `IsRequired()` calls were non-behavioural (see Field-length constraints above); as a CI step it becomes a gate. It builds the project, loads `AppDbContext`, diffs the resulting model against `AppDbContextModelSnapshot.cs`, and exits non-zero if they disagree — i.e. if someone edited a model or `OnModelCreating` and forgot `migrations add`. No database connection required, since it's a model-vs-snapshot comparison. `Microsoft.EntityFrameworkCore.Design` is already referenced with `PrivateAssets=all`, so the CLI works in CI without the design assembly shipping.

**Worth pairing with `dotnet ef migrations script --idempotent` posted to the PR,** because the drift check has a narrow remit and the gap is easy to overstate. It proves the snapshot matches the model. It does not prove the migration is *good*:

- **Destructive migrations pass it happily.** `DropProjectDescription` (above) is exactly the shape of change that is fully in sync with the model and still drops a column. Catching that needs a human reading the DDL, or a policy check grepping for `DropColumn`/`DropTable`.
- **Snapshot merge conflicts can pass it.** Two branches each adding a migration both edit `AppDbContextModelSnapshot.cs`. Git will often auto-merge that into something self-consistent — so the check passes — but not equal to what either branch's migration actually applies.
- **It's only as honest as `OnModelCreating` being deterministic.** Ours is. If model config ever branched on an environment variable or a provider check, CI and local could legitimately disagree.

**Note this is a different mechanism from the frontend's `gen:api` drift check** (see Type safety at the boundary, and Schema/type generation CI enforcement below), even though both are "did you forget to regenerate" gates. That one is the generic codegen pattern — regenerate the file, `git diff --exit-code`, a dirty tree means someone skipped a step. `has-pending-model-changes` never writes anything, so there's no diff to inspect; the exit code *is* the answer. Both belong in the same workflow; neither substitutes for the other.

#### Data seeding: idempotent, but not environment-gated

`DbSeeder.SeedAsync` is a no-op if any project already exists (checked once, before inserting) — safe to call on every startup against a persisted file, per its own doc comment. It's called unconditionally in `Program.cs`, with no `if (app.Environment.IsDevelopment())` guard — unlike Swagger, which *is* gated that way two lines below it.

**Why this is fine today:** the app has exactly one deployment shape (a local single-user instance), and seeding on first run *is* the intended experience — a first-time user should see example projects/tasks rather than a blank app. **Trade-off:** if this app ever pointed at a shared or production database, this would silently insert "Inbox"/"Personal"/"Work" demo data into it on first deploy with no way to opt out short of pre-populating a project. Worth an environment gate (mirroring the Swagger one right next to it in `Program.cs`) the moment there's a deployment target that isn't a fresh local file — cheap to add, just not yet needed.

#### Validation approach: DataAnnotations + one hand-thrown exception type, not a dedicated validation layer

There is no `Validation/` folder or FluentValidation-style validator classes — validation is split exactly two ways, both already described above under Error handling: DataAnnotations attributes on request DTOs (enforced by the native Minimal API filter) for anything expressible per-field/per-request, and `TodoApi.Exceptions.ValidationException` thrown from `Operations` for anything that needs current DB state to evaluate (reorder set-equality/duplicates). **Why not a third, dedicated validator layer (FluentValidation, custom `IValidator<T>`):** with only two request shapes needing cross-field or stateful validation (both reorder endpoints), a general-purpose validation framework would be structure built for a variety of validation rules this app doesn't have. **Trade-off:** the two paths' error shapes are only kept aligned by the `CustomizeProblemDetails` callback noted above, not by construction — the same seam already flagged there.

#### Minimal APIs vs. Controllers

The whole API is Minimal APIs (`MapGroup`/`MapGet`/`MapPost` in `Endpoints/*.cs`), not MVC controllers (`[ApiController]` classes with attribute routing). **What this costs, concretely, visible in this codebase:** things MVC gives for free had to be assembled by hand — request validation (`AddValidation()`, a .NET 10 addition, rather than automatic `[ApiController]` model-state validation), the `ProblemDetails` response convention (`AddProblemDetails()` + a custom middleware, rather than MVC's built-in `ValidationProblemDetails` on invalid `ModelState`), and there's no filter-pipeline equivalent to MVC action filters — cross-cutting concerns here are ASP.NET Core middleware (`ExceptionHandlingMiddleware`, CORS, rate limiting) instead. **What it buys:** every route in `ProjectEndpoints.cs`/`TaskEndpoints.cs` is a few lines — parse params, call one `Operations` method, wrap the result — with no controller-class ceremony (constructor injection boilerplate, one class per resource) for an API this size (nine routes total across two resources). **Verdict:** a reasonable fit at this scale specifically because .NET 10's Minimal API validation support closed the main gap (structural validation) that used to make Minimal APIs a harder sell for anything beyond a handful of routes; would revisit if the route count or the need for shared per-route policy (authorization attributes, versioning conventions) grew enough that hand-wiring each concern via middleware stopped being cheaper than MVC's conventions.

#### Task routes: flat (`/api/tasks`), not nested under `/api/projects/{projectId}/tasks` — plus one `PATCH` instead of four `PUT`s

**Before:**
```
GET    /api/projects/{projectId}/tasks
POST   /api/projects/{projectId}/tasks
PUT    /api/tasks/{id}
PUT    /api/tasks/{id}/complete
PUT    /api/tasks/{id}/uncomplete
PUT    /api/tasks/{id}/move
DELETE /api/tasks/{id}
PUT    /api/projects/{projectId}/tasks/reorder
```

**After:**
```
GET    /api/tasks?projectId={projectId}
POST   /api/tasks                    { projectId, title, description? }
PATCH  /api/tasks/{id}               { title?, description?, isComplete?, projectId? }
DELETE /api/tasks/{id}
PUT    /api/tasks/order              { projectId, orderedTaskIds: [...] }
```

**Why drop the `/projects/{projectId}/tasks` nesting:** a `Task`'s `projectId` is a plain, mutable foreign key — proven by the fact a `move` endpoint already exists to change it. Nesting the URL under a project implies the task lives at that path, the way a filesystem path implies containment; that's misleading for a relationship the app itself treats as reassignable. Once `projectId` is "just a field," it belongs in a query param (for `GET`) or the body (for `POST`), not the route — the same way no other filter/foreign-key ever became its own path segment in this API.

**Why collapse `PUT /{id}`, `/complete`, `/uncomplete`, and `/move` into one `PATCH /{id}`:** all four were "change one or more fields on this task" wearing different URLs. `{ isComplete: true }` replaces complete/uncomplete; `{ projectId: 5 }` replaces move. `PATCH`'s actual semantics (apply a partial change) also fit better than the previous `PUT`s, which mutated a single field or toggled a flag without ever sending a full resource representation — the literal contract of `PUT` (replace the resource with this representation) was being invoked for something that wasn't a replace.

**Why reorder stays its own endpoint, not folded into `PATCH`:** reordering isn't "update one resource's field," it's a bulk resequencing of every sibling's `Order` in a collection — there's no single task id to `PATCH` against. It keeps the full-replace-list shape (see Project reordering above) and moves from `/projects/{projectId}/tasks/reorder` to a flat `/tasks/order` with `projectId` now carried in the body instead of the route, for the same flattening reason as list/create.

**Trade-off:** `GET /api/tasks` needs `projectId` treated as a required query param (400 without it) rather than letting an unscoped "every task across every project" query fall out by accident — behavior stays identical to today, just moved from path to query string. `POST`/`PUT order` also lose the free route-level `int` binding/validation on `projectId` that nesting gave for free; existence-checking has to happen in the handler either way, so this is a small cost, not a new one.

**One shape per resource, regardless of relationship or operation.** This is the same principle behind the `PATCH` consolidation above, just applied to routing: don't let *how* a resource is being touched, or *which* other resource currently owns it, change *where* it lives. `Project` was already flat (`/api/projects`); this makes `Task` follow the identical rule instead of carrying a special nesting case because it happens to have a (mutable) parent.

### Frontend

#### State management

Didn't use redux/zustand or even contexts — unnecessary for this small app.
- AI tried to do this with a render prop which I felt was not as appropriate.

#### Frontend–Backend communication

- **Typesafety:** Although kind of unnecessary for an app this scale (developer of 1), because it was explicitly mentioned that one of the evaluation criteria was in this area and because the OpenAPI endpoint was easy to generate, I implemented zod for compile-time and runtime type checking. I did not add CI/CD for ensuring the generated types were validated. TODO: something I still might do.
    - AI did this with handwritten types first and then suggested a compile-time-only generator.
- **Query framework:** I used react-query because our product/data schema is simple (as opposed to GraphQL/Apollo which would be well-suited for a more complex data schema or complex product usage of data). Instead of configuring it with a longer staleTime, I erred towards more refetching because it's cheap, esp with react-query's caching and refetch in background and request deduping. The caching also makes it easy to avoid prop-drilling without paying for an extra fetch. React-query also gives retry, loading/error states for free. (Reordering is the one deliberate exception to "no optimistic writes" — see below.)

#### Client/UI state management: local `useState`, no lifting beyond the owning component

Every piece of non-server state — dialog/menu open-ness, form field values, "is this being dragged," the toast's current message — is a plain `useState` scoped to the component that owns the concern, not lifted to `App.tsx` or put in context. Concretely:
- **Ephemeral open/closed flags stay in the component that renders the trigger.** `TaskItem` owns `isDetailOpen`/`isConfirmingDelete`; `TaskList` owns `isAddingTask`/`activeId` (the currently-dragged row); `ContentArea` (in `App.tsx`) owns `isEditOpen`/`isDeleteOpen` for the project-level dialogs. Nothing here is shared across siblings, so there's no lifting to do — each flag has exactly one owner and one consumer.
- **Form state lives in the form.** `NewTaskForm`/`NewProjectForm` hold `title`/`description` locally and reset them in the mutation's `onSuccess`, rather than routing draft input through any shared store.
- **The one genuinely cross-cutting piece of UI state — the error toast — is deliberately *not* React state lifted through props.** `toastBus.ts` is a tiny module-level pub/sub (`showErrorToast`/`subscribeToToasts`) outside the component tree, and `ToastHost` (mounted once in `main.tsx`) is the sole subscriber. This exists because the source of a toast isn't always inside a component: React Query's `QueryCache.onError` (a load failure) fires from outside any component's render, so there's no props path to hand it a setter. A plain subscriber pattern sidesteps that instead of threading a callback through context just to reach one root-level component.
- **The one piece of state that *is* lifted** is `selectedProjectId` in `App.tsx`, because it's genuinely shared: both `ProjectSidebar` (sets it) and `ContentArea` (reads it) need it, and they're siblings with no other shared ancestor to own it.

**Why no context/store:** noted already under the earlier State management entry — this is a solo-developer, single-view app, and every case above already has a natural, single owner. Context or Zustand would just be indirection for state that isn't actually shared. **Trade-off / revisit trigger:** if more state needs to be shared across components that aren't parent/child of each other (the same shape as the toast-bus problem, but for something other than toasts), that's the signal to introduce context — not app size alone.

#### Component composition: dialogs are generic + composed, feature components own their data

Two kinds of split show up in `components/`:
- **Generic, presentation-only building blocks** — `Dialog` (arbitrary content, portaled), `ConfirmDialog` (fixed title/message/confirm-cancel shape), `ActionMenu` (the "…" overflow popover). None of these know about projects or tasks; they take content/copy/callbacks as props and are reused across both entity types (e.g. the same `ConfirmDialog` backs both project-delete and task-delete confirmations). This is the reuse axis: generic UI shape, zero domain knowledge.
- **Feature components own their own data fetching and mutations** — `TaskList`/`TaskItem`/`ProjectSidebar` each run their own `useQuery`/`useMutation` rather than receiving data as props from a parent. `TaskItem` doesn't take a `tasks` array; it takes one `task` and manages its own toggle/move/delete mutations. This keeps each row independently interactive (its own pending state, its own error handling) without the parent needing to coordinate per-row mutation state.
- **`taskOrdering.ts` living in `components/` rather than a separate `utils/`/`lib/` folder is intentional colocation, not a misfile.** It's pure, dnd-kit-independent logic (`sortTasks`, `computeReorderedIds`) extracted *specifically* so it can be unit-tested directly with a plain object shaped like a `DragEndEvent`, instead of driving dnd-kit's simulated pointer/keyboard sensors through jsdom. It's colocated with `TaskList`/`TaskItem` (its only two callers) rather than promoted to a shared utils location, since nothing else in the app needs it — promoting it now would be speculative organization for code with a single consumer pair.

**Trade-off / revisit trigger:** this flat `components/` folder (one level, no `features/tasks/` grouping) is fine at two entities (projects, tasks). Past that, the same colocation instinct that put `taskOrdering.ts` next to its callers argues for grouping by feature (component + its logic + its api calls together) rather than continuing to split by "is this a component or not."

#### Type safety at the boundary: one generated file does both jobs, not a schema/types split

Worth a correction here: `api/schema.ts` and `api/types.ts` as separate files was my assumption before checking — the actual file is a single `api/generated-schemas.ts`, auto-generated by `openapi-zod-client` from the backend's OpenAPI spec (`npm run gen:api`). It exports both the zod schemas (`schemas.ProjectResponse`, etc., used for runtime validation) *and* the inferred TS types (`export type ProjectResponse = z.infer<typeof ProjectResponse>`) from the same source, so there's no separate hand-maintained type layer to drift from the runtime layer.

`api/client.ts`'s `request()` helper runs every response through `schema.safeParse()` before returning it (see [ezra-evaluation-criteria-tradeoffs.md's earlier API-layer notes] and `client.ts:62-73`); a shape mismatch throws a distinct `ResponseValidationError` (not `ApiError`, which is reserved for HTTP-level/problem-details failures) so the two failure modes — "server said no" vs. "server said yes but the body doesn't match what we expected" — are distinguishable to callers and to `toToastMessage()`.

**Why generate rather than hand-write:** the brief explicitly calls out FE/BE communication as an evaluation axis, and the OpenAPI endpoint was already there for free (ASP.NET Core minimal APIs emit it). Hand-written types would be "fine for a developer of one," per the file's own header comment, but generation gets both compile-time and runtime checking from a single source of truth at low marginal cost.

**Trade-off, stated directly in the generated file's header comment:** this only stays safe if `npm run gen:api` is enforced in CI (regenerate-and-diff-check) — which isn't set up. Today nothing stops the frontend's generated types from silently drifting from the backend DTOs between manual regenerations. Flagged as a TODO in the doc already (Frontend–Backend communication section above).

#### Reordering is optimistic, and the same pattern is shared by projects and tasks

_Updated: this used to be pessimistic (see history below) — it's since been changed to optimistic._

Drag-to-reorder (both the project sidebar and the task list) is **optimistic**: on drop, the new order is written into the query cache *synchronously*, before the request resolves, so the dropped row stays exactly where it was released instead of flashing back to its old slot while the request is in flight. The full reordered id list is then sent to the server; `onSuccess` overwrites the optimistic cache entry with the server's authoritative response (`setQueryData`), and `onError` rolls the cache back to the pre-drag snapshot taken just before the optimistic write. The identical shape is shared by `ProjectSidebar` and `TaskList` (`TaskList` additionally reassigns each task's `order` field by new index, since `sortTasks` there sorts by that field rather than array position).

**Why:** a reorder drop is a case where the user has already seen the result they want (the row visually dropped into a slot) — reverting to the old order only on a rare server rejection, rather than delaying the visual update until the round-trip completes, matches the drag gesture's own affordance. This is a narrower, deliberate exception to the general react-query decision above (erring toward server-truth/refetching over optimistic writes elsewhere) — reordering is the one interaction where the in-flight delay was visible/annoying enough (a drop snapping back to its old position for a moment) to justify the rollback bookkeeping that decision was otherwise avoiding.

**Trade-off:** unlike the rest of the app's mutations, this one needs a captured "previous" snapshot and an explicit rollback path per drop — the exact bookkeeping the pessimistic-by-default policy was chosen to avoid elsewhere. Kept scoped to just the two reorder mutations rather than becoming the app's general pattern.

<details>
<summary>Superseded: earlier pessimistic version of this note</summary>

Drag-to-reorder (both the project sidebar and the task list) is **pessimistic**, not optimistic: on drop it sends the full reordered id list to the server and adopts the new order *only* from the server's response (`setQueryData` with what came back). If the mutation fails, the query cache — and therefore the rendered list — is left untouched, so the list simply reverts to its last-known-good order. No manual rollback bookkeeping.

**Why:** this is the direct counterpart to the react-query decision above (err toward server-truth over optimistic writes). It keeps the client from ever showing an order the server didn't accept, and the exact same pattern is mirrored between `ProjectSidebar` and `TaskList` so there's one reordering idiom to understand. The trade-off is a brief in-flight delay on drop instead of instant optimistic movement — fine for a local app, and cheap given react-query's caching.

</details>

#### Generic `Dialog` component: portaled to `<body>` with input isolation

Modals render through a single generic `Dialog` (distinct from `ConfirmDialog`, the title/message/confirm-cancel prompt) that is **portaled to `<body>`** and stops pointer/keydown propagation at its root.

**Why (this is the least obvious decision in the batch):** these are two separate mechanisms solving two separate problems, and it's worth being precise about which does what. The **portal is purely for layering** — the overlay has to escape any ancestor `overflow` / `transform` / stacking context so it covers the viewport and sits on top. It does *nothing* for dnd-kit: React synthetic events bubble through the *component* tree regardless of where the DOM lives, so a portaled dialog opened from inside a draggable row still feeds pointer/key events to that row's dnd-kit activators. The **`stopPropagation` at the dialog root is the load-bearing fix** for the drag interference. dnd-kit's pointer and keyboard activators are synthetic listeners (`onPointerDown` / `onKeyDown` spread onto the row), so stopping those synthetic events at the dialog root is what prevents a `pointerdown` inside the dialog (e.g. dragging the textarea resize handle) from starting a row drag, and equally what prevents Space in a field being read as "pick up" — both cases are synthetic, so this single guard covers both, portal or no portal. (An earlier version of this note framed the portal as fixing the keyboard case; that was imprecise — the keyboard activator is synthetic too.) This was iterated after the drag-through bug actually surfaced.

#### Reusable overflow menu and on-demand forms

- Added a reusable `ActionMenu` "…" overflow popover (closes on outside-click / Escape / selection, and stops click propagation so opening it on a clickable row doesn't also trigger the row's action). Per-row secondary actions live here so they stay tucked away until wanted.
- Project actions (Edit + Delete) were consolidated into a single "…" menu next to the content-area title, rather than being scattered on each sidebar row.
- Project and task creation are now on-demand inline forms (revealed by an "Add" affordance) instead of always-present forms / dialogs, which also let me drop the now-empty "No tasks yet." text since the Add button conveys the empty state.

#### Other UX/interaction polish

- Collapsible project sidebar.
- The dragged row follows the cursor via dnd-kit's `DragOverlay`, and a click vs. a deliberate drag are disambiguated via sensor activation constraints so a plain click still selects/opens while a drag reorders.
- Completed tasks show a locked detail dialog (mirroring the backend edit lock) with an explicit Save action and an actions rail.

#### Style system

Decided on a BEM (Block-Element-Modifier) style system because it's simple and works for a single developer. Likely the next step at scale is to evolve this to CSS Modules to avoid possible class-name conflicts. That would have been easy enough to do since [Vite enables this](https://vite.dev/guide/features#css-modules). TODO: Maybe I'll do this still.

#### Error handling

I did not include any client-side logging in prod — I would add Sentry at scale.
- AI did not support error handling very well — printing the output directly to the user. I added a better error view rather than printing output, and logged to the console in a dev env.

**Three separate channels, chosen by what kind of failure it is** (policy centralized in `api/errors.ts`, not duplicated per component):
1. **Field-validation errors** (400 problem-details from the API) — `extractFieldErrors()` pulls them out and the form renders them **inline** next to the field (`NewProjectForm`, `NewTaskForm`, `TaskDetailDialog`, the project edit form). These are actionable by the user right where they're looking.
2. **Everything else** (network errors, 500s, non-field mutation failures) — `toToastMessage()` + `showErrorToast()` push onto a shared toast bus rendered by one app-level `ToastHost`. Every mutation without a natural field to attach to uses this (toggle-complete, delete, drag-reorder rollback, etc.).
3. **Render-phase bugs** (actual thrown exceptions, not query/mutation failures) — caught by a class-based `ErrorBoundary`, paired with react-query's `QueryErrorResetBoundary` in `main.tsx` so retry actually re-runs the failed queries instead of re-rendering the same cached error.

**Why split this way:** inline is reserved for errors the user can fix on the spot (bad input); toast is the catch-all for failures with no single field to blame; the error boundary is the last resort for bugs, not data failures. Optimistic-then-rolled-back mutations (drag reorder) also report through the toast channel, consistent with #2.

**Loading states, by contrast, aren't centralized** — no global spinner. Each component checks its own query's `isLoading` and renders inline text locally (`TaskList`, `ProjectSidebar`, the `ContentArea` placeholder in `App.tsx`). Considered a global spinner and rejected it: this is a multi-pane layout (sidebar + content), and a global spinner would block/hide the whole UI even when only one region is actually refetching — e.g. switching projects shouldn't blank the sidebar while tasks load. Trade-off: no unified loading copy/style across components (`"Loading…"` vs `"Loading tasks…"` vs `"Loading projects…"`) — a shared `<LoadingIndicator label=".."/>` would fix that inconsistency without going global, if it's ever worth doing.

## At scale

The intro above names three axes to evaluate scale at — users, product surface area, developer team — and that framing is what organizes this section: each item below is really answering "what breaks first, and along which axis." Grounded against what's actually in the repo today (confirmed by reading the code, not assumed): no auth/authorization exists yet, no endpoint paginates its results, and the DB provider is SQLite (`UseSqlite` in `Program.cs`).

### Frontend at scale

- **Routing.** There's no router today — `App.tsx` is the whole app. Multiple views/pages (surface area) would need react-router (or similar), which also forces a decision on how `ProjectSidebar`/`TaskList` state relates to URL state.
- **Folder structure.** Flat `components/` won't hold up past a handful of features (surface area + team). Move to feature-colocated folders (e.g. `features/tasks/`, `features/projects/`) grouping components + hooks + api calls together, rather than the current `api/` vs `components/` split.
- **Schema/type generation CI enforcement.** Types are already generated from the backend's OpenAPI spec (`api/generated-schemas.ts`, via `npm run gen:api` — see Type safety at the boundary above), not hand-maintained. The gap is that regeneration isn't CI-enforced, so the generated file can silently drift from the backend DTOs between manual runs. At scale (surface area + team), add a CI check that regenerates and diffs against the committed file.
- **List rendering.** `TaskList` with unbounded tasks needs pagination or virtualization once a project has hundreds of tasks (users/data volume) — ties directly to backend pagination below; the two have to land together since virtualizing a client-side list that already fetched everything doesn't solve the underlying transfer/query cost.
- **Client state.** If forms/interactions grow beyond a few components (surface area), ad hoc `useState` lifted through props gets unwieldy — reach for context or a small store (Zustand) rather than prop drilling. Kept deliberately out of scope today per the State management decision above; this is the trigger for revisiting it.
- **Test structure.** Component tests (`*.test.tsx`) only cover so much — add an e2e layer (Playwright) once there are multi-step flows worth protecting end-to-end (surface area + team, so regressions across features are caught before review rather than by a human clicking through).

### Backend at scale

- **Auth/authorization.** The biggest gap — there's currently none. Any real multi-user scaling (users) requires this before anything else, and it reshapes `Operations/` (ownership checks) and `Endpoints/` (auth middleware/policies). Everything else in this list assumes single-tenant until this lands.
- **Pagination.** Endpoints return full collections with no `Skip`/`Take`. Needed as soon as task/project counts grow (users/data volume) — also unblocks the frontend virtualization item above.
- **Database.** SQLite is fine for a single-writer local app; scaling concurrent writers/traffic (users) means moving to Postgres (or similar) — mostly a connection-string + provider swap given EF Core is already the abstraction, but migrations should be re-validated against the new provider rather than assumed to carry over cleanly.
- **Operations layer.** `Operations/ProjectOperations.cs`/`TaskOperations.cs` currently sit close to endpoints; at scale (team + surface area) this is where you'd introduce interfaces (repository/service pattern) so they're mockable and swappable, since tests currently exercise a real (in-memory) DbContext directly.
- **Observability.** No correlation-ID middleware or request tracing today — removed after initially building it. Two reasons: (1) a single-process local app with one developer reading logs directly has no need to stitch together log lines from a request across services/instances; (2) it was also redundant with what ASP.NET Core already provides — `HttpContext.TraceIdentifier` is generated per request automatically, and the framework creates a W3C-Trace-Context-compliant `Activity` (`Activity.Current`) per request too, which a hand-rolled `X-Correlation-Id` header just duplicates. At scale (users + team, especially once there's more than one backend instance or a request touches multiple services), the standards-based path — the existing `Activity`/`traceparent` propagation plus an OpenTelemetry exporter — is what to reach for, rather than reintroducing custom middleware.
- **Rate limiting / API versioning.** Not needed for a single internal client today, but become relevant once there's an external or multi-client consumer (surface area) — the same reasoning that keeps API Versioning deliberately unversioned above, just revisited once that assumption stops holding.

The common thread: right now both sides are "single-user, single-view, small dataset" shaped, so scaling isn't one change but three separable tracks — **more data** (pagination/virtualization), **more users** (auth), and **more surface area** (routing, feature folders, service layer). Which one actually shows up first should decide what gets built first, rather than building all of it speculatively now — the same over-engineering pitfall named in the intro.

# Uncategorized

## Process / meta-criteria coverage

- **"Clean code, architecture structure, and thought process"** — Every scope decision in the plan's Key Decisions section carries an explicit rationale (why SQLite over in-memory, why Inbox is a real seeded project row instead of a null sentinel, why project deletion cascades instead of orphaning tasks). That rationale trail is the "thought process" artifact the brief asks for. _(Note: the Inbox-as-a-real-row decision has since been superseded — the Inbox/default concept was removed entirely; see Product decisions above.)_
- **"Trade-offs and assumptions"** — Captured directly: the Key Decisions section names six explicit trade-offs with reasoning; the Dependencies/Assumptions section states the fixed tech-stack inputs (.NET Core, EF Core, SQLite, React) and the single-instance deployment assumption.
- **"Comments or a README.md explaining assumptions, scalability, and what you would implement in the future"** — The Scope Boundaries section (due dates/scheduling, auth/multi-user, nested sub-projects — each excluded with a stated reason) and the Dependencies/Assumptions section (single-instance scalability framing) are already drafted at the requirements stage. These sections are written to carry forward into the eventual README's "assumptions / scalability / future work" content rather than being redone from scratch at submission time.
- **Avoiding the brief's two named pitfalls** ("minimal scaffolding without real thought" / "over-architecting or overcomplicating a simple prompt") — The plan's Problem Frame explicitly names both failure modes as the thing it's threading, and each Key Decision states why a simpler or more complex alternative was rejected. One caveat: the doc-review pass on this plan flagged manual task reordering (R6) as the one requirement without that same explicit justification — worth a one-line rationale (or cutting it) before this claim is airtight.

## Submission logistics — not yet applicable

- The actual `README.md` file with setup steps, written once the implementation exists.
- The GitHub repo link itself — pure submission logistics.
