/**
 * Post-classification routing: which state a classified item enters.
 *
 * One rule beyond the obvious level mapping: items targeting a draft-only
 * platform NEVER enter `auto_publish_ready`, whatever their level. The spec
 * makes community channels manual-only — the founder posts by hand or not at
 * all — so a green community reply belongs in the founder's queue as a
 * ready-to-paste draft, not in the auto-publish pool. (The platforms also have
 * no adapter and no kill switch, so this is the second of three fences.)
 */

import { DRAFT_ONLY_PLATFORMS } from '../lib/killswitch.ts';
import type { ContentState, Platform, RiskLevel } from '../lib/types.ts';

export function routeFor(level: RiskLevel, platform: Platform): { to: ContentState; note: string | null } {
  if (level === 'red') return { to: 'blocked', note: null };

  if (DRAFT_ONLY_PLATFORMS.includes(platform)) {
    return {
      to: 'awaiting_founder_approval',
      note: `${platform} is a manual-only channel — this is a draft for the founder to post by hand, never auto-published.`,
    };
  }

  return level === 'green'
    ? { to: 'auto_publish_ready', note: null }
    : { to: 'awaiting_founder_approval', note: null };
}
