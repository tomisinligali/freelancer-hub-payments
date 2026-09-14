---
trigger: always_on
---

# Project Status Rules

## Purpose

Keep project lifecycle behavior predictable and entirely controlled by the freelancer.

## Canonical Statuses

1. The only project statuses in v1 are:
   - `NOT_STARTED`
   - `IN_PROGRESS`
   - `DONE`
   - `ARCHIVED`

2. New projects must default to `NOT_STARTED`.

## Status Changes

3. Project status is user-driven.

4. Do not automatically change project status because of:
   - time entries
   - payments
   - due dates
   - client archival
   - edits
   - AI output
   - external integrations

5. Any status may transition directly to any other status.

6. Do not introduce mandatory workflow transitions.

7. Do not introduce a workflow engine, approval state, or hidden transition state for v1.

8. A status change must remain a single-field domain update rather than requiring a sequence of intermediary statuses.

## Completed Timestamp

9. When a project transitions into `DONE`, set `completedAt`.

10. When a project leaves `DONE`, clear `completedAt`.

11. Do not allow `completedAt` to remain populated after the project is no longer `DONE`.

12. Do not use `updatedAt` as a substitute for `completedAt`.

13. Editing unrelated project fields must not falsely represent the project as newly completed.

## Archived Projects

14. `ARCHIVED` is a project status, not a separate soft-delete mechanism.

15. Do not introduce `Project.archivedAt` as an alternative representation of the `ARCHIVED` status unless the product specification explicitly changes.

16. Archiving a client must never automatically change a project's status.

## AI and Integrations

17. AI systems and external integrations must never change project status automatically.

18. If an AI feature recommends a status, the recommendation must not become authoritative project state without an explicit user-driven action.