/**
 * LLM provider interface.
 *
 * Every model call in the system goes through this interface so that swapping
 * backends is a config change rather than a refactor. The current backend is
 * `claude-cli`, which shells out to non-interactive Claude Code and therefore
 * runs on the founder's existing subscription at no marginal token cost.
 *
 * `model` and `batch` hints are carried on every request today even though the
 * CLI backend ignores `batch`. They exist now so that the eventual move to the
 * Anthropic API — where the Batch API is a 50% discount and model tiering is
 * the largest cost lever — needs no call-site changes. See CLAUDE.md
 * addendum A8 for the cost model those hints are sized against.
 */

export interface CompletionRequest {
  /** Stable across calls of the same kind. Kept first in the rendered prompt so
   *  it forms a cacheable prefix when the API backend is wired up. */
  system: string;
  /** The varying part of the request. Kept last for the same reason. */
  prompt: string;
  /** Provider-agnostic model hint; the backend maps it to a concrete ID. */
  model?: string;
  maxTokens?: number;
  /** Request JSON output. The CLI backend enforces this by re-prompting on a
   *  parse failure rather than trusting the first response. */
  json?: boolean;
  /** Latency-tolerant work that could be batched by an API backend. Ignored by
   *  the CLI backend. */
  batch?: boolean;
}

export interface CompletionResponse {
  text: string;
  /** Populated only by backends that report it. The CLI backend leaves this
   *  null, which is the honest answer — subscription usage is not itemized. */
  usage: { inputTokens: number; outputTokens: number } | null;
  model: string;
}

export interface LlmProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  /** Whether the backend is usable right now (binary present, key set, etc.). */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

export class LlmError extends Error {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(provider: string, message: string, retryable: boolean) {
    super(`[${provider}] ${message}`);
    this.name = 'LlmError';
    this.provider = provider;
    this.retryable = retryable;
  }
}

/**
 * Extract a JSON object from a model response.
 *
 * Models sometimes wrap JSON in prose or a fenced block even when asked not to.
 * Returns null rather than throwing so callers can decide whether to retry or
 * fail closed — for the risk classifier, failing closed means Yellow, never
 * Green.
 */
export function extractJson<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  const candidates = [fenced?.[1], text].filter((c): c is string => typeof c === 'string');

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Fall back to the outermost brace pair.
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1)) as T;
        } catch {
          // try the next candidate
        }
      }
    }
  }

  return null;
}
