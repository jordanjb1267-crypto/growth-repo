/**
 * Kill switches — fail closed, always.
 *
 * Only the exact string "true" enables publishing. Everything else — unset,
 * empty, "TRUE", "1", "yes", a typo, a deleted line — reads as disabled. The
 * asymmetry is deliberate: a switch that fails open turns a config mistake into
 * an unreviewed post on a real audience, while one that fails closed turns the
 * same mistake into a message in the terminal.
 *
 * These checks belong in the publisher adapter, at the last moment before the
 * network call — not in the calling script, where a new code path could route
 * around them.
 */

import type { Platform } from './types.ts';

export const GLOBAL_SWITCH = 'AUTOPUBLISH_ENABLED';

const PLATFORM_SWITCHES: Record<Platform, string> = {
  'YouTube Shorts': 'YOUTUBE_AUTOPUBLISH_ENABLED',
  TikTok: 'TIKTOK_AUTOPUBLISH_ENABLED',
  'Instagram Reels': 'INSTAGRAM_AUTOPUBLISH_ENABLED',
  'Facebook Page': 'FACEBOOK_AUTOPUBLISH_ENABLED',
  LinkedIn: 'LINKEDIN_AUTOPUBLISH_ENABLED',
  Blog: 'BLOG_AUTOPUBLISH_ENABLED',
  Email: 'EMAIL_AUTOSEND_ENABLED',
  // Draft-only channels have no switch. There is no env var that turns these
  // on, which is stronger than a switch defaulting to off.
  X: '__NO_SWITCH__',
  Reddit: '__NO_SWITCH__',
  'Facebook Groups': '__NO_SWITCH__',
};

/** Channels that are draft-only by spec and have no auto-publish path at all. */
export const DRAFT_ONLY_PLATFORMS: readonly Platform[] = ['Reddit', 'Facebook Groups', 'X'];

function isEnabled(name: string, env: NodeJS.ProcessEnv): boolean {
  return env[name] === 'true';
}

export interface SwitchCheck {
  allowed: boolean;
  reason: string;
}

/**
 * Both the global switch and the platform switch must be exactly "true".
 * Draft-only platforms are refused unconditionally.
 */
export function checkPublishAllowed(platform: Platform, env: NodeJS.ProcessEnv = process.env): SwitchCheck {
  if (DRAFT_ONLY_PLATFORMS.includes(platform)) {
    return {
      allowed: false,
      reason: `${platform} is draft-only. The founder posts manually; there is no auto-publish path and no env var that creates one.`,
    };
  }

  if (!isEnabled(GLOBAL_SWITCH, env)) {
    return { allowed: false, reason: `${GLOBAL_SWITCH} is not exactly "true". Publishing is disabled globally.` };
  }

  const platformSwitch = PLATFORM_SWITCHES[platform];
  if (!isEnabled(platformSwitch, env)) {
    return { allowed: false, reason: `${platformSwitch} is not exactly "true". Publishing to ${platform} is disabled.` };
  }

  return { allowed: true, reason: `${GLOBAL_SWITCH} and ${platformSwitch} are both enabled.` };
}

export function platformSwitchName(platform: Platform): string {
  return PLATFORM_SWITCHES[platform];
}
