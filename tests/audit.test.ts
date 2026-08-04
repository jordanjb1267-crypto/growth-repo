import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { readDeclaredKeys, readEnvKeys, secretsReport } from '../src/scripts/audit-connectors.ts';

function envFile(contents: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'audit-')), '.env');
  writeFileSync(file, contents);
  return file;
}

// The shape of the real .env.example: a minority of pre-filled non-secret
// defaults, and the credentials left empty for the founder to insert.
const EXAMPLE = [
  '# Kill switches',
  'AUTOPUBLISH_ENABLED=false',
  'PUBLISH_BACKEND=blotato',
  '',
  '# Credentials — the founder fills these in',
  'BLOTATO_API_KEY=',
  'RESEND_API_KEY=',
  'POSTHOG_PERSONAL_API_KEY=',
].join('\n');

describe('env key parsing', () => {
  it('collects only keys carrying a value as configured', () => {
    const keys = readEnvKeys(envFile(EXAMPLE));
    assert.deepEqual([...keys].sort(), ['AUTOPUBLISH_ENABLED', 'PUBLISH_BACKEND']);
  });

  it('collects every declared key, including the empty ones', () => {
    const keys = readDeclaredKeys(envFile(EXAMPLE));
    assert.deepEqual(
      [...keys].sort(),
      [
        'AUTOPUBLISH_ENABLED',
        'BLOTATO_API_KEY',
        'POSTHOG_PERSONAL_API_KEY',
        'PUBLISH_BACKEND',
        'RESEND_API_KEY',
      ],
    );
  });

  it('ignores comments and blank lines', () => {
    const keys = readDeclaredKeys(envFile('# comment\n\n  \nA=1\n'));
    assert.deepEqual([...keys], ['A']);
  });

  it('returns empty sets for a file that does not exist', () => {
    assert.equal(readDeclaredKeys('/nonexistent/.env').size, 0);
    assert.equal(readEnvKeys('/nonexistent/.env').size, 0);
  });
});

describe('secrets report', () => {
  it('reports unconfigured credentials as a gap rather than omitting them', () => {
    // The regression this guards: a report built only from keys-with-values
    // listed the pre-filled defaults and nothing else, so every row read "yes"
    // the moment the founder ran `cp .env.example .env` — a fully-configured
    // report at the exact moment no credential was set.
    const declared = readDeclaredKeys(envFile(EXAMPLE));
    const configured = readEnvKeys(envFile(EXAMPLE));
    const report = secretsReport(declared, configured);

    assert.equal(report.total, 5);
    assert.equal(report.configured, 2);

    const rowFor = (key: string) => report.rows.find((r) => r[0] === `\`${key}\``);
    assert.deepEqual(rowFor('BLOTATO_API_KEY'), ['`BLOTATO_API_KEY`', 'no']);
    assert.deepEqual(rowFor('RESEND_API_KEY'), ['`RESEND_API_KEY`', 'no']);
    assert.deepEqual(rowFor('AUTOPUBLISH_ENABLED'), ['`AUTOPUBLISH_ENABLED`', 'yes']);
  });

  it('marks a key set in .env but absent from the example as configured', () => {
    const report = secretsReport(new Set(['A']), new Set(['A', 'B']));
    assert.equal(report.total, 2);
    assert.equal(report.configured, 2);
  });

  it('sorts rows so the table is diff-stable across runs', () => {
    const report = secretsReport(new Set(['Z_KEY', 'A_KEY', 'M_KEY']), new Set());
    assert.deepEqual(
      report.rows.map((r) => r[0]),
      ['`A_KEY`', '`M_KEY`', '`Z_KEY`'],
    );
  });
});

describe('import safety', () => {
  it('does not regenerate the audit when the module is imported', () => {
    // The regression this guards: main() was called unconditionally at module
    // scope, so importing this module for its parsers ran a full audit and
    // rewrote all six /audit files with whatever machine happened to be
    // running — silently replacing the founder's laptop output with container
    // data, the exact invalidation CLAUDE.md A7 warns about.
    const auditDir = join(import.meta.dirname, '..', 'audit');
    const moduleUrl = pathToFileURL(
      join(import.meta.dirname, '..', 'src', 'scripts', 'audit-connectors.ts'),
    ).href;

    const snapshot = new Map(
      readdirSync(auditDir).map((f) => [f, readFileSync(join(auditDir, f), 'utf8')] as const),
    );

    try {
      execFileSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`], {
        stdio: 'ignore',
        timeout: 30_000,
      });
    } catch {
      // A broken guard may also hang on the live probes; the file comparison
      // below is the assertion either way.
    }

    const changed: string[] = [];
    for (const [file, before] of snapshot) {
      const after = readFileSync(join(auditDir, file), 'utf8');
      if (after !== before) {
        changed.push(file);
        writeFileSync(join(auditDir, file), before); // restore before failing
      }
    }

    assert.deepEqual(changed, [], 'importing the audit module must not write to /audit');
  });
});

describe('shipped .env.example', () => {
  it('declares every credential the audit must be able to report as missing', () => {
    const declared = readDeclaredKeys(join(import.meta.dirname, '..', '.env.example'));
    for (const key of ['BLOTATO_API_KEY', 'RESEND_API_KEY', 'POSTHOG_PERSONAL_API_KEY', 'ASSET_BASE_URL']) {
      assert.ok(declared.has(key), `${key} should be declared in .env.example`);
    }
  });

  it('leaves a real standup gap visible against a fresh copy of the example', () => {
    const path = join(import.meta.dirname, '..', '.env.example');
    const report = secretsReport(readDeclaredKeys(path), readEnvKeys(path));
    assert.ok(
      report.configured < report.total,
      'a fresh .env copied from the example must not report as fully configured',
    );
  });
});
