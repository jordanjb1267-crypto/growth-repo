/**
 * Genuine media fixtures with known metadata.
 *
 * These are real ffmpeg-encoded files checked into tests/fixtures/media, not
 * filler bytes with a .mp4 extension. That distinction is the whole point: a
 * filler file cannot be parsed by ffprobe, so tests built on one exercise the
 * probe-failure branch while appearing to cover the success path.
 *
 * They are deliberately tiny (solid-colour source, CRF 51, low frame rate) —
 * the largest is the 190s duration case at ~23KB, and the whole set is ~32KB.
 */

import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../src/lib/paths.ts';

export const MEDIA_FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'media');

/** Known metadata, asserted against ffprobe in the media-validation suite so
 *  the fixtures cannot silently drift from what the tests assume. */
export const MEDIA_FIXTURES = {
  validVertical: { file: 'valid-vertical-9x16.mp4', seconds: 5, width: 144, height: 256 },
  shortVertical: { file: 'short-1s-vertical.mp4', seconds: 1, width: 144, height: 256 },
  longVertical: { file: 'long-190s-vertical.mp4', seconds: 190, width: 144, height: 256 },
  landscape: { file: 'landscape-16x9.mp4', seconds: 5, width: 256, height: 144 },
  audioOnly: { file: 'audio-only-no-video.mp4', seconds: 2, width: null, height: null },
  corrupt: { file: 'corrupt.mp4', seconds: null, width: null, height: null },
} as const;

export function fixturePath(name: keyof typeof MEDIA_FIXTURES): string {
  return join(MEDIA_FIXTURE_DIR, MEDIA_FIXTURES[name].file);
}

/**
 * Copy a fixture under assets/ so checkVideoAsset's containment rule is
 * satisfied, and return its assets-relative path. Callers clean up with
 * removeAssetFixture in an `after` hook.
 *
 * assets/**\/*.mp4 is gitignored, so nothing copied here can be committed by
 * accident.
 */
export function installAssetFixture(name: keyof typeof MEDIA_FIXTURES, relativeToAssets: string): string {
  const destination = join(REPO_ROOT, 'assets', relativeToAssets);
  mkdirSync(join(destination, '..'), { recursive: true });
  copyFileSync(fixturePath(name), destination);
  return relativeToAssets;
}

export function removeAssetFixture(relativeToAssets: string): void {
  rmSync(join(REPO_ROOT, 'assets', relativeToAssets), { force: true });
}
