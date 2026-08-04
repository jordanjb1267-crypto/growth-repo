/**
 * Asset validation for video platforms (spec adapter requirements 4 and 5).
 *
 * Every check here is fail-closed. Existence, extension, and size are checked
 * from the filesystem; duration and dimensions come from a single structured
 * ffprobe call. If any of those cannot be established the asset is REFUSED —
 * an unverifiable asset is not a valid one, and a publish that cannot be
 * validated is exactly the publish worth stopping.
 *
 * This is a deliberate change from the earlier behaviour, which treated an
 * unreadable probe as "no opinion" and let the asset through. That collapsed
 * three very different situations — ffprobe not installed, ffprobe rejecting
 * the file, and a file with no video stream — into one silent pass, and
 * reported all of them as "ffprobe absent". A corrupt upload therefore looked
 * identical to a healthy one. `ProbeOutcome` keeps them distinct and each maps
 * to its own refusal message.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize } from 'node:path';
import { REPO_ROOT } from '../lib/paths.ts';

// ---------------------------------------------------------------------------
// Aspect policy
// ---------------------------------------------------------------------------

/**
 * Allowed width/height range for a placement.
 *
 * Bounds are the ratios THIS system intends to publish, not an attempt to
 * restate each platform's full accepted matrix. Every placement that reaches
 * this module is short-form vertical, so every bound below is anchored on
 * 9:16 and the only variation is whether the placement also takes square.
 */
export interface AspectPolicy {
  /** Human-readable statement of intent, used verbatim in refusal messages. */
  description: string;
  /** Narrowest allowed width/height (9:16 = 0.5625). */
  min_ratio: number;
  /** Widest allowed width/height. */
  max_ratio: number;
}

/**
 * Absolute tolerance applied to both ends of a policy range.
 *
 * Sized for encoder dimension rounding only — 1078x1920 measures 0.5615
 * against a 0.5625 target, a difference of 0.001. At 0.01 this admits that
 * class of rounding and nothing else: 4:5 (0.800) and 16:9 (1.778) both stay
 * well outside every range below.
 */
export const ASPECT_TOLERANCE = 0.01;

const NINE_BY_SIXTEEN = 9 / 16; // 0.5625

/** 9:16 only. Both placements are Reels/TikTok-style full-bleed vertical. */
const VERTICAL_ONLY: AspectPolicy = {
  description: '9:16 vertical',
  min_ratio: NINE_BY_SIXTEEN,
  max_ratio: NINE_BY_SIXTEEN,
};

/** Shorts additionally accepts square, per the placement note in the
 *  connector matrix ("Shorts eligibility: ≤ 3 minutes, square or vertical"). */
const VERTICAL_OR_SQUARE: AspectPolicy = {
  description: '9:16 vertical up to 1:1 square',
  min_ratio: NINE_BY_SIXTEEN,
  max_ratio: 1,
};

export interface VideoConstraints {
  max_bytes: number;
  min_seconds: number | null;
  max_seconds: number | null;
  extensions: string[];
  aspect: AspectPolicy;
}

export const VIDEO_CONSTRAINTS = {
  'Instagram Reels': {
    max_bytes: 1024 * 1024 * 1024,
    min_seconds: 3,
    max_seconds: 15 * 60,
    extensions: ['.mp4', '.mov'],
    aspect: VERTICAL_ONLY,
  },
  'YouTube Shorts': {
    // Shorts eligibility: ≤ 3 minutes, square or vertical.
    max_bytes: 2 * 1024 * 1024 * 1024,
    min_seconds: 1,
    max_seconds: 180,
    extensions: ['.mp4', '.mov', '.webm'],
    aspect: VERTICAL_OR_SQUARE,
  },
  TikTok: {
    // Single-chunk FILE_UPLOAD keeps the adapter simple; TikTok's chunk
    // ceiling is 64MB, so that is our per-file ceiling for now.
    max_bytes: 64 * 1024 * 1024,
    min_seconds: 3,
    max_seconds: 10 * 60,
    extensions: ['.mp4', '.mov', '.webm'],
    aspect: VERTICAL_ONLY,
  },
} satisfies Record<string, VideoConstraints>;

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/**
 * The distinguishable results of trying to read media metadata.
 *
 * Every non-valid variant carries its own diagnostic. Callers must not
 * collapse them: "the tool is missing" is an operator problem, "the file is
 * unreadable" is a content problem, and they need different fixes.
 */
export type ProbeOutcome =
  | { kind: 'valid_media'; duration_seconds: number; width: number; height: number }
  | { kind: 'asset_missing'; detail: string }
  | { kind: 'ffprobe_missing'; detail: string }
  | { kind: 'probe_failed'; detail: string }
  | { kind: 'no_video_stream'; detail: string };

/** Injectable for tests: returns ffprobe's stdout or throws as ffprobe would. */
export type ProbeRunner = (file: string) => string;

/** Cap on captured subprocess stderr — enough to identify the failure, not
 *  enough to dump a decoder's full complaint into a log. */
const STDERR_EXCERPT = 200;

/**
 * Reduce ffprobe's stderr to a portable one-line diagnostic.
 *
 * Two things are stripped deliberately. The absolute path appears in every
 * ffprobe error and carries the operator's home directory into any log that
 * records a refusal; the basename identifies the file just as well. The
 * `@ 0x…` allocator address is per-run noise that makes otherwise-identical
 * failures look different.
 */
export function sanitizeProbeError(text: string, absolutePath: string, limit = STDERR_EXCERPT): string {
  const basename = absolutePath.slice(absolutePath.lastIndexOf('/') + 1);
  return text
    .split(absolutePath)
    .join(basename)
    .replace(/\s*@\s*0x[0-9a-f]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

const defaultRunner: ProbeRunner = (file) =>
  execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_entries', 'stream=codec_type,width,height:format=duration',
      file,
    ],
    { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] },
  );

interface FfprobeJson {
  streams?: { codec_type?: string; width?: number; height?: number }[];
  format?: { duration?: string };
}

/**
 * One structured ffprobe call for duration, dimensions, and stream presence.
 *
 * Asked as JSON rather than three scalar queries so a file is opened once and
 * the three facts cannot disagree with each other.
 */
export function probeMedia(absolutePath: string, runner: ProbeRunner = defaultRunner): ProbeOutcome {
  if (!existsSync(absolutePath)) {
    return { kind: 'asset_missing', detail: `No file at ${absolutePath}` };
  }

  let raw: string;
  try {
    raw = runner(absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return { kind: 'ffprobe_missing', detail: 'ffprobe is not installed or not on PATH.' };
    }
    // ffprobe ran and rejected the file: unparseable, truncated, or corrupt.
    const stderr = (error as { stderr?: Buffer | string } | undefined)?.stderr;
    const raw = stderr ? stderr.toString() : String((error as Error)?.message ?? '');
    return {
      kind: 'probe_failed',
      detail: sanitizeProbeError(raw, absolutePath) || 'ffprobe exited non-zero without a message.',
    };
  }

  let parsed: FfprobeJson;
  try {
    parsed = JSON.parse(raw) as FfprobeJson;
  } catch {
    return { kind: 'probe_failed', detail: 'ffprobe returned output that was not valid JSON.' };
  }

  const video = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!video) {
    return {
      kind: 'no_video_stream',
      detail: 'The file contains no video stream (audio-only or non-media container).',
    };
  }
  if (!Number.isFinite(video.width) || !Number.isFinite(video.height) || !video.width || !video.height) {
    return { kind: 'probe_failed', detail: 'ffprobe reported a video stream with no usable dimensions.' };
  }

  const duration = Number.parseFloat(parsed.format?.duration ?? '');
  if (!Number.isFinite(duration)) {
    return { kind: 'probe_failed', detail: 'ffprobe reported no usable duration for this file.' };
  }

  return {
    kind: 'valid_media',
    duration_seconds: duration,
    width: video.width,
    height: video.height,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface AssetCheck {
  ok: boolean;
  detail: string;
  /** Absolute path on disk when ok. */
  absolute_path: string | null;
  /** Path relative to assets/, for URL construction. */
  relative_to_assets: string | null;
  /** Why validation could not be completed, when it could not be. Null on a
   *  clean pass and on failures that never reached the probe. */
  probe_failure: Exclude<ProbeOutcome['kind'], 'valid_media'> | null;
}

function describeRatio(width: number, height: number): string {
  const ratio = width / height;
  const orientation = ratio > 1 ? 'landscape' : ratio < 1 ? 'vertical' : 'square';
  return `${width}x${height} (ratio ${ratio.toFixed(3)}, ${orientation})`;
}

/**
 * Resolve and validate an item's asset path. Asset paths must live under
 * assets/ — a path outside it (or traversal reaching outside it) is refused,
 * since asset_path originates from generated content.
 */
export function checkVideoAsset(
  assetPath: string | null,
  constraints: VideoConstraints,
  options: { probe?: ProbeRunner } = {},
): AssetCheck {
  const fail = (detail: string, probeFailure: AssetCheck['probe_failure'] = null): AssetCheck => ({
    ok: false,
    detail,
    absolute_path: null,
    relative_to_assets: null,
    probe_failure: probeFailure,
  });

  if (!assetPath) {
    return fail('No asset attached. This platform needs a video file — set asset_path on the item (relative to assets/).');
  }

  const assetsRoot = join(REPO_ROOT, 'assets');
  const absolute = normalize(isAbsolute(assetPath) ? assetPath : join(assetsRoot, assetPath));
  if (!absolute.startsWith(assetsRoot + '/')) {
    return fail(`Asset path resolves outside assets/ (${assetPath}) — refused.`);
  }
  if (!existsSync(absolute)) return fail(`Asset not found: ${absolute}`, 'asset_missing');

  const extension = extname(absolute).toLowerCase();
  if (!constraints.extensions.includes(extension)) {
    return fail(`Extension ${extension} not accepted here (expected ${constraints.extensions.join(', ')}).`);
  }

  const bytes = statSync(absolute).size;
  if (bytes === 0) return fail('Asset file is empty.');
  if (bytes > constraints.max_bytes) {
    return fail(`Asset is ${(bytes / 1048576).toFixed(0)}MB, over the ${(constraints.max_bytes / 1048576).toFixed(0)}MB limit.`);
  }

  const probed = probeMedia(absolute, options.probe);
  switch (probed.kind) {
    case 'asset_missing':
      return fail(`Asset not found: ${absolute}`, 'asset_missing');
    case 'ffprobe_missing':
      // Fail closed: without ffprobe no duration or aspect claim can be made,
      // and publishing unverified video is the outcome this gate exists to
      // prevent. This is an operator fix, so name it as one.
      return fail(
        `Cannot validate video: ${probed.detail} Install ffmpeg to enable video publishing — this placement stays blocked until then.`,
        'ffprobe_missing',
      );
    case 'probe_failed':
      return fail(`Asset is not readable as video — likely corrupt or truncated. ffprobe: ${probed.detail}`, 'probe_failed');
    case 'no_video_stream':
      return fail(`Asset has no video stream. ${probed.detail}`, 'no_video_stream');
    case 'valid_media':
      break;
  }

  const { duration_seconds: duration, width, height } = probed;

  if (constraints.max_seconds !== null && duration > constraints.max_seconds) {
    return fail(`Video is ${duration.toFixed(0)}s, over the ${constraints.max_seconds}s limit for this placement.`);
  }
  if (constraints.min_seconds !== null && duration < constraints.min_seconds) {
    return fail(`Video is ${duration.toFixed(1)}s, under the ${constraints.min_seconds}s minimum.`);
  }

  const ratio = width / height;
  const { min_ratio, max_ratio, description } = constraints.aspect;
  if (ratio < min_ratio - ASPECT_TOLERANCE || ratio > max_ratio + ASPECT_TOLERANCE) {
    const expected =
      min_ratio === max_ratio
        ? `${description} (ratio ${min_ratio.toFixed(3)} ±${ASPECT_TOLERANCE})`
        : `${description} (ratio ${min_ratio.toFixed(3)}–${max_ratio.toFixed(3)} ±${ASPECT_TOLERANCE})`;
    return fail(`Video is ${describeRatio(width, height)}; this placement requires ${expected}.`);
  }

  return {
    ok: true,
    detail: `Validated: ${duration.toFixed(0)}s, ${describeRatio(width, height)}.`,
    absolute_path: absolute,
    relative_to_assets: absolute.slice(assetsRoot.length + 1),
    probe_failure: null,
  };
}

/** Public URL for an asset, for platforms that pull rather than accept an
 *  upload (Instagram). Requires the founder to host assets/ somewhere
 *  reachable and set ASSET_BASE_URL. */
export function assetPublicUrl(relativeToAssets: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = env.ASSET_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${relativeToAssets.split('/').map(encodeURIComponent).join('/')}`;
}
