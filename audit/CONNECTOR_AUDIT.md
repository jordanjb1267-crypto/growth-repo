# Connector Audit

Generated: 2026-08-02T18:27:55.448Z

> **This audit describes the machine it was generated on.**
> Regenerate it on the founder's laptop before trusting it. An audit produced
> in a cloud container will report ffmpeg, sqlite3, gh, and cron as absent when
> they may be installed locally. See CLAUDE.md addendum A7.

## Headline

The spec treats the five social adapters as a single Phase 4 deliverable. They are not equivalent.
Their access gates differ enough to change the build order, and the ordering is not intuitive —
the two channels most people would build first (YouTube, TikTok) are the two that cannot publish
publicly without passing a platform audit.

## Recommended Phase 4 order

| # | Connector | Gate | Status |
|---|---|---|---|
| 0 | Blotato (social publishing backend) | app config | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED |
| 1 | LinkedIn Posts API (personal profile) | none | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED |
| 2 | Meta Graph API — Facebook Page | app config | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED |
| 3 | Meta Graph API — Instagram Reels | app config | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED |
| 4 | YouTube Data API v3 | platform audit | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED |
| 5 | TikTok Content Posting API | platform audit | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED |

## Full matrix

| Connector | Category | Status | Risk | Automation |
|---|---|---|---|---|
| Blotato (social publishing backend) | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | medium | approval-gated, then auto-publish for green content — same gate as every backend |
| LinkedIn Posts API (personal profile) | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | low | approval-gated, then auto-publish for green content |
| Meta Graph API — Facebook Page | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | medium | approval-gated, then auto-publish for green content |
| Meta Graph API — Instagram Reels | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | medium | approval-gated, then auto-publish for green content |
| YouTube Data API v3 | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | high | approval-gated; uploads land private until the compliance audit passes |
| TikTok Content Posting API | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | high | not viable for auto-publish before the audit passes |
| LinkedIn Community Management API (Pages) | publisher | NOT_RECOMMENDED | high | none — out of scope |
| Blog / landing page (static deploy) | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | low | auto-publish for green content |
| Email / waitlist provider | publisher | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | medium | approval-gated — a send cannot be retracted |
| Reddit | publisher | DRAFT_ONLY_RECOMMENDED | high | draft-only — no automated posting, ever |
| Facebook Groups | publisher | DRAFT_ONLY_RECOMMENDED | high | draft-only — no automated posting, ever |
| X (Twitter) API | publisher | NOT_RECOMMENDED | medium | none — optional and deferred |
| PostHog | analytics | AVAILABLE_MISSING_AUTH | low | read-only |

## Per-connector detail

### Blotato (social publishing backend)

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Default delivery backend for all five social channels (founder directive, CLAUDE.md A9)
- **Env vars:** `BLOTATO_API_KEY`, `BLOTATO_LINKEDIN_ACCOUNT_ID`, `BLOTATO_FACEBOOK_ACCOUNT_ID`, `BLOTATO_FACEBOOK_PAGE_ID`, `BLOTATO_INSTAGRAM_ACCOUNT_ID`, `BLOTATO_YOUTUBE_ACCOUNT_ID`, `BLOTATO_TIKTOK_ACCOUNT_ID`
- **Monthly cost:** paid subscription (no free tier) — the justified paid upgrade the spec allows
- **Risk:** medium
- **Automation:** approval-gated, then auto-publish for green content — same gate as every backend

Accounts connect once in the Blotato dashboard (user-authorized OAuth against each platform's official API); posting then needs only BLOTATO_API_KEY plus per-platform account IDs (npm run blotato:accounts). Replaces the per-platform audit gauntlet: via Blotato's audited apps, YouTube uploads can be public and TikTok posts PUBLIC_TO_EVERYONE from day one. Media is ingested by URL, so ASSET_BASE_URL is required for video. Post creation returns a Blotato submission ID (stored as blotato:<id>); the dashboard maps it to the live post. Single-credential concentration risk: one leaked key reaches every connected account — the kill switches and the mode-600 .env matter more, not less. The same workspace powers the Blotato MCP connector for conversational control from Claude. Draft-only channels are never wired through it.

### LinkedIn Posts API (personal profile)

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Publish founder-authority posts to the founder's own LinkedIn profile
- **Env vars:** `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_MEMBER_URN`
- **Monthly cost:** 0
- **Risk:** low
- **Automation:** approval-gated, then auto-publish for green content

Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path. The only social channel with no review gate. Uses the self-serve "Share on LinkedIn" product and the w_member_social scope.

### Meta Graph API — Facebook Page

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Publish posts to the product Facebook Pages
- **Env vars:** `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`
- **Monthly cost:** 0
- **Risk:** medium
- **Automation:** approval-gated, then auto-publish for green content

Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path. Standard Access covers Pages the app owner administers, so full App Review is not required for our own Pages — the founder must hold a role on the app. Advanced Access plus Business Verification is only needed to touch third-party Pages, and that path runs 2-6 weeks with a rejection expected.

### Meta Graph API — Instagram Reels

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Publish Reels to the product Instagram accounts
- **Env vars:** `META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `META_PAGE_ACCESS_TOKEN`
- **Monthly cost:** 0
- **Risk:** medium
- **Automation:** approval-gated, then auto-publish for green content

Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path. Requires an Instagram BUSINESS account linked to a Facebook Page. Creator accounts cannot publish via the API — check this before anything else, it is the most common blocker. Publishing is a three-step container flow (create with media_type=REELS and a publicly reachable video_url, poll until FINISHED, then publish). Reels-tab eligibility wants 9:16, 5-90 seconds, H.264 or HEVC.

### YouTube Data API v3

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Upload and schedule YouTube Shorts
- **Env vars:** `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`
- **Monthly cost:** 0
- **Risk:** high
- **Automation:** approval-gated; uploads land private until the compliance audit passes

Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path, and via Blotato's audited app public uploads work from day one. Direct-path reality: API projects created after 2020-07-28 that have not passed a compliance audit can only upload videos as PRIVATE. Uploads succeed and the video is simply invisible, so this fails quietly rather than loudly — do not read a successful upload as a successful publish. Default quota is 10,000 units/day; the per-upload cost has historically been ~1600 units but current sources indicate it may now be ~100. Measure against the real project rather than trusting either number.

### TikTok Content Posting API

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Direct-post short-form video to TikTok
- **Env vars:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN`
- **Monthly cost:** 0
- **Risk:** high
- **Automation:** not viable for auto-publish before the audit passes

Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path, and via Blotato public posting works from day one. Direct-path reality: unaudited API clients are restricted to SELF_ONLY viewership — every post is private and visible to nobody but the creator — and are capped at 5 users posting per 24 hours.

### LinkedIn Community Management API (Pages)

- **Status:** NOT_RECOMMENDED
- **Purpose:** Publish to a LinkedIn company Page
- **Env vars:** none
- **Monthly cost:** 0
- **Risk:** high
- **Automation:** none — out of scope

Requires Marketing Developer Platform approval, which is generally reserved for enterprise partners, plus a registered company, a verified Page, a two-tier app review, and super-admin verification from a business email. Not a realistic path for a one-operator setup. Recommend dropping in favour of the personal-profile adapter until circumstances change.

### Blog / landing page (static deploy)

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Publish owned long-form content and landing pages
- **Env vars:** `BLOG_DEPLOY_HOOK_URL`
- **Monthly cost:** 0 on a static host free tier
- **Risk:** low
- **Automation:** auto-publish for green content

Owned channel with no platform policy risk and no review gate. Phase 3. This and email are the only channels where autonomy is genuinely unconstrained, which makes them the right place to prove the loop works.

### Email / waitlist provider

- **Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED
- **Purpose:** Send waitlist and list email
- **Env vars:** `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`
- **Monthly cost:** 0 on a free tier at low volume
- **Risk:** medium
- **Automation:** approval-gated — a send cannot be retracted

Owned channel, but the only one where a mistake is unrecoverable: a published post can be deleted, a sent email cannot. Keep EMAIL_AUTOSEND_ENABLED off and treat every send as approval-gated regardless of risk level.

### Reddit

- **Status:** DRAFT_ONLY_RECOMMENDED
- **Purpose:** Draft community replies for manual posting by the founder
- **Env vars:** none
- **Monthly cost:** 0
- **Risk:** high
- **Automation:** draft-only — no automated posting, ever

The spec makes Reddit draft-only by default and forbids automated community posting. There is no env var that enables posting here, which is a stronger guarantee than a kill switch defaulting to off.

### Facebook Groups

- **Status:** DRAFT_ONLY_RECOMMENDED
- **Purpose:** Draft group replies for manual posting by the founder
- **Env vars:** none
- **Monthly cost:** 0
- **Risk:** high
- **Automation:** draft-only — no automated posting, ever

Draft-only by spec. Same reasoning as Reddit; no automation path exists in this codebase.

### X (Twitter) API

- **Status:** NOT_RECOMMENDED
- **Purpose:** Optional short-form text posting
- **Env vars:** none
- **Monthly cost:** free tier is write-capped; paid tiers start around $200/mo
- **Risk:** medium
- **Automation:** none — optional and deferred

The spec marks X optional. The free tier's write cap makes it marginal for a daily cadence, and the paid tier costs an order of magnitude more than the entire rest of the stack. Revisit only if the other channels are saturated.

### PostHog

- **Status:** AVAILABLE_MISSING_AUTH
- **Purpose:** Product conversion analytics — installs, activation, trial, paid
- **Env vars:** `POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST`
- **Monthly cost:** 0 on the free tier
- **Risk:** low
- **Automation:** read-only

An organisation named "RigReceipts" already exists in PostHog, so part of this is further along than the spec assumes. Covers the funnel below the platform metrics: install, onboarding completion, trial start, paid conversion.
