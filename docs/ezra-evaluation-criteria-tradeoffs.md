# Ezra Take-Home — Non-Technical Requirements & Trade-off Coverage

Ezra's brief ([docs/original_instructions.md](docs/original_instructions.md)) mixes technical evaluation criteria (backend framework, data store, frontend framework, FE/BE communication) with process and judgment criteria that aren't about the tech stack itself. This tracks the latter and shows where the [Todo Task Management App plan](docs/plans/2026-07-02-001-feat-todo-task-management-plan.md) already satisfies them through decisions made during brainstorming — so they aren't re-litigated or lost by submission time.

## Decisions made

### Product decisions

_(none logged yet in this document)_

### Backend

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

### Frontend

_(none logged yet in this document)_

# Uncategorized

## Process / meta-criteria coverage

- **"Clean code, architecture structure, and thought process"** — Every scope decision in the plan's Key Decisions section carries an explicit rationale (why SQLite over in-memory, why Inbox is a real seeded project row instead of a null sentinel, why project deletion cascades instead of orphaning tasks). That rationale trail is the "thought process" artifact the brief asks for.
- **"Trade-offs and assumptions"** — Captured directly: the Key Decisions section names six explicit trade-offs with reasoning; the Dependencies/Assumptions section states the fixed tech-stack inputs (.NET Core, EF Core, SQLite, React) and the single-instance deployment assumption.
- **"Comments or a README.md explaining assumptions, scalability, and what you would implement in the future"** — The Scope Boundaries section (due dates/scheduling, auth/multi-user, nested sub-projects — each excluded with a stated reason) and the Dependencies/Assumptions section (single-instance scalability framing) are already drafted at the requirements stage. These sections are written to carry forward into the eventual README's "assumptions / scalability / future work" content rather than being redone from scratch at submission time.
- **Avoiding the brief's two named pitfalls** ("minimal scaffolding without real thought" / "over-architecting or overcomplicating a simple prompt") — The plan's Problem Frame explicitly names both failure modes as the thing it's threading, and each Key Decision states why a simpler or more complex alternative was rejected. One caveat: the doc-review pass on this plan flagged manual task reordering (R6) as the one requirement without that same explicit justification — worth a one-line rationale (or cutting it) before this claim is airtight.

## Submission logistics — not yet applicable

- The actual `README.md` file with setup steps, written once the implementation exists.
- The GitHub repo link itself — pure submission logistics.
