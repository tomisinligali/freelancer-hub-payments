---
trigger: always_on
---

# Coding Standards

## Purpose

Keep the codebase predictable, maintainable, and safe for both human developers and AI coding agents.

## Rules

1. Use TypeScript in strict mode. Do not weaken strictness to make an implementation compile.

2. Keep business rules explicit and centralized. Do not duplicate the same business rule across multiple Server Actions, components, or utility functions.

3. Keep UI components responsible for presentation and interaction. Business-critical validation and authorization must not depend on client-side UI behavior.

4. Validate all user-controlled input at the server boundary before performing a mutation.

5. Prefer small, composable functions over large functions that combine authorization, validation, persistence, and presentation logic.

6. Do not introduce abstractions solely for theoretical reuse. Add an abstraction when it prevents duplication or enforces an important architectural boundary.

7. Do not bypass the established application layers to make a feature work faster.

8. Use explicit domain names consistent with the PRD and database schema. Do not introduce alternative terminology for established concepts such as Client, Project, TimeEntry, Payment, PENDING, PAID, or ProjectStatus.

9. Do not hide business-critical behavior in generic helpers where an AI agent or reviewer cannot easily determine what the operation does.

10. Preserve existing behavior unless the requested change explicitly requires changing it.

11. Do not silently expand product scope while implementing a feature. If implementation requires a new product decision, stop and surface the decision.

12. Prefer readable code over clever code. Code must be understandable by another engineer without reverse-engineering unnecessary abstractions.

13. Do not suppress TypeScript, lint, test, or compiler errors merely to complete a task.

14. Do not place secrets, credentials, provider keys, or private configuration values in source code.

15. When modifying an existing feature, inspect its current implementation and preserve its established architectural boundaries before introducing new code.