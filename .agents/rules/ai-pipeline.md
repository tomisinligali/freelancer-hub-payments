---
trigger: glob
---

# AI Pipeline Rules

## Purpose

Provide a provider-neutral architecture for future AI integrations while preventing AI from becoming a hidden source of data leakage, unauthorized mutations, or vendor lock-in.

## Product Scope

1. The PRD does not require an AI pipeline as part of v1.

2. Do not introduce AI-powered product functionality merely because an AI provider has been configured.

3. An AI integration must correspond to an explicitly approved product capability before it becomes user-facing functionality.

## Provider Neutrality

4. The application must not couple domain logic directly to DeepSeek or Claude.

5. Define a provider-neutral AI service interface for application code.

6. DeepSeek and Claude must be implemented as interchangeable provider adapters behind that interface.

7. Application business logic must call the provider-neutral interface rather than importing provider-specific SDKs directly.

8. Provider-specific request formats, authentication, model identifiers, response parsing, retries, and error handling must remain inside the corresponding adapter.

9. Do not spread provider names, model IDs, or provider-specific response structures throughout domain logic.

10. Adding or replacing an AI provider must not require rewriting unrelated product features.

11. If Claude is used, Claude must satisfy the same provider contract as DeepSeek.

12. If DeepSeek is used, DeepSeek must satisfy the same provider contract as Claude.

13. Do not introduce a second provider-specific business path merely because providers expose different capabilities. Differences must be isolated inside the provider adapter or capability layer.

## Server-Side Execution

14. AI provider calls must execute server-side.

15. Never expose DeepSeek API keys, Anthropic/Claude credentials, or other AI provider secrets to the browser.

16. Never place AI provider credentials in client-side bundles.

17. AI provider configuration must come from secure server-side environment configuration.

## Data Protection

18. Treat all AI input and output as untrusted data.

19. Do not send user data to an AI provider unless that data is required for the explicitly approved AI operation.

20. Do not send another user's records to an AI provider.

21. AI requests must respect the same authenticated user ownership boundaries as normal application operations.

22. Never use AI as an authorization mechanism.

23. Never allow an AI model to determine whether a user is allowed to access a Client, Project, TimeEntry, or Payment.

24. Do not include passwords, authentication tokens, API secrets, payment credentials, or unrelated sensitive data in AI prompts.

25. Minimize the data included in prompts to the smallest useful context.

## AI Output

26. AI output is never authoritative application state by itself.

27. Validate and constrain AI output before using it in application logic.

28. Never allow AI output to directly execute arbitrary database queries or application commands.

29. Never allow AI output to directly modify projects, clients, time entries, payments, account state, or security settings without an explicitly authorized application flow.

30. AI-generated recommendations must remain recommendations unless the product specification explicitly defines a user-approved action.

31. Never allow AI to automatically change project status.

32. Never allow AI to automatically mark a payment as `PAID`.

33. Never allow AI to automatically create or modify time entries.

## Reliability

34. AI provider failure must fail safely. A provider outage must not corrupt user-owned application data.

35. Do not make core CRUD functionality dependent on successful AI responses unless explicitly approved by product requirements.

36. Provider timeouts, malformed responses, rate limits, and unavailable models must be handled as external-service failures.

37. Do not retry AI requests indefinitely.

38. Do not silently switch providers when a provider fails unless an explicit fallback policy has been implemented and approved.

39. Provider switching must never change the meaning or authorization of an operation.

## Observability

40. Log enough information to diagnose provider failures without logging secrets or unnecessary user data.

41. Do not log complete prompts or AI responses when doing so would expose unnecessary user-owned data.

42. Provider and model identifiers may be recorded for operational diagnostics where appropriate.

43. AI-related failures must be distinguishable from normal application failures.

## Architecture

44. Keep the AI integration boundary separate from domain logic.

45. A recommended structure is:

    `src/lib/ai/`
    - `types.ts`
    - `service.ts`
    - `providers/`
      - `deepseek/`
      - `claude/`

46. Provider adapters must implement the shared AI provider contract.

47. Do not place DeepSeek- or Claude-specific SDK calls inside React components, Server Actions, Prisma code, or domain entities.

48. Do not create provider-specific database fields unless an approved product requirement requires persistent provider metadata.

49. Do not design the system around a single provider's proprietary response format when a provider-neutral representation is sufficient.

## When Unsure

50. Prefer the provider-neutral abstraction.

51. Prefer server-side execution.

52. Prefer the smallest possible user-data payload.

53. Prefer treating AI output as untrusted.

54. Prefer requiring explicit user action before AI-derived changes affect persistent application state.

55. If DeepSeek and Claude behave differently, preserve the common application contract and isolate the difference inside the provider adapter.

56. If an AI feature would expand v1 scope, stop and surface the product decision instead of silently implementing it.