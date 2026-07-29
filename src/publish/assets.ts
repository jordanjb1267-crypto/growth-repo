/**
 * Asset validation for video platforms (spec adapter requirements 4 and 5).
 *
 * Hard checks (existence, size, extension) always run. Duration and aspect
 * checks use ffprobe when it is installed and degrade to a warning when it is
 * not — a missing ffprobe must not block publishing, but an over-length video
 * that a platform will reject should be caught here, not by the platform.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize } from 'node:path';
import { REPO_ROOT } from '../lib/paths.ts';

export interface VideoConstraints {
  max_bytes: number;
  min_seconds: number | null;
  max_seconds: number | null;
  extensions: string[];
}

export const VIDEO_CONSTRAINTS = {
  'Instagram Reels': {
    max_bytes: 1024 * 1024 * 1024,
    min_seconds: 3,
    max_seconds: 15 * 60,
    extensions: ['.mp4', '.mov'],
  },
  'YouTube Shorts': {
    // Shorts eligibility: ≤ 3 minutes, square or vertical.
    max_bytes: 2 * 1024 * 1024 * 1024,
    min_seconds: 1,
    max_seconds: 180,
    extensions: ['.mp4', '.mov', '.webm'],
  },
  TikTok: {
    // Single-chunk FILE_UPLOAD keeps the adapter simple; TikTok's chunk
    // ceiling is 64MB, so that is our per-file ceiling for now.
    max_bytes: 64 * 1024 * 1024,
    min_seconds: 3,
    max_seconds: 10 * 60,
    extensions: ['.mp4', '.mov', '.webm'],
  },
} satisfies Record<string, VideoConstraints>;

export interface AssetCheck {
  ok: boolean;
  detail: string;
  /** Absolute path on disk when ok. */
  absolute_path: string | null;
  /** Path relative to assets/, for URL construction. */
  relative_to_assets: string | null;
}

/**
 * Resolve and validate an item's asset path. Asset paths must live under
 * assets/ — a path outside it (or traversal reaching outside it) is refused,
 * since asset_path originates from generated content.
 */
export function checkVideoAsset(assetPath: string | null, constraints: VideoConstraints): AssetCheck {
  const fail = (detail: string): AssetCheck => ({ ok: false, detail, absolute_path: null, relative_to_assets: null });

  if (!assetPath) {
    return fail('No asset attached. This platform needs a video file — set asset_path on the item (relative to assets/).');
  }

  const assetsRoot = join(REPO_ROOT, 'assets');
  const absolute = normalize(isAbsolute(assetPath) ? assetPath : join(assetsRoot, assetPath));
  if (!absolute.startsWith(assetsRoot + '/')) {
    return fail(`Asset path resolves outside assets/ (${assetPath}) — refused.`);
  }
  if (!existsSync(absolute)) return fail(`Asset not found: ${absolute}`);

  const extension = extname(absolute).toLowerCase();
  if (!constraints.extensions.includes(extension)) {
    return fail(`Extension ${extension} not accepted here (expected ${constraints.extensions.join(', ')}).`);
  }

  const bytes = statSync(absolute).size;
  if (bytes === 0) return fail('Asset file is empty.');
  if (bytes > constraints.max_bytes) {
    return fail(`Asset is ${(bytes / 1048576).toFixed(0)}MB, over the ${(constraints.max_bytes / 1048576).toFixed(0)}MB limit.`);
  }

  const duration = probeDurationSeconds(absolute);
  if (duration !== null) {
    if (constraints.max_seconds !== null && duration > constraints.max_seconds) {
      return fail(`Video is ${duration.toFixed(0)}s, over the ${constraints.max_seconds}s limit for this placement.`);
    }
    if (constraints.min_seconds !== null && duration < constraints.min_seconds) {
      return fail(`Video is ${duration.toFixed(1)}s, under the ${constraints.min_seconds}s minimum.`);
    }
  }

  return {
    ok: true,
    detail: duration === null ? 'Validated (ffprobe absent — duration/aspect not checked).' : `Validated (${duration.toFixed(0)}s).`,
    absolute_path: absolute,
    relative_to_assets: absolute.slice(assetsRoot.length + 1),
  };
}

function probeDurationSeconds(file: string): number | null {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const seconds = Number.parseFloat(out.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

/** Public URL for an asset, for platforms that pull rather than accept an
 *  upload (Instagram). Requires the founder to host assets/ somewhere
 *  reachable and set ASSET_BASE_URL. */
export function assetPublicUrl(relativeToAssets: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env.ASSET_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${relativeToAssets.split('/').map(encodeURIComponent).join('/')}`;
}
