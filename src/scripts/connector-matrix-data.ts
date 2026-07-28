/**
 * Publishing-connector reference data.
 *
 * The access gates below were verified against current platform documentation
 * rather than inferred from the spec. They matter because the spec treats the
 * five social adapters as one Phase 4 deliverable, and they are not remotely
 * equivalent for a single-operator setup — see CLAUDE.md addendum A1.
 *
 * `status` is the pre-credential assessment. The audit script overrides it to
 * AVAILABLE_MISSING_AUTH or AVAILABLE_AND_CONFIGURED based on which env keys
 * are actually present.
 */

export type ConnectorStatus =
  | 'AVAILABLE_AND_CONFIGURED'
  | 'AVAILABLE_MISSING_AUTH'
  | 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED'
  | 'DRAFT_ONLY_RECOMMENDED'
  | 'NOT_RECOMMENDED'
  | 'BLOCKED';

export interface ConnectorEntry {
  name: string;
  category: 'publisher' | 'analytics' | 'storage' | 'tooling';
  status: ConnectorStatus;
  purpose: string;
  auth_required: boolean;
  env_vars_needed: string[];
  monthly_cost: string;
  official_api_only: boolean;
  risk_level: 'low' | 'medium' | 'high';
  automation_level: string;
  notes: string;
  /** Build order within Phase 4. Lower is earlier. Null = not in Phase 4. */
  phase4_rank: number | null;
}

export const CONNECTORS: ConnectorEntry[] = [
  {
    name: 'LinkedIn Posts API (personal profile)',
    category: 'publisher',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Publish founder-authority posts to the founder\'s own LinkedIn profile',
    auth_required: true,
    env_vars_needed: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_MEMBER_URN'],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'low',
    automation_level: 'approval-gated, then auto-publish for green content',
    notes:
      'The only social channel with no review gate. Uses the self-serve "Share on LinkedIn" product and the w_member_social scope. Build this first — it is the fastest path to a real auto-publish loop.',
    phase4_rank: 1,
  },
  {
    name: 'Meta Graph API — Facebook Page',
    category: 'publisher',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Publish posts to the product Facebook Pages',
    auth_required: true,
    env_vars_needed: ['META_APP_ID', 'META_APP_SECRET', 'META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN'],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'medium',
    automation_level: 'approval-gated, then auto-publish for green content',
    notes:
      'Standard Access covers Pages the app owner administers, so full App Review is not required for our own Pages — the founder must hold a role on the app. Advanced Access plus Business Verification is only needed to touch third-party Pages, and that path runs 2-6 weeks with a rejection expected.',
    phase4_rank: 2,
  },
  {
    name: 'Meta Graph API — Instagram Reels',
    category: 'publisher',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Publish Reels to the product Instagram accounts',
    auth_required: true,
    env_vars_needed: ['META_APP_ID', 'META_APP_SECRET', 'INSTAGRAM_BUSINESS_ACCOUNT_ID', 'META_PAGE_ACCESS_TOKEN'],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'medium',
    automation_level: 'approval-gated, then auto-publish for green content',
    notes:
      'Requires an Instagram BUSINESS account linked to a Facebook Page. Creator accounts cannot publish via the API — check this before anything else, it is the most common blocker. Publishing is a three-step container flow (create with media_type=REELS and a publicly reachable video_url, poll until FINISHED, then publish). Reels-tab eligibility wants 9:16, 5-90 seconds, H.264 or HEVC.',
    phase4_rank: 3,
  },
  {
    name: 'YouTube Data API v3',
    category: 'publisher',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Upload and schedule YouTube Shorts',
    auth_required: true,
    env_vars_needed: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'high',
    automation_level: 'approval-gated; uploads land private until the compliance audit passes',
    notes:
      'API projects created after 2020-07-28 that have not passed a compliance audit can only upload videos as PRIVATE. Uploads succeed and the video is simply invisible, so this fails quietly rather than loudly — do not read a successful upload as a successful publish. Default quota is 10,000 units/day; the per-upload cost has historically been ~1600 units but current sources indicate it may now be ~100. Measure against the real project rather than trusting either number.',
    phase4_rank: 4,
  },
  {
    name: 'TikTok Content Posting API',
    category: 'publisher',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Direct-post short-form video to TikTok',
    auth_required: true,
    env_vars_needed: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN'],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'high',
    automation_level: 'not viable for auto-publish before the audit passes',
    notes:
      'Unaudited API clients are restricted to SELF_ONLY viewership — every post is private and visible to nobody but the creator — and are capped at 5 users posting per 24 hours. Passing TikTok\'s audit is a hard prerequisite for any public posting, so building this adapter before the audit produces a working integration that publishes to an audience of zero. Build last.',
    phase4_rank: 5,
  },
  {
    name: 'LinkedIn Community Management API (Pages)',
    category: 'publisher',
    status: 'NOT_RECOMMENDED',
    purpose: 'Publish to a LinkedIn company Page',
    auth_required: true,
    env_vars_needed: [],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'high',
    automation_level: 'none — out of scope',
    notes:
      'Requires Marketing Developer Platform approval, which is generally reserved for enterprise partners, plus a registered company, a verified Page, a two-tier app review, and super-admin verification from a business email. Not a realistic path for a one-operator setup. Recommend dropping in favour of the personal-profile adapter until circumstances change.',
    phase4_rank: null,
  },
  {
    name: 'Blog / landing page (static deploy)',
    category: 'publisher',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Publish owned long-form content and landing pages',
    auth_required: true,
    env_vars_needed: ['BLOG_DEPLOY_HOOK_URL'],
    monthly_cost: '0 on a static host free tier',
    official_api_only: true,
    risk_level: 'low',
    automation_level: 'auto-publish for green content',
    notes:
      'Owned channel with no platform policy risk and no review gate. Phase 3. This and email are the only channels where autonomy is genuinely unconstrained, which makes them the right place to prove the loop works.',
    phase4_rank: null,
  },
  {
    name: 'Email / waitlist provider',
    category: 'publisher',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Send waitlist and list email',
    auth_required: true,
    env_vars_needed: ['RESEND_API_KEY', 'EMAIL_FROM_ADDRESS'],
    monthly_cost: '0 on a free tier at low volume',
    official_api_only: true,
    risk_level: 'medium',
    automation_level: 'approval-gated — a send cannot be retracted',
    notes:
      'Owned channel, but the only one where a mistake is unrecoverable: a published post can be deleted, a sent email cannot. Keep EMAIL_AUTOSEND_ENABLED off and treat every send as approval-gated regardless of risk level.',
    phase4_rank: null,
  },
  {
    name: 'Reddit',
    category: 'publisher',
    status: 'DRAFT_ONLY_RECOMMENDED',
    purpose: 'Draft community replies for manual posting by the founder',
    auth_required: false,
    env_vars_needed: [],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'high',
    automation_level: 'draft-only — no automated posting, ever',
    notes:
      'The spec makes Reddit draft-only by default and forbids automated community posting. There is no env var that enables posting here, which is a stronger guarantee than a kill switch defaulting to off.',
    phase4_rank: null,
  },
  {
    name: 'Facebook Groups',
    category: 'publisher',
    status: 'DRAFT_ONLY_RECOMMENDED',
    purpose: 'Draft group replies for manual posting by the founder',
    auth_required: false,
    env_vars_needed: [],
    monthly_cost: '0',
    official_api_only: true,
    risk_level: 'high',
    automation_level: 'draft-only — no automated posting, ever',
    notes: 'Draft-only by spec. Same reasoning as Reddit; no automation path exists in this codebase.',
    phase4_rank: null,
  },
  {
    name: 'X (Twitter) API',
    category: 'publisher',
    status: 'NOT_RECOMMENDED',
    purpose: 'Optional short-form text posting',
    auth_required: true,
    env_vars_needed: [],
    monthly_cost: 'free tier is write-capped; paid tiers start around $200/mo',
    official_api_only: true,
    risk_level: 'medium',
    automation_level: 'none — optional and deferred',
    notes:
      'The spec marks X optional. The free tier\'s write cap makes it marginal for a daily cadence, and the paid tier costs an order of magnitude more than the entire rest of the stack. Revisit only if the other channels are saturated.',
    phase4_rank: null,
  },
  {
    name: 'PostHog',
    category: 'analytics',
    status: 'OFFICIAL_API_AVAILABLE_NOT_CONFIGURED',
    purpose: 'Product conversion analytics — installs, activation, trial, paid',
    auth_required: true,
    env_vars_needed: ['POSTHOG_PROJECT_API_KEY', 'POSTHOG_HOST'],
    monthly_cost: '0 on the free tier',
    official_api_only: true,
    risk_level: 'low',
    automation_level: 'read-only',
    notes:
      'An organisation named "RigReceipts" already exists in PostHog, so part of this is further along than the spec assumes. Covers the funnel below the platform metrics: install, onboarding completion, trial start, paid conversion.',
    phase4_rank: null,
  },
];
