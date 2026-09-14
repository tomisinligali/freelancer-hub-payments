---
trigger: always_on
---

# Time Tracking Rules

## Purpose

Provide reliable manual project-time records without introducing timer complexity.

## Scope

1. v1 time tracking is manual-entry only.

2. Do not implement a live timer.

3. Do not implement a stopwatch.

4. Do not implement automatic background time tracking.

5. Do not infer time entries from application activity.

## Time Entry Data

6. Every time entry belongs to exactly one project.

7. Every time entry must belong to the authenticated user's ownership scope.

8. The entry date defaults to today when creating an entry.

9. Duration must be a positive integer number of minutes.

10. A single time entry must not exceed 1440 minutes.

11. Valid duration is therefore 1 through 1440 minutes inclusive.

12. Notes are optional.

## Validation

13. Duration validation must happen server-side in the Server Action before the database write.

14. Client-side form constraints are not sufficient validation.

15. Apply the same server-side duration validation when editing an existing time entry.

16. Reject zero, negative, fractional, non-numeric, or greater-than-1440 minute values.

## Ownership

17. Users may edit and delete only their own time entries.

18. Never trust a client-supplied `userId` when creating or modifying a time entry.

19. Never use `projectId` alone as authorization for a time-entry mutation.

20. Verify that the target project and time entry belong to the authenticated user before mutation.

## Totals

21. Project time totals must be calculated from persisted time-entry minutes.

22. Display project time totals as hours and minutes.

23. Do not convert the authoritative stored duration to floating-point hours for persistence.

24. Do not silently discard or round logged minutes.

## Product Boundary

25. Do not add invoicing, billing calculations, automatic hourly-rate calculations, or payroll functionality to the time-tracking feature unless explicitly approved as a product change.