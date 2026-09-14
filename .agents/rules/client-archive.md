---
trigger: always_on
---

# Client Archive Rules

## Purpose

Preserve a freelancer's project history when a client relationship is no longer active.

## Rules

1. Archive clients using the `archivedAt` timestamp.

2. Archiving a client must not delete the client record.

3. Active-client lists must exclude clients whose `archivedAt` is set.

4. Archived clients must remain recoverable through the restore action.

5. Restoring a client must clear `archivedAt`.

6. An archived client must not be selectable when creating a new project.

7. Existing projects linked to an archived client must remain intact.

8. Archiving a client must not delete, modify, or cascade-delete its linked projects.

9. Archiving a client must not change the status of any linked project.

10. Archiving a client must not make a linked project unavailable for normal project operations.

11. An active project may remain `IN_PROGRESS` even when its client is archived.

12. Do not display a warning that implies active projects are blocked merely because their client was archived.

13. Linked projects must visibly indicate the archived-client relationship using the canonical "Client archived" indicator.

14. The archived-client indicator should be derived from the client's current archival state rather than stored redundantly on every project.

15. Client detail must continue to show all linked projects, including projects associated with an archived client.

16. Do not reinterpret client archiving as project deletion, project archival, or relationship destruction.

17. Do not introduce automatic project status changes as a side effect of client archiving.