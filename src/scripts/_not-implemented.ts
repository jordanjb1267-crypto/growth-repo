/**
 * Shared exit for commands that exist in the spec's command list but belong to
 * a later phase.
 *
 * These fail loudly rather than no-op. A scheduled command that silently does
 * nothing is worse than one that errors — the founder would see a clean cron
 * log and assume the system was running.
 */

export function notImplemented(phase: number, command: string, willDo: string): never {
  console.error(`${command} is not implemented yet — it belongs to Phase ${phase}.`);
  console.error('');
  console.error(`When built, it will: ${willDo}`);
  console.error('');
  console.error('Phase 1 delivers the audit, repo structure, memory files, risk classifier,');
  console.error('approval queue, and local CLI. Nothing publishes yet, by design.');
  process.exit(1);
}
