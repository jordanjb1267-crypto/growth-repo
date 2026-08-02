/**
 * Claude Code CLI backend.
 *
 * Shells out to `claude -p` (non-interactive). Runs on the founder's existing
 * subscription, so marginal token cost is effectively zero — which is what
 * keeps the system inside the spec's "minimal monthly operating cost" target
 * during Phases 1-3.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractJson, LlmError, type CompletionRequest, type CompletionResponse, type LlmProvider } from './provider.ts';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 4;

function backoffMs(attempt: number): number {
  // 2s, 4s, 8s — matches the retry cadence used elsewhere in the project.
  return 2_000 * 2 ** (attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(message: string): boolean {
  return /\b(?:timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|rate.?limit|429|5\d\d|overloaded)\b/i.test(
    message,
  );
}

export class ClaudeCliProvider implements LlmProvider {
  readonly name = 'claude-cli';
  readonly #binary: string;
  readonly #defaultModel: string;

  constructor(options: { binary?: string; defaultModel?: string } = {}) {
    this.#binary = options.binary ?? 'claude';
    this.#defaultModel = options.defaultModel ?? process.env.LLM_MODEL_GENERATION ?? 'claude-opus-5';
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const { stdout } = await execFileAsync(this.#binary, ['--version'], { timeout: 15_000 });
      return { ok: true, detail: stdout.trim() };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  #render(request: CompletionRequest, attempt: number): string {
    // System prompt first, varying content last. Irrelevant to the CLI backend
    // but keeps the rendered shape identical to what the API backend will send,
    // so prompt-cache behaviour does not change on switchover.
    //
    // The retry instruction is appended AFTER the prompt so the stable prefix
    // stays byte-identical across attempts — a retry must not cost a cache miss
    // on the parts that did not change.
    return [
      request.system,
      '',
      request.json ? 'Respond with a single JSON object and nothing else. No prose, no code fences.' : '',
      '',
      request.prompt,
      attempt > 1 && request.json
        ? '\nYour previous response could not be parsed as JSON. Return exactly one valid JSON object: no prose before or after it, no code fences, no trailing commentary, and no unterminated strings.'
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const model = request.model ?? this.#defaultModel;
    let parseFailures = 0;
    let lastLength = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let text: string;

      // --- Transport ---------------------------------------------------------
      try {
        const { stdout } = await execFileAsync(
          this.#binary,
          ['-p', this.#render(request, attempt), '--model', model],
          { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
        );
        text = stdout.trim();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!isRetryable(message) || attempt === MAX_ATTEMPTS) {
          throw new LlmError(this.name, message, isRetryable(message));
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      // --- JSON contract -----------------------------------------------------
      // `json: true` is a contract, not a hint. A response that does not parse
      // is re-prompted, never returned: callers downstream (generation, the
      // risk classifier) treat unparseable output as a hard failure, and a
      // single bad roll should not cost a product its whole daily set.
      // Exhausting the attempts throws — this never degrades into accepting
      // malformed output.
      if (request.json && extractJson(text) === null) {
        parseFailures += 1;
        lastLength = text.length;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(backoffMs(attempt));
        continue;
      }

      return {
        text,
        // Subscription usage is not itemized per call; reporting a fabricated
        // number here would corrupt any future cost tracking.
        usage: null,
        model,
      };
    }

    throw new LlmError(
      this.name,
      `model returned unparseable JSON on all ${MAX_ATTEMPTS} attempt(s) (${parseFailures} parse failure(s); last response ${lastLength} chars)`,
      false,
    );
  }
}
