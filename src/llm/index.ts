import { AnthropicApiProvider } from './anthropic-api.ts';
import { ClaudeCliProvider } from './claude-cli.ts';
import type { LlmProvider } from './provider.ts';

/**
 * Resolve the configured backend.
 *
 * Defaults to the CLI backend: an unset LLM_PROVIDER should land on the free,
 * working path rather than the unimplemented metered one.
 */
export function getProvider(name = process.env.LLM_PROVIDER ?? 'claude-cli'): LlmProvider {
  switch (name) {
    case 'anthropic-api':
      return new AnthropicApiProvider();
    case 'claude-cli':
      return new ClaudeCliProvider();
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}". Expected "claude-cli" or "anthropic-api".`);
  }
}

export type { CompletionRequest, CompletionResponse, LlmProvider } from './provider.ts';
export { extractJson, LlmError } from './provider.ts';
