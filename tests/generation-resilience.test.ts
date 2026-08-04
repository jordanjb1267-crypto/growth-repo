/**
 * Regression cover for the 2026-08-02 incident: Tilawah Lock generated zero
 * content in a scheduled run, and the pipeline reported success.
 *
 * Two defects, tested separately:
 *   1. `json: true` was advisory — a transient unparseable response was fatal
 *      because nothing re-prompted. (claude-cli JSON contract)
 *   2. Zero valid items exited 0, so a scheduled run logged `done` while a
 *      product had produced nothing. (generate-content fail-closed reporting)
 *
 * The scheduler tests drive the real provider chain through a fake `claude`
 * binary on PATH rather than a stub provider, because the behaviour under test
 * IS the exit code of the real script as the scheduler invokes it.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { after, describe, it } from 'node:test';
import { ClaudeCliProvider } from '../src/llm/claude-cli.ts';
import { generateForProduct } from '../src/content/generate.ts';
import { REPO_ROOT } from '../src/lib/paths.ts';
import { stubProvider } from './helpers.ts';
import type { ContentItem } from '../src/lib/types.ts';

const execFileAsync = promisify(execFile);

const tempDirs: string[] = [];
const createdIds: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  for (const id of createdIds) {
    const file = join(REPO_ROOT, 'content', 'drafts', `${id}.json`);
    if (existsSync(file)) unlinkSync(file);
  }
});

function track(items: ContentItem[]): void {
  createdIds.push(...items.map((i) => i.id));
}

/**
 * A fake `claude` executable that emits `outputs[n]` on its nth invocation
 * (and the last entry thereafter). Returns the binary path and a call counter.
 */
function fakeClaude(outputs: string[]): { binary: string; calls: () => number } {
  const dir = mkdtempSync(join(tmpdir(), 'growth-fake-claude-'));
  tempDirs.push(dir);
  const binary = join(dir, 'claude');
  const counter = join(dir, 'count');
  const payload = join(dir, 'out');

  writeFileSync(payload, JSON.stringify(outputs), 'utf8');
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      `n=$(cat "${counter}" 2>/dev/null || echo 0)`,
      'n=$((n+1))',
      `echo "$n" > "${counter}"`,
      // --version is used by healthCheck/doctor; keep it answerable.
      'case "$1" in --version) echo "0.0.0 (fake)"; exit 0;; esac',
      `node -e 'const o=JSON.parse(require("fs").readFileSync("${payload}","utf8"));const i=Math.min(+process.argv[1]-1,o.length-1);process.stdout.write(o[i]);' "$n"`,
    ].join('\n'),
    'utf8',
  );
  chmodSync(binary, 0o755);

  return {
    binary,
    calls: () => (existsSync(counter) ? Number(readFileSync(counter, 'utf8').trim()) : 0),
  };
}

const VALID_TL = JSON.stringify({
  items: [
    {
      kind: 'video_concept',
      campaign: 'Read Before You Scroll',
      hook: 'The lock screen is the decision point.',
      body: 'Open on the phone face-down. Focus Lock is on. Show the unlock flow in one take.',
      caption: 'One screen between you and the scroll.',
      cta: 'Set your first lock window tonight.',
    },
    {
      kind: 'secondary_post',
      campaign: 'Read Before You Scroll',
      hook: 'A calmer way to think about screen time.',
      body: 'Not a ban. A sequence. The phone opens after, not instead.',
      caption: 'Order, not restriction.',
      cta: 'Try one window this week.',
    },
  ],
  aso_idea: '',
});

describe('claude-cli JSON contract', () => {
  it('re-prompts after an unparseable response instead of failing the call', async () => {
    const fake = fakeClaude(['I am not JSON at all.', '{"items":[],"ok":true}']);
    const provider = new ClaudeCliProvider({ binary: fake.binary });

    const response = await provider.complete({ system: 's', prompt: 'p', json: true });

    assert.match(response.text, /"ok":true/, 'the junk first response must not be returned');
    assert.ok(fake.calls() >= 2, `expected a re-prompt; binary was called ${fake.calls()} time(s)`);
  });

  it('throws rather than returning unparseable text once attempts are exhausted', async () => {
    const fake = fakeClaude(['still not json']);
    const provider = new ClaudeCliProvider({ binary: fake.binary });

    await assert.rejects(
      () => provider.complete({ system: 's', prompt: 'p', json: true }),
      /unparseable JSON on all/,
      'fails closed — never hands malformed text to the caller',
    );
  });

  it('does not re-prompt when JSON was not requested', async () => {
    const fake = fakeClaude(['just prose, no json']);
    const provider = new ClaudeCliProvider({ binary: fake.binary });

    const response = await provider.complete({ system: 's', prompt: 'p' });
    assert.equal(response.text, 'just prose, no json');
    assert.equal(fake.calls(), 1);
  });
});

describe('Tilawah Lock generation', () => {
  it('produces a routed daily set from valid output', async () => {
    const result = await generateForProduct('Tilawah Lock', stubProvider(VALID_TL));
    track(result.created);

    assert.equal(result.created.length, 2);
    const platforms = result.created.map((i) => i.platform);
    assert.ok(platforms.includes('Instagram Reels'), 'video concept routes to Reels');
    assert.ok(platforms.includes('Facebook Page'), 'TL secondary routes to Facebook, not LinkedIn');
    for (const item of result.created) {
      assert.equal(item.product, 'Tilawah Lock');
      assert.equal(item.status, 'drafted');
      assert.equal(item.classification, null, 'generation never classifies');
    }
  });

  it('throws on malformed output and creates nothing', async () => {
    await assert.rejects(() => generateForProduct('Tilawah Lock', stubProvider('```\nnot json\n```')), /unparseable/);
  });

  it('returns zero items — not a throw — when the model returns an empty set', async () => {
    // The silent-success shape: parseable, schema-valid, and empty.
    const result = await generateForProduct('Tilawah Lock', stubProvider('{"items":[],"aso_idea":""}'));
    track(result.created);
    assert.equal(result.created.length, 0);
    assert.equal(result.skipped.length, 0, 'nothing to skip — the model simply produced nothing');
  });

  it('keeps the valid items from a partially malformed set and skips the rest', async () => {
    const partial = JSON.stringify({
      items: [
        {
          kind: 'video_concept',
          campaign: 'Read Before You Scroll',
          hook: 'A usable hook.',
          body: 'A usable body.',
          caption: '',
          cta: '',
        },
        { kind: 'secondary_post', campaign: 'Read Before You Scroll', hook: '', body: '', caption: '', cta: '' },
        { kind: 'not_a_real_kind', campaign: 'x', hook: 'h', body: 'b', caption: '', cta: '' },
      ],
      aso_idea: '',
    });

    const result = await generateForProduct('Tilawah Lock', stubProvider(partial));
    track(result.created);

    assert.equal(result.created.length, 1, 'the one valid item survives');
    assert.equal(result.skipped.length, 2);
    assert.ok(result.skipped.some((s) => s.reason === 'missing hook or body'));
    assert.ok(result.skipped.some((s) => s.reason === 'unknown kind'));
  });
});

describe('scheduled-run visibility', () => {
  /** Run the real generator script the way the scheduler does, against a fake model. */
  async function runGenerator(modelOutput: string): Promise<{ code: number; out: string }> {
    const fake = fakeClaude([modelOutput]);
    const env = { ...process.env, PATH: `${join(fake.binary, '..')}:${process.env.PATH ?? ''}` };
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [join(REPO_ROOT, 'src', 'scripts', 'generate-content.ts')],
        { cwd: REPO_ROOT, env, timeout: 120_000 },
      );
      return { code: 0, out: `${stdout}${stderr}` };
    } catch (error) {
      const e = error as { code?: number; stdout?: string; stderr?: string };
      return { code: typeof e.code === 'number' ? e.code : 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  it('exits non-zero when products generate zero items, so the scheduler logs FAIL', async () => {
    const { code, out } = await runGenerator('{"items":[],"aso_idea":""}');
    assert.notEqual(code, 0, 'a zero-item run must not report success');
    assert.match(out, /produced 0 items/i);
    assert.match(out, /FAILED/i);
  });

  it('exits non-zero when the model output is unparseable', async () => {
    const { code, out } = await runGenerator('not json at all');
    assert.notEqual(code, 0);
    assert.match(out, /FAILED/i);
  });
});
