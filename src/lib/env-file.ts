/**
 * .env writer for the auth bootstrap scripts.
 *
 * Tokens are written straight into .env rather than printed: a token echoed to
 * the terminal lives on in scrollback and shell history, a token written to a
 * mode-600 gitignored file does not. Callers report WHICH keys were written,
 * never the values.
 */

import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './paths.ts';

const ENV_FILE = join(REPO_ROOT, '.env');
const EXAMPLE_FILE = join(REPO_ROOT, '.env.example');

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Insert or update keys in .env, preserving every other line (comments,
 * ordering, unrelated keys). Creates .env from .env.example when missing so a
 * fresh bootstrap still produces a complete file. Returns the key names
 * written.
 */
export function upsertEnv(values: Record<string, string>): string[] {
  const keys = Object.keys(values);
  for (const key of keys) {
    if (!KEY_PATTERN.test(key)) throw new Error(`Refusing to write malformed env key "${key}".`);
    const value = values[key] ?? '';
    if (/[\r\n]/.test(value)) throw new Error(`Refusing to write a value containing a line break for "${key}".`);
  }

  if (!existsSync(ENV_FILE) && existsSync(EXAMPLE_FILE)) {
    copyFileSync(EXAMPLE_FILE, ENV_FILE);
  }

  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const remaining = new Set(keys);

  const updated = lines.map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    const key = match?.[1];
    if (key && remaining.has(key)) {
      remaining.delete(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  if (remaining.size > 0) {
    if (updated.length > 0 && updated[updated.length - 1]?.trim() !== '') updated.push('');
    for (const key of remaining) updated.push(`${key}=${values[key]}`);
    updated.push('');
  }

  writeFileSync(ENV_FILE, updated.join('\n').replace(/\n{3,}$/, '\n'), 'utf8');
  chmodSync(ENV_FILE, 0o600);
  return keys;
}

/** Load .env into process.env without overriding already-set variables.
 *  Used by the scheduler, which runs outside a shell that sourced .env. */
export function loadEnvFile(): void {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined && value.length > 0) process.env[key] = value;
  }
}
