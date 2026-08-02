import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { after, describe, it } from 'node:test';
import {
  ASPECT_TOLERANCE,
  checkVideoAsset,
  probeMedia,
  sanitizeProbeError,
  VIDEO_CONSTRAINTS,
} from '../src/publish/assets.ts';
import type { ProbeRunner } from '../src/publish/assets.ts';
import { fixturePath, installAssetFixture, MEDIA_FIXTURES, removeAssetFixture } from './media-fixtures.ts';

const PLATFORMS = ['Instagram Reels', 'YouTube Shorts', 'TikTok'] as const;

/** Install every fixture under assets/ once; each test addresses them by
 *  their assets-relative path, which is what the containment rule requires. */
const INSTALLED = Object.fromEntries(
  (Object.keys(MEDIA_FIXTURES) as (keyof typeof MEDIA_FIXTURES)[]).map((name) => [
    name,
    installAssetFixture(name, `rig-receipts/videos/mv-${MEDIA_FIXTURES[name].file}`),
  ]),
) as Record<keyof typeof MEDIA_FIXTURES, string>;

after(() => {
  for (const relative of Object.values(INSTALLED)) removeAssetFixture(relative);
});

/** ffprobe not on PATH — what execFileSync throws when the binary is absent. */
const ffprobeMissing: ProbeRunner = () => {
  const error = new Error('spawnSync ffprobe ENOENT') as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  throw error;
};

describe('fixture ground truth', () => {
  it('matches the metadata the suite assumes', () => {
    // Guards against a fixture being regenerated with different properties,
    // which would otherwise make these tests assert the wrong thing quietly.
    for (const [name, meta] of Object.entries(MEDIA_FIXTURES)) {
      if (meta.seconds === null) continue;
      const out = execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', fixturePath(name as keyof typeof MEDIA_FIXTURES)],
        { encoding: 'utf8' },
      );
      assert.equal(Math.round(Number.parseFloat(out.trim())), meta.seconds, `${name} duration`);
    }
  });
});

describe('probe outcomes are distinguishable', () => {
  it('valid media reports duration and dimensions', () => {
    const outcome = probeMedia(fixturePath('validVertical'));
    assert.equal(outcome.kind, 'valid_media');
    if (outcome.kind !== 'valid_media') return;
    assert.equal(Math.round(outcome.duration_seconds), 5);
    assert.equal(outcome.width, 144);
    assert.equal(outcome.height, 256);
  });

  it('a missing file is asset_missing, not a probe failure', () => {
    const outcome = probeMedia(fixturePath('validVertical').replace('valid-vertical', 'does-not-exist'));
    assert.equal(outcome.kind, 'asset_missing');
  });

  it('corrupt media is probe_failed, never ffprobe_missing', () => {
    const outcome = probeMedia(fixturePath('corrupt'));
    assert.equal(outcome.kind, 'probe_failed');
    if (outcome.kind !== 'probe_failed') return;
    assert.ok(outcome.detail.length > 0, 'carries a diagnostic');
    assert.ok(outcome.detail.length <= 200, 'diagnostic is truncated, not a stderr dump');
    assert.doesNotMatch(outcome.detail, /not installed|ENOENT/i);
    assert.match(outcome.detail, /moov atom not found|Invalid data/, 'keeps the useful cause');
  });

  it('keeps the absolute path and allocator address out of the diagnostic', () => {
    // ffprobe prints the full path on every error; recording it would carry the
    // operator's home directory into any log line about a refused asset.
    const outcome = probeMedia(fixturePath('corrupt'));
    assert.equal(outcome.kind, 'probe_failed');
    if (outcome.kind !== 'probe_failed') return;
    assert.doesNotMatch(outcome.detail, /\//, 'no path separators survive');
    assert.doesNotMatch(outcome.detail, /0x[0-9a-f]+/i, 'no allocator address');
    assert.match(outcome.detail, /corrupt\.mp4/, 'the basename still identifies the file');
  });

  it('sanitizes paths and addresses in isolation', () => {
    const cleaned = sanitizeProbeError(
      '[mov,mp4 @ 0x7fc207705e40] moov atom not found\n/home/someone/assets/clip.mp4: Invalid data',
      '/home/someone/assets/clip.mp4',
    );
    assert.equal(cleaned, '[mov,mp4] moov atom not found clip.mp4: Invalid data');
  });

  it('audio-only media is no_video_stream', () => {
    const outcome = probeMedia(fixturePath('audioOnly'));
    assert.equal(outcome.kind, 'no_video_stream');
  });

  it('an absent ffprobe is ffprobe_missing and says so', () => {
    const outcome = probeMedia(fixturePath('validVertical'), ffprobeMissing);
    assert.equal(outcome.kind, 'ffprobe_missing');
    if (outcome.kind !== 'ffprobe_missing') return;
    assert.match(outcome.detail, /ffprobe is not installed/);
  });

  it('distinguishes missing-tool from unreadable-file', () => {
    // The regression this guards: both used to collapse to null and surface
    // as "ffprobe absent", so a corrupt upload was indistinguishable from a
    // healthy one on a machine without ffmpeg.
    const missing = probeMedia(fixturePath('validVertical'), ffprobeMissing);
    const corrupt = probeMedia(fixturePath('corrupt'));
    assert.notEqual(missing.kind, corrupt.kind);
  });
});

describe('validation fails closed', () => {
  it('refuses corrupt media as corrupt, not as unvalidated', () => {
    const check = checkVideoAsset(INSTALLED.corrupt, VIDEO_CONSTRAINTS.TikTok);
    assert.equal(check.ok, false);
    assert.equal(check.probe_failure, 'probe_failed');
    assert.match(check.detail, /corrupt or truncated/);
  });

  it('refuses a file with no video stream', () => {
    const check = checkVideoAsset(INSTALLED.audioOnly, VIDEO_CONSTRAINTS.TikTok);
    assert.equal(check.ok, false);
    assert.equal(check.probe_failure, 'no_video_stream');
    assert.match(check.detail, /no video stream/);
  });

  it('refuses a missing asset', () => {
    const check = checkVideoAsset('rig-receipts/videos/nope.mp4', VIDEO_CONSTRAINTS.TikTok);
    assert.equal(check.ok, false);
    assert.equal(check.probe_failure, 'asset_missing');
  });

  it('refuses to publish when ffprobe is absent, naming the dependency', () => {
    const check = checkVideoAsset(INSTALLED.validVertical, VIDEO_CONSTRAINTS.TikTok, { probe: ffprobeMissing });
    assert.equal(check.ok, false, 'valid media must still refuse without a probe');
    assert.equal(check.probe_failure, 'ffprobe_missing');
    assert.match(check.detail, /install ffmpeg/i);
    assert.doesNotMatch(check.detail, /corrupt/i);
  });

  it('gives different diagnostics for missing ffprobe and invalid media', () => {
    const noProbe = checkVideoAsset(INSTALLED.validVertical, VIDEO_CONSTRAINTS.TikTok, { probe: ffprobeMissing });
    const badFile = checkVideoAsset(INSTALLED.corrupt, VIDEO_CONSTRAINTS.TikTok);
    assert.notEqual(noProbe.probe_failure, badFile.probe_failure);
    assert.notEqual(noProbe.detail, badFile.detail);
  });
});

describe('aspect policy', () => {
  it('rejects landscape 16:9 on every vertical placement, with measurements', () => {
    for (const platform of PLATFORMS) {
      const check = checkVideoAsset(INSTALLED.landscape, VIDEO_CONSTRAINTS[platform]);
      assert.equal(check.ok, false, `${platform} must reject landscape`);
      assert.match(check.detail, /256x144/, `${platform} reports measured dimensions`);
      assert.match(check.detail, /1\.778/, `${platform} reports measured ratio`);
      assert.match(check.detail, /landscape/, `${platform} names the orientation`);
      assert.match(check.detail, /requires/, `${platform} states the expected policy`);
    }
  });

  it('accepts 9:16 on every vertical placement', () => {
    for (const platform of PLATFORMS) {
      const check = checkVideoAsset(INSTALLED.validVertical, VIDEO_CONSTRAINTS[platform]);
      assert.ok(check.ok, `${platform}: ${check.detail}`);
      assert.match(check.detail, /144x256/);
    }
  });

  it('admits encoder rounding within tolerance but not a different ratio', () => {
    const { min_ratio, max_ratio } = VIDEO_CONSTRAINTS.TikTok.aspect;
    // 1078x1920 — a real-world rounded 9:16 encode.
    assert.ok(1078 / 1920 >= min_ratio - ASPECT_TOLERANCE, 'rounded 9:16 stays inside tolerance');
    // 4:5 and 16:9 must both remain outside.
    assert.ok(0.8 > max_ratio + ASPECT_TOLERANCE, '4:5 is outside the vertical-only range');
    assert.ok(16 / 9 > max_ratio + ASPECT_TOLERANCE, '16:9 is outside');
  });

  it('lets Shorts take square while Reels and TikTok do not', () => {
    // Encodes the one documented per-placement difference, so a future edit to
    // the policy table has to be deliberate.
    assert.equal(VIDEO_CONSTRAINTS['YouTube Shorts'].aspect.max_ratio, 1);
    assert.equal(VIDEO_CONSTRAINTS['Instagram Reels'].aspect.max_ratio, 9 / 16);
    assert.equal(VIDEO_CONSTRAINTS.TikTok.aspect.max_ratio, 9 / 16);
  });
});

describe('duration limits stay platform-specific', () => {
  it('a 1s clip clears Shorts but not Reels or TikTok', () => {
    assert.ok(checkVideoAsset(INSTALLED.shortVertical, VIDEO_CONSTRAINTS['YouTube Shorts']).ok);

    for (const platform of ['Instagram Reels', 'TikTok'] as const) {
      const check = checkVideoAsset(INSTALLED.shortVertical, VIDEO_CONSTRAINTS[platform]);
      assert.equal(check.ok, false);
      assert.match(check.detail, /under the 3s minimum/);
    }
  });

  it('a 190s clip clears Reels and TikTok but not Shorts', () => {
    for (const platform of ['Instagram Reels', 'TikTok'] as const) {
      assert.ok(checkVideoAsset(INSTALLED.longVertical, VIDEO_CONSTRAINTS[platform]).ok);
    }

    const shorts = checkVideoAsset(INSTALLED.longVertical, VIDEO_CONSTRAINTS['YouTube Shorts']);
    assert.equal(shorts.ok, false);
    assert.match(shorts.detail, /over the 180s limit/);
  });
});

describe('success reporting', () => {
  it('states measured duration and dimensions rather than claiming unchecked', () => {
    const check = checkVideoAsset(INSTALLED.validVertical, VIDEO_CONSTRAINTS.TikTok);
    assert.ok(check.ok);
    assert.match(check.detail, /^Validated: 5s, 144x256 \(ratio 0\.563, vertical\)\.$/);
    assert.doesNotMatch(check.detail, /not checked|absent/);
  });
});
