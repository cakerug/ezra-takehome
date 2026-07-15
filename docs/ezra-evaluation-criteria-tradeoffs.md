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

### Frontend

#### State management

Didn't use redux/zustand or even contexts — unnecessary for this small app.
- AI tried to do this with a render prop which I felt was not as appropriate.

#### Frontend–Backend communication

- **Typesafety:** Although kind of unnecessary for an app this scale (developer of 1), because it was explicitly mentioned that one of the evaluation criteria was in this area and because the OpenAPI endpoint was easy to generate, I implemented zod for compile-time and runtime type checking. I did not add CI/CD for ensuring the generated types were validated. TODO: something I still might do.
    - AI did this with handwritten types first and then suggested a compile-time-only generator.
- **Query framework:** I used react-query because our product/data schema is simple (as opposed to GraphQL/Apollo which would be well-suited for a more complex data schema or complex product usage of data). Instead of configuring it with a longer staleTime or any optimistic writes, I erred towards more refetching because it's cheap, esp with react-query's caching and refetch in background and request deduping. The caching also makes it easy to avoid prop-drilling without paying for an extra fetch. React-query also gives retry, loading/error states for free.

#### Reordering is pessimistic, and the same pattern is shared by projects and tasks

Drag-to-reorder (both the project sidebar and the task list) is **pessimistic**, not optimistic: on drop it sends the full reordered id list to the server and adopts the new order *only* from the server's response (`setQueryData` with what came back). If the mutation fails, the query cache — and therefore the rendered list — is left untouched, so the list simply reverts to its last-known-good order. No manual rollback bookkeeping.

**Why:** this is the direct counterpart to the react-query decision above (err toward server-truth over optimistic writes). It keeps the client from ever showing an order the server didn't accept, and the exact same pattern is mirrored between `ProjectSidebar` and `TaskList` so there's one reordering idiom to understand. The trade-off is a brief in-flight delay on drop instead of instant optimistic movement — fine for a local app, and cheap given react-query's caching.

#### Generic `Dialog` component: portaled to `<body>` with input isolation

Modals render through a single generic `Dialog` (distinct from `ConfirmDialog`, the title/message/confirm-cancel prompt) that is **portaled to `<body>`** and stops pointer/keydown propagation at its root.

**Why (this is the least obvious decision in the batch):** dialogs like the task detail view are opened from *inside* a draggable row that has dnd-kit pointer/keyboard listeners. Portaling reparents the DOM so keystrokes typed into dialog fields don't bubble through the row's DOM subtree (where Space could be read as "pick up"). But a portal only moves the DOM — React synthetic events still bubble through the *component* tree, so a `pointerdown` inside the dialog (e.g. dragging the textarea resize handle) would still reach the ancestor row's dnd-kit handler and start dragging the row behind the dialog. Stopping pointer/keydown propagation at the dialog root closes that second path. This was iterated after the drag-through bug actually surfaced.

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

# Uncategorized

## Process / meta-criteria coverage

- **"Clean code, architecture structure, and thought process"** — Every scope decision in the plan's Key Decisions section carries an explicit rationale (why SQLite over in-memory, why Inbox is a real seeded project row instead of a null sentinel, why project deletion cascades instead of orphaning tasks). That rationale trail is the "thought process" artifact the brief asks for. _(Note: the Inbox-as-a-real-row decision has since been superseded — the Inbox/default concept was removed entirely; see Product decisions above.)_
- **"Trade-offs and assumptions"** — Captured directly: the Key Decisions section names six explicit trade-offs with reasoning; the Dependencies/Assumptions section states the fixed tech-stack inputs (.NET Core, EF Core, SQLite, React) and the single-instance deployment assumption.
- **"Comments or a README.md explaining assumptions, scalability, and what you would implement in the future"** — The Scope Boundaries section (due dates/scheduling, auth/multi-user, nested sub-projects — each excluded with a stated reason) and the Dependencies/Assumptions section (single-instance scalability framing) are already drafted at the requirements stage. These sections are written to carry forward into the eventual README's "assumptions / scalability / future work" content rather than being redone from scratch at submission time.
- **Avoiding the brief's two named pitfalls** ("minimal scaffolding without real thought" / "over-architecting or overcomplicating a simple prompt") — The plan's Problem Frame explicitly names both failure modes as the thing it's threading, and each Key Decision states why a simpler or more complex alternative was rejected. One caveat: the doc-review pass on this plan flagged manual task reordering (R6) as the one requirement without that same explicit justification — worth a one-line rationale (or cutting it) before this claim is airtight.

## Submission logistics — not yet applicable

- The actual `README.md` file with setup steps, written once the implementation exists.
- The GitHub repo link itself — pure submission logistics.
