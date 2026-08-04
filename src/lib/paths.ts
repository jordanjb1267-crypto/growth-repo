import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Repo root, derived from this file's own location rather than cwd, so the
 * scripts behave the same whether run via npm or invoked directly from
 * another directory (e.g. by cron or launchd).
 */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  audit: resolve(REPO_ROOT, 'audit'),
  brands: resolve(REPO_ROOT, 'brands'),
  campaigns: resolve(REPO_ROOT, 'campaigns'),
  content: resolve(REPO_ROOT, 'content'),
  memory: resolve(REPO_ROOT, 'memory'),
  analytics: resolve(REPO_ROOT, 'analytics'),
  templates: resolve(REPO_ROOT, 'templates'),
  logs: resolve(REPO_ROOT, 'logs'),
  rules: resolve(REPO_ROOT, 'src', 'risk', 'rules'),
} as const;
