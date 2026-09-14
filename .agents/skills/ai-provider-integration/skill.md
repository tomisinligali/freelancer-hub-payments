
### `.agents/skills/ai-provider-integration/skill.md`

```markdown
---
name: ai-provider-integration
description: Use for DeepSeek, Claude, Anthropic, AI provider, AI adapter, AI service, model configuration, AI prompts, AI output validation, provider switching, or approved AI functionality.
---

# AI Provider Integration

This skill teaches the ordered process for adding approved AI functionality without coupling the product to DeepSeek or Claude. Its laws live in `ai-pipeline.md`, with security requirements in `security.md` and product scope in the PRD and `AGENTS.md`.

## Procedure

1. Confirm that the task is an explicitly approved AI capability.
   - The PRD has no AI feature in v1.
   - Do not add AI functionality merely because a provider is configured.

2. Define the application capability before choosing the provider.
   - Identify the useful input.
   - Identify the expected output.
   - Define what application behavior, if any, may consume that output.

3. Start at the provider-neutral AI boundary.
   - Keep domain logic independent of DeepSeek and Claude.
   - Define the shared application request and response contract first.

4. Implement the provider adapter behind that contract.
   - Put DeepSeek-specific behavior in the DeepSeek adapter.
   - Put Claude-specific behavior in the Claude adapter.
   - Keep SDK calls, model identifiers, authentication, request formats, response parsing, retries, and provider errors inside the adapter.

5. Keep provider selection outside domain logic.
   - Domain code calls the AI service.
   - Domain code does not import a DeepSeek or Claude SDK.
   - Do not spread provider names or model IDs across application features.

6. Execute provider calls only on the server.
   - Load provider credentials from server-side environment configuration.
   - Never place API keys in client bundles.

7. Build the smallest useful prompt.
   - Send only data required for the approved operation.
   - Keep the authenticated user's ownership boundary.
   - Never send another user's records.
   - Never send passwords, authentication tokens, API secrets, or payment credentials.

8. Treat provider input and output as untrusted.
   - Validate the response against the application contract.
   - Reject malformed output.
   - Do not let model output become authorization.

9. Keep AI output non-authoritative.
   - A recommendation remains a recommendation.
   - Require an explicit authorized application flow before persistent state changes.
   - Never let AI directly change projects, statuses, payments, time entries, clients, account state, or security settings.

10. Handle provider failure safely.
    - Treat timeouts, rate limits, unavailable models, and malformed responses as external-service failures.
    - Do not retry indefinitely.
    - Do not silently switch providers unless an approved fallback policy exists.
    - Never corrupt application data because the provider failed.

11. Keep observability safe.
    - Record enough provider and model information to diagnose failures.
    - Do not log secrets.
    - Do not log complete prompts or responses when they contain unnecessary user data.

12. Verify provider interchangeability.
    - Run the same contract tests against DeepSeek and Claude adapters when both are implemented.
    - Confirm that changing providers does not require domain-code changes.

## Key Patterns

```ts
export interface AiProvider {
  generate(input: AiRequest): Promise<AiResponse>
}
// Application code depends on the contract.
export async function runAiTask(
  input: AiRequest,
  provider: AiProvider,
): Promise<AiResponse> {
  const response = await provider.generate(input)

  return validateAiResponse(response)
}
// Provider-specific SDK code stays inside its adapter.
export class DeepSeekProvider implements AiProvider {
  async generate(input: AiRequest): Promise<AiResponse> {
    // DeepSeek SDK/auth/request/response handling lives here.
  }
}
export class ClaudeProvider implements AiProvider {
  async generate(input: AiRequest): Promise<AiResponse> {
    // Claude SDK/auth/request/response handling lives here.
  }
}
src/lib/ai/
├── types.ts
├── service.ts
└── providers/
    ├── deepseek/
    └── claude/