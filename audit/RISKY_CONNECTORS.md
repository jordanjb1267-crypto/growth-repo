# Risky Connectors

Generated: 2026-08-02T18:27:55.448Z

Connectors whose risk is high enough to change the build decision, not just the build order.

### YouTube Data API v3

**Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED · **Automation:** approval-gated; uploads land private until the compliance audit passes

Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path, and via Blotato's audited app public uploads work from day one. Direct-path reality: API projects created after 2020-07-28 that have not passed a compliance audit can only upload videos as PRIVATE. Uploads succeed and the video is simply invisible, so this fails quietly rather than loudly — do not read a successful upload as a successful publish. Default quota is 10,000 units/day; the per-upload cost has historically been ~1600 units but current sources indicate it may now be ~100. Measure against the real project rather than trusting either number.

### TikTok Content Posting API

**Status:** OFFICIAL_API_AVAILABLE_NOT_CONFIGURED · **Automation:** not viable for auto-publish before the audit passes

Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path, and via Blotato public posting works from day one. Direct-path reality: unaudited API clients are restricted to SELF_ONLY viewership — every post is private and visible to nobody but the creator — and are capped at 5 users posting per 24 hours.

### LinkedIn Community Management API (Pages)

**Status:** NOT_RECOMMENDED · **Automation:** none — out of scope

Requires Marketing Developer Platform approval, which is generally reserved for enterprise partners, plus a registered company, a verified Page, a two-tier app review, and super-admin verification from a business email. Not a realistic path for a one-operator setup. Recommend dropping in favour of the personal-profile adapter until circumstances change.

### Reddit

**Status:** DRAFT_ONLY_RECOMMENDED · **Automation:** draft-only — no automated posting, ever

The spec makes Reddit draft-only by default and forbids automated community posting. There is no env var that enables posting here, which is a stronger guarantee than a kill switch defaulting to off.

### Facebook Groups

**Status:** DRAFT_ONLY_RECOMMENDED · **Automation:** draft-only — no automated posting, ever

Draft-only by spec. Same reasoning as Reddit; no automation path exists in this codebase.

### X (Twitter) API

**Status:** NOT_RECOMMENDED · **Automation:** none — optional and deferred

The spec marks X optional. The free tier's write cap makes it marginal for a daily cadence, and the paid tier costs an order of magnitude more than the entire rest of the stack. Revisit only if the other channels are saturated.

## Categorically excluded

These have no automation path in this codebase, and adding one would violate the spec:

- Private or undocumented platform endpoints
- Browser automation that mimics a human to evade restrictions
- Credential scraping, or scraping behind a login
- Automated DMs and mass commenting
- Automated Reddit or Facebook Group posting
- Engagement buying, follow/unfollow automation
- CAPTCHA bypass, rate-limit evasion

Reddit, Facebook Groups, and X have no kill switch because they have no publish path at all.
That is a stronger guarantee than a switch that defaults to off.
