/**
 * Anthropic API backend — NOT WIRED UP.
 *
 * Deliberately a stub. The system runs on `claude-cli` today because that costs
 * nothing beyond the existing subscription. This file exists so the migration
 * path is written down rather than rediscovered later.
 *
 * ---------------------------------------------------------------------------
 * When switching to this backend, the three cost levers, in order of impact:
 *
 * 1. PROMPT CACHING. Brand rules, campaign context, and the memory banks are a
 *    large prefix reused on every call. Put `cache_control: {type:"ephemeral"}`
 *    on the last stable system block. Cache reads bill at ~0.1x, writes at
 *    1.25x (5-min TTL). Without this the monthly cost roughly triples.
 *
 *    Caching is a prefix match, so the prefix must stay byte-identical: no
 *    timestamps, no per-call IDs, no unsorted JSON ahead of the breakpoint.
 *    Verify with `usage.cache_read_input_tokens` — if it is zero across
 *    repeated calls, something in the prefix is varying.
 *
 * 2. BATCH API. 50% discount, results within an hour. `content:generate` and
 *    `risk:classify` both run on a fixed schedule and tolerate an hour of
 *    latency, so both are natural batch candidates. `approval:digest` and
 *    anything the founder is waiting on must stay synchronous.
 *    Honour `CompletionRequest.batch` when implementing.
 *
 * 3. MODEL TIERING. Risk classification is a constrained rubric task and is a
 *    reasonable candidate for a smaller model; keep generation on the larger
 *    one. `CompletionRequest.model` already carries the per-call-site hint.
 *
 * Modeled monthly cost at the spec's daily targets (12 items/day across both
 * products, each also classified, plus daily research and a weekly review):
 * roughly $14-23 on Sonnet 5 with caching and batching, ~$8 on Haiku 4.5,
 * ~$37 on Opus 5. See CLAUDE.md addendum A8.
 * ---------------------------------------------------------------------------
 */

import { LlmError, type CompletionRequest, type CompletionResponse, type LlmProvider } from './provider.ts';

export class AnthropicApiProvider implements LlmProvider {
  readonly name = 'anthropic-api';

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    const hasKey = typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0;
    return {
      ok: false,
      detail: hasKey
        ? 'ANTHROPIC_API_KEY is present, but this backend is not implemented yet. Set LLM_PROVIDER=claude-cli.'
        : 'Not implemented, and ANTHROPIC_API_KEY is not set. Set LLM_PROVIDER=claude-cli.',
    };
  }

  async complete(_request: CompletionRequest): Promise<CompletionResponse> {
    throw new LlmError(
      this.name,
      'The Anthropic API backend is not implemented. Set LLM_PROVIDER=claude-cli, or implement this backend following the cost guidance at the top of src/llm/anthropic-api.ts.',
      false,
    );
  }
}
