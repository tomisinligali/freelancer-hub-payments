---
trigger: always_on
---

# Git Conventions

## Purpose

Keep changes traceable, reviewable, and safe to merge.

## Rules

1. Keep each commit focused on one coherent change.

2. Do not combine unrelated features, refactors, formatting changes, or dependency changes in the same commit unless they are required for the same task.

3. Commit messages must describe the actual change, not the intended future work.

4. Do not commit secrets, API keys, credentials, `.env` files containing secrets, or generated private configuration.

5. Do not commit temporary debugging code, console output used only for investigation, or abandoned experimental implementations.

6. Do not bypass linting, type checking, tests, or required CI checks merely to produce a passing commit.

7. Do not rewrite shared history unless explicitly instructed.

8. Do not force-push to a shared branch unless explicitly authorized.

9. Do not modify unrelated files merely to satisfy formatting or personal preferences.

10. When a task changes behavior covered by tests, update or add the relevant tests in the same change.

11. When a task changes a database schema, include the required Prisma migration with the code change.

12. When a task changes security-sensitive behavior, include the relevant regression or isolation tests before considering the change complete.

13. Before declaring a task complete, verify the working tree and ensure no unintended files were changed.

14. Never use Git operations to hide an incomplete implementation from review.