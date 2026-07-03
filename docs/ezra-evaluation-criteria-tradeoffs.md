# Ezra Take-Home — Non-Technical Requirements & Trade-off Coverage

Ezra's brief ([docs/original_instructions.md](docs/original_instructions.md)) mixes technical evaluation criteria (backend framework, data store, frontend framework, FE/BE communication) with process and judgment criteria that aren't about the tech stack itself. This tracks the latter and shows where the [Todo Task Management App plan](docs/plans/2026-07-02-001-feat-todo-task-management-plan.md) already satisfies them through decisions made during brainstorming — so they aren't re-litigated or lost by submission time.

## Already covered by decisions made in the plan

- **"Clean code, architecture structure, and thought process"** — Every scope decision in the plan's Key Decisions section carries an explicit rationale (why SQLite over in-memory, why Inbox is a real seeded project row instead of a null sentinel, why project deletion cascades instead of orphaning tasks). That rationale trail is the "thought process" artifact the brief asks for.
- **"Trade-offs and assumptions"** — Captured directly: the Key Decisions section names six explicit trade-offs with reasoning; the Dependencies/Assumptions section states the fixed tech-stack inputs (.NET Core, EF Core, SQLite, React) and the single-instance deployment assumption.
- **"Comments or a README.md explaining assumptions, scalability, and what you would implement in the future"** — The Scope Boundaries section (due dates/scheduling, auth/multi-user, nested sub-projects — each excluded with a stated reason) and the Dependencies/Assumptions section (single-instance scalability framing) are already drafted at the requirements stage. These sections are written to carry forward into the eventual README's "assumptions / scalability / future work" content rather than being redone from scratch at submission time.
- **Avoiding the brief's two named pitfalls** ("minimal scaffolding without real thought" / "over-architecting or overcomplicating a simple prompt") — The plan's Problem Frame explicitly names both failure modes as the thing it's threading, and each Key Decision states why a simpler or more complex alternative was rejected. One caveat: the doc-review pass on this plan flagged manual task reordering (R6) as the one requirement without that same explicit justification — worth a one-line rationale (or cutting it) before this claim is airtight.

## Not yet applicable — deliverables for submission time, not the requirements doc

- The actual `README.md` file with setup steps, written once the implementation exists.
- The GitHub repo link itself — pure submission logistics.
