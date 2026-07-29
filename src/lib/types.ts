/**
 * Core domain types for the Autonomous Organic Growth OS.
 *
 * Built for Node's native TypeScript type stripping, so everything here must be
 * erasable: no enums, no namespaces, no parameter properties. Closed sets are
 * `as const` objects plus a derived union type.
 */

export const PRODUCTS = ['Rig Receipts', 'Tilawah Lock'] as const;
export type Product = (typeof PRODUCTS)[number];

/** Directory slug for a product, used for on-disk paths. */
export const PRODUCT_SLUGS: Record<Product, string> = {
  'Rig Receipts': 'rig-receipts',
  'Tilawah Lock': 'tilawah-lock',
};

export const RISK_LEVELS = ['green', 'yellow', 'red'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Severity ordering. Comparison is always by this rank, never by string, so
 * that "most severe wins" is unambiguous when combining the deterministic rule
 * pass with model-produced scores.
 */
export const RISK_RANK: Record<RiskLevel, number> = {
  green: 0,
  yellow: 1,
  red: 2,
};

export function mostSevere(...levels: RiskLevel[]): RiskLevel {
  let worst: RiskLevel = 'green';
  for (const level of levels) {
    if (RISK_RANK[level] > RISK_RANK[worst]) worst = level;
  }
  return worst;
}

/**
 * Content lifecycle states.
 *
 * The first nine are the spec's state machine verbatim. The last four are the
 * failure edges added in CLAUDE.md addendum A4 — without them a founder edit
 * silently bypasses classification, a failed publish reads as published, a
 * stale approval stays publishable, and a platform warning has no path to
 * pull content down.
 */
export const CONTENT_STATES = [
  'drafted',
  'brand_checked',
  'risk_classified',
  'auto_publish_ready',
  'awaiting_founder_approval',
  'blocked',
  'scheduled',
  'published',
  'analytics_collected',
  'learned_from',
  'memory_updated',
  // Added — see CLAUDE.md addendum A4
  'edited',
  'rejected',
  'publish_failed',
  'expired',
  'retracted',
] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

export const PLATFORMS = [
  'YouTube Shorts',
  'TikTok',
  'Instagram Reels',
  'Facebook Page',
  'LinkedIn',
  'Blog',
  'Email',
  'X',
  'Reddit',
  'Facebook Groups',
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A rule that fired during the deterministic classification pass. */
export interface RuleHit {
  /** Stable identifier, e.g. "RED-RR-BROKER-NAME". Recorded so any past
   *  classification decision can be reconstructed from the log. */
  id: string;
  level: RiskLevel;
  category: string;
  /** Human-readable reason, shown in the approval digest. */
  reason: string;
  /** The matched excerpt, truncated. Never the full content body. */
  evidence: string;
}

export interface RiskScores {
  brand: number;
  platform_safety: number;
  strategic_quality: number;
}

export interface Classification {
  level: RiskLevel;
  /** Every rule that fired, including ones less severe than the final level. */
  rule_hits: RuleHit[];
  scores: RiskScores | null;
  /** Highest Jaccard similarity found against the published corpus. */
  duplicate_similarity: number;
  /** Content ID of the closest published item, when above the report threshold. */
  duplicate_of: string | null;
  /** Set when the item was rendered from a founder-approved template and
   *  every template-integrity condition held. */
  template_exemption: TemplateExemption | null;
  /** Why the final level is what it is, in one sentence, for the digest. */
  rationale: string;
  classified_at: string;
}

export interface TemplateExemption {
  template_id: string;
  template_hash: string;
  approved_by: string;
  approved_at: string;
}

/**
 * Explicit founder-approval record.
 *
 * The state machine already guarantees that Yellow content only reaches
 * `auto_publish_ready` through a founder action, but the publisher re-checks
 * this record at the last moment before a network call — defense in depth,
 * self-contained in the item rather than reconstructed from logs.
 */
export interface FounderApproval {
  by: 'founder';
  at: string;
  note: string | null;
}

/**
 * A content item. Matches the spec's approval-queue JSON shape, with
 * classification detail and state history added.
 */
export interface ContentItem {
  id: string;
  product: Product;
  platform: Platform;
  campaign: string;
  hook: string;
  full_content: string;
  caption: string;
  cta: string;
  asset_path: string | null;
  risk_level: RiskLevel;
  approval_reason: string;
  recommended_action: string;
  status: ContentState;
  created_at: string;
  updated_at: string;

  classification: Classification | null;
  /** Set only when rendered from a template. */
  template_id: string | null;
  /**
   * Slot values the template was rendered with. Stored so the exemption can be
   * RE-DERIVED at classification time by re-rendering and comparing — an
   * exemption is never trusted from a stored record, because the item text or
   * the template could have changed since rendering.
   */
  template_slots: Record<string, string> | null;
  /** Set by founder approval; cleared by any edit. Checked again by the
   *  publisher immediately before sending. */
  approval: FounderApproval | null;
  /** Populated at publish time. Required by acceptance criteria 9 and 10 —
   *  platforms give us no custom field to carry our own content ID, so the
   *  mapping has to live here. */
  platform_post_id: string | null;
  published_at: string | null;
  /** Free-form founder note from reject/block. */
  founder_note: string | null;
}

export interface TransitionRecord {
  content_id: string;
  from: ContentState;
  to: ContentState;
  reason: string;
  actor: 'system' | 'founder';
  at: string;
}
