# CLAUDE.md — Autonomous Organic Growth OS

## Role and Chain of Command

You are acting as the senior engineer and implementation lead for the founder. Your job is to design, audit, build, and harden an autonomous marketing agent system for **Rig Receipts** and **Tilawah Lock**.

This file is the governing source of truth. Do not replace, weaken, or bypass these requirements. If the current codebase, tooling, connector permissions, or platform APIs conflict with this file, document the conflict, propose the safest production-ready path, and wait for founder approval only when the decision materially changes cost, platform risk, data access, brand positioning, or scope.

The system must run as a one-man operation from the founder’s laptop using Claude Code, local files, official APIs, and minimal monthly operating cost. The target is $0 ad spend, not necessarily $0 tooling. Prefer free tiers and local-first infrastructure until traction proves a paid upgrade is justified.

---

## Product Scope

### Product 1: Rig Receipts

Rig Receipts is a trucking profitability, receipt-tracking, expense, load analysis, and freight-intelligence app for owner-operators and small fleets.

Core promise:

> Know what every load really pays.

Default campaign:

> Gross Rate Is Not Profit

Primary audience:

- Owner-operators
- Independent truckers
- Leased-on drivers
- Small fleet operators

Core content themes:

- Load profitability
- Cost per mile
- Fuel, deadhead, tolls, scale tickets, repairs, and maintenance reserve
- Receipt organization
- Tax readiness, without making tax guarantees
- Freight intelligence
- Historical freight-rate transparency
- Community Rate Board education, but only within approved boundaries

Hard constraints:

- Rig Receipts is not a load board.
- Do not imply load booking, bidding, dispatching, messaging brokers, or contacting brokers through public rate cards.
- Do not publish broker names on general public examples.
- Do not use real sensitive freight paperwork in public marketing.
- Do not make tax, legal, income, profit, savings, or rate guarantees.
- Do not make the brand primarily anti-broker.
- Public rate-card examples must be fictional or privacy-redacted.
- Community Rate Board messaging requires founder approval.

### Product 2: Tilawah Lock

Tilawah Lock is an Islamic digital discipline app that helps Muslims put worship before phone distraction.

Core promise:

> Pray. Read. Then Unlock.

Default campaign:

> Read Before You Scroll

Primary audience:

- Muslims seeking better Salah consistency
- Muslims trying to read Quran more consistently
- Muslims struggling with phone distraction
- Muslim students, workers, parents, and young adults

Core content themes:

- Salah before distraction
- Quran before scrolling
- Islamic app blocking
- Focus Lock
- Calm structure without shame
- Worship-first digital wellness
- Privacy-first accountability

Hard constraints:

- Do not shame Muslims.
- Do not exploit religious guilt.
- Do not claim religious authority.
- Do not guarantee spiritual outcomes.
- Do not make payment feel religiously forced.
- Do not cite ayah, hadith, fatwa, or scholarly claims without explicit founder approval.
- Do not use inappropriate humor around Allah, Salah, Quran, worship, sin, or iman.
- Premium/paywall content tied to worship requires founder approval.

---

## System Objective

Build an **Autonomous Organic Growth OS** that can:

1. Research organic marketing opportunities.
2. Generate platform-specific content.
3. Classify risk before publishing.
4. Auto-publish low-risk approved content through official platform APIs.
5. Hold sensitive content for founder approval.
6. Block unsafe content.
7. Collect analytics.
8. Learn from performance.
9. Update its memory banks.
10. Improve future campaigns forever through retained local memory, rules, and scoring.

The system must not become a spam bot. It must be an autonomous operator with strict guardrails.

---

## Required Build Philosophy

Use this autonomy target:

- 80% autonomous creation
- 60–70% autonomous publishing
- 20–30% approval-gated publishing
- 10% manual-only community engagement
- 0% spam automation

Autonomy is earned through performance and safety. Begin more conservative. Expand auto-publishing only after the logs show the system is producing safe, useful, differentiated content.

---

## Connector and Capability Audit — Mandatory First Step

Before writing production logic, run a full connector, credential, and environment audit. Do not assume APIs, MCP servers, credentials, or packages exist.

Create these files:

- `/audit/CONNECTOR_AUDIT.md`
- `/audit/CONNECTOR_MATRIX.json`
- `/audit/MISSING_CONNECTORS.md`
- `/audit/RISKY_CONNECTORS.md`
- `/audit/RECOMMENDED_CONNECTORS.md`
- `/audit/ENVIRONMENT_AUDIT.md`

### Audit Local Environment

Inspect and report availability of:

- Node.js
- npm, pnpm, or yarn
- TypeScript
- Python
- Git
- GitHub CLI
- SQLite
- ffmpeg
- ImageMagick or equivalent image tooling
- cron, launchd, or Node scheduler
- local file permissions
- project `.env` and `.env.example`, without exposing secrets
- existing package.json scripts
- existing source directories
- existing assets
- existing analytics files
- existing app/product files relevant to Rig Receipts or Tilawah Lock

Never print secret values. Only report whether a secret appears configured.

### Audit Claude Code and MCP

Inspect and report:

- Whether Claude Code is installed and callable.
- Whether non-interactive `claude -p` workflows are available.
- Whether MCP is configured.
- Existing MCP servers.
- Existing Claude Code commands, hooks, plugins, or skills.
- Current project-level `.mcp.json`, if present.
- Global Claude configuration, if accessible, without exposing secrets.
- Which MCP servers are safe to use.
- Which MCP servers are unnecessary or risky.

Suggested commands to evaluate, when safe:

```bash
claude --version
claude mcp list
claude -p "Return a one-line health check for this project."
```

### Audit Publishing Connectors

For each platform, classify as one of:

- `AVAILABLE_AND_CONFIGURED`
- `AVAILABLE_MISSING_AUTH`
- `OFFICIAL_API_AVAILABLE_NOT_CONFIGURED`
- `DRAFT_ONLY_RECOMMENDED`
- `NOT_RECOMMENDED`
- `BLOCKED`

Audit these publishing targets:

1. YouTube Shorts
2. TikTok
3. Instagram Reels
4. Facebook Page
5. LinkedIn
6. Blog or landing page
7. Email/waitlist
8. X, optional only
9. Reddit, draft-only by default
10. Facebook Groups, draft-only by default
11. Discord/Telegram/Slack approval digest, optional

### Platform Connector Rules

Only use official APIs, OAuth, approved SDKs, or user-authorized platform workflows.

Do not use:

- private or undocumented platform endpoints
- browser automation that mimics a human to evade restrictions
- credential scraping
- scraping behind login pages
- automated DMs
- mass commenting
- automated Reddit community posting
- automated Facebook group posting
- engagement buying
- follow/unfollow automation
- CAPTCHA bypass
- rate-limit evasion

### Required Connector Matrix Fields

Every connector entry in `/audit/CONNECTOR_MATRIX.json` must include:

```json
{
  "name": "YouTube Data API",
  "category": "publisher",
  "status": "OFFICIAL_API_AVAILABLE_NOT_CONFIGURED",
  "purpose": "Upload and publish/schedule YouTube Shorts",
  "auth_required": true,
  "env_vars_needed": ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"],
  "monthly_cost": "0 initially",
  "official_api_only": true,
  "risk_level": "medium",
  "automation_level": "approval-gated then auto-publish for green content",
  "notes": "Verify project/API status, OAuth scopes, quota, and whether uploads are public or private based on project verification."
}
```

---

## Recommended Connector Stack

### Minimum Required

- Claude Code
- Local filesystem
- Git
- Node.js + TypeScript
- SQLite or local JSON files
- GitHub repo for version control
- YouTube Data API, after audit
- TikTok Content Posting API, after audit
- Meta Graph API for Instagram/Facebook publishing, after audit
- LinkedIn Posts API, after audit
- Email provider such as Resend, Gmail SMTP, or equivalent, after audit
- Local approval queue

### Strongly Recommended

- ffmpeg for video validation and processing
- Canva/CapCut manual export workflow for early assets
- Cloudflare Pages or static site deploy for owned landing/blog pages
- PostHog or simple event logs for product conversion analytics
- Google Sheets export/import only if useful; local JSON/SQLite is preferred first

### Optional Later

- X API, only if cost and access make sense
- Telegram/Discord/Slack bot for approval digest
- Supabase, only when local storage becomes insufficient
- Notion/Airtable, only if the founder prefers visual operations

---

## System Architecture

Build the project with this structure:

```text
autonomous-growth-os/
  CLAUDE.md
  README.md
  package.json
  .env.example
  .gitignore

  /audit
    CONNECTOR_AUDIT.md
    CONNECTOR_MATRIX.json
    MISSING_CONNECTORS.md
    RISKY_CONNECTORS.md
    RECOMMENDED_CONNECTORS.md
    ENVIRONMENT_AUDIT.md

  /agents
    chief-growth-strategist.md
    market-intelligence-agent.md
    audience-mining-agent.md
    content-production-agent.md
    compliance-guardrail-agent.md
    approval-agent.md
    publisher-agent.md
    analytics-agent.md
    learning-agent.md

  /brands
    rig-receipts.md
    tilawah-lock.md
    shared-rules.md

  /campaigns
    rig-receipts/
      gross-rate-is-not-profit.md
      cost-per-mile-school.md
      receipt-chaos.md
      community-rate-board-safe-messaging.md

    tilawah-lock/
      read-before-you-scroll.md
      pray-read-then-unlock.md
      no-shame-discipline.md
      quran-before-phone.md

  /content
    drafts/
    approval-queue/
    approved/
    scheduled/
    published/
    rejected/
    blocked/

  /assets
    rig-receipts/
      screenshots/
      videos/
      thumbnails/
      templates/
    tilawah-lock/
      screenshots/
      videos/
      thumbnails/
      templates/

  /memory
    hook-bank.json
    objection-bank.json
    audience-language-bank.json
    platform-performance.json
    campaign-history.json
    brand-rule-updates.json

  /analytics
    raw/
    processed/
    daily/
    weekly/
    monthly/
    content-scorecard.json

  /publishers
    youtube.ts
    tiktok.ts
    instagram.ts
    facebook-page.ts
    linkedin.ts
    email.ts
    blog.ts
    x-optional.ts
    reddit-draft-only.ts
    facebook-groups-draft-only.ts

  /scripts
    audit-connectors.ts
    daily-research.ts
    generate-content.ts
    classify-risk.ts
    approval-digest.ts
    approve.ts
    reject.ts
    publish-approved.ts
    collect-analytics.ts
    weekly-review.ts
    update-memory.ts
```

---

## Content State Machine

Every content item must move through this exact state machine:

```text
drafted
  ↓
brand_checked
  ↓
risk_classified
  ↓
auto_publish_ready OR awaiting_founder_approval OR blocked
  ↓
scheduled
  ↓
published
  ↓
analytics_collected
  ↓
learned_from
  ↓
memory_updated
```

No content may skip brand checking or risk classification.

---

## Risk Classification System

### Green — Auto-Publish Eligible

Content can auto-publish only when all conditions are true:

- Brand-safe
- Low sensitivity
- No real customer/user data
- No legal, tax, financial, theological, or religious authority claims
- No broker names
- No real freight documents
- No strong claims
- No platform policy risk
- Not duplicate spam
- Brand score >= 85
- Platform safety score >= 85
- Strategic quality score >= 85

### Yellow — Founder Approval Required

Founder approval is required if any condition is true:

- Mentions Allah, Salah, Quran, worship, iman, sin, religious duty, or spiritual outcomes
- Discusses Tilawah Lock payment or premium features in relation to worship
- Discusses taxes, legal issues, income outcomes, rate transparency, brokers, or freight claims
- Uses creator outreach
- Uses community replies
- Uses real user comments, testimonials, screenshots, or examples
- Compares competitors
- Makes a strong claim
- Could be misunderstood without context

### Red — Blocked

Block content if any condition is true:

- Spam-like or duplicate across communities
- Uses guilt, shame, or religious pressure
- Claims guaranteed spiritual, financial, legal, tax, or business outcomes
- Exposes broker names or sensitive load details
- Positions Rig Receipts as a load board
- Encourages unsafe trucking behavior
- Uses private APIs or browser automation to evade platform restrictions
- Violates platform policy
- Uses unverified statistics as fact

---

## Approval Gateway

Build a local approval queue that supports:

- approve
- edit
- reject
- block

Every approval item must include:

```json
{
  "id": "TL-IG-2026-07-28-001",
  "product": "Tilawah Lock",
  "platform": "Instagram Reels",
  "campaign": "Read Before You Scroll",
  "hook": "Read before you scroll.",
  "full_content": "...",
  "caption": "...",
  "cta": "...",
  "asset_path": "...",
  "risk_level": "yellow",
  "approval_reason": "Mentions Quran and worship behavior.",
  "recommended_action": "approve after founder review",
  "status": "awaiting_founder_approval",
  "created_at": "ISO_TIMESTAMP"
}
```

Approval commands:

```bash
npm run approve TL-IG-2026-07-28-001
npm run reject TL-IG-2026-07-28-001 "Make this softer and less guilt-based."
npm run block TL-IG-2026-07-28-001 "Religious pressure risk."
```

---

## Publisher Adapter Requirements

Each publisher adapter must:

1. Use official API only.
2. Validate authentication status.
3. Validate permissions/scopes.
4. Validate asset path exists.
5. Validate media type and file size.
6. Validate caption length and metadata.
7. Validate risk level and approval status.
8. Upload or schedule content.
9. Store platform post ID.
10. Log timestamp and result.
11. Retry safely with exponential backoff.
12. Pause connector after repeated errors.
13. Never bypass rate limits.
14. Never publish blocked content.
15. Never publish yellow content without approval.

---

## Daily Automation Workflow

Create these commands:

```bash
npm run audit:connectors
npm run daily:research
npm run content:generate
npm run risk:classify
npm run approval:digest
npm run publish:approved
npm run analytics:collect
npm run learning:update
npm run weekly:review
npm run weekly:plan
```

Recommended local schedule:

```text
7:00 AM  daily:research
8:00 AM  content:generate
8:30 AM  risk:classify
9:00 AM  approval:digest
12:00 PM publish:approved
8:00 PM  analytics:collect
8:30 PM  learning:update
Friday 8:00 PM weekly:review
Sunday 9:00 AM weekly:plan
```

---

## Self-Improving Memory System

Maintain these memory files:

```text
/memory/hook-bank.json
/memory/objection-bank.json
/memory/audience-language-bank.json
/memory/platform-performance.json
/memory/campaign-history.json
/memory/brand-rule-updates.json
```

### Learning Rules

- High saves + high shares: scale the hook.
- High views + low clicks: improve CTA.
- High clicks + low installs: improve landing page or app store page.
- High installs + low activation: improve onboarding.
- High trial starts + low paid conversion: improve paywall.
- Repeated comments with the same objection: add to objection bank and generate response content.
- Negative audience response: create a brand-risk note and soften angle.
- Platform warning: pause connector and require founder review.
- 14-day underperformance: reduce frequency or kill campaign.

### Campaign Classification

Every campaign and hook must be classified as:

- `SCALE`
- `REWORK`
- `ARCHIVE`
- `KILL`

---

## Daily Content Targets

Start conservative.

### Rig Receipts

Daily target:

- 1 short-form video concept/script
- 1 caption
- 1 CTA variation
- 1 authority/founder post
- 1 community reply draft, manual-only
- 1 ASO or landing page improvement idea

### Tilawah Lock

Daily target:

- 1 short-form video concept/script
- 1 caption
- 1 CTA variation
- 1 soft habit post
- 1 community reply draft, manual-only
- 1 ASO or landing page improvement idea

Do not increase volume until quality and safety metrics justify it.

---

## Channel Automation Rules

### Auto-Publish Candidate Channels

- YouTube Shorts
- TikTok, if official Content Posting API access is configured
- Instagram Reels, if Meta Graph API permissions are configured
- Facebook Page
- LinkedIn
- Blog/landing page
- Email/waitlist

### Draft-Only Channels

- Reddit
- Facebook groups
- Discord communities
- YouTube comments
- TikTok comments
- Instagram comments
- LinkedIn comments

The Community Agent may draft replies, but the founder must manually post or approve them unless a dedicated owned community is created and explicitly authorized.

---

## Product-Specific Autonomy Rules

### Rig Receipts Auto-Publish Allowed

- Fictional load math examples
- Cost-per-mile education
- Receipt organization tips
- Fuel tracking tips
- Deadhead awareness tips
- Product feature demos
- Generic trucking business education

### Rig Receipts Approval Required

- Tax-related claims
- Broker-related content
- Rate Board content
- Freight intelligence claims
- Financial outcome claims
- Competitor comparisons
- Real route/rate examples
- Real user examples

### Tilawah Lock Auto-Publish Allowed

- Focus Lock demos
- Calm screen-time discipline tips
- Product walkthroughs
- Gentle habit content
- “Read before you scroll” content without heavy religious persuasion
- Privacy-first digital wellness content

### Tilawah Lock Approval Required

- Salah content
- Allah references
- Quran/hadith/scholarship references
- Worship obligation framing
- Paywall/premium messaging tied to worship
- Religious emotional content
- Creator outreach
- Community replies

---

## Analytics Requirements

Collect when available:

- views
- watch time
- average view duration
- likes
- comments
- saves
- shares
- profile visits
- link clicks
- waitlist signups
- app installs
- onboarding completion
- trial starts
- paid conversions
- negative comments
- platform warnings

Maintain:

- `/analytics/content-scorecard.json`
- `/analytics/daily/YYYY-MM-DD.md`
- `/analytics/weekly/YYYY-WW.md`
- `/analytics/monthly/YYYY-MM.md`

---

## Security Requirements

- Use `.env` for secrets.
- Never commit secrets.
- Keep `.env.example` with placeholder variable names.
- Log only whether credentials are present, never credential values.
- Use OAuth where required.
- Store refresh tokens securely.
- Separate publish permissions by platform.
- Add a kill switch: `AUTOPUBLISH_ENABLED=false`.
- Add per-platform kill switches:
  - `YOUTUBE_AUTOPUBLISH_ENABLED=false`
  - `TIKTOK_AUTOPUBLISH_ENABLED=false`
  - `INSTAGRAM_AUTOPUBLISH_ENABLED=false`
  - `LINKEDIN_AUTOPUBLISH_ENABLED=false`
  - `EMAIL_AUTOSEND_ENABLED=false`

---

## Build Phases

### Phase 1 — Audit and Local Core

Deliver:

- Connector audit
- Environment audit
- Repo structure
- Memory files
- Risk classifier
- Approval queue
- Local CLI commands
- No auto-posting yet

### Phase 2 — Content and Learning Engine

Deliver:

- Daily research workflow
- Content generation workflow
- Brand guardrail workflow
- Scorecard workflow
- Weekly review workflow
- Memory update workflow

### Phase 3 — Owned-Channel Publishing

Deliver:

- Blog/landing publishing
- Email/waitlist publishing
- Approval digest
- Analytics collection
- Kill switches

### Phase 4 — Social Publisher Adapters

Deliver only after audit and founder approval:

- YouTube adapter
- TikTok adapter
- Instagram adapter
- Facebook Page adapter
- LinkedIn adapter

### Phase 5 — Self-Optimizing Campaigns

Deliver:

- Automated hook scaling
- CTA testing
- posting-time testing
- platform allocation recommendations
- onboarding/paywall improvement recommendations from funnel data

---

## Acceptance Criteria

The system is production-ready only when:

1. Connector audit is complete.
2. No secrets are exposed in logs.
3. Every content item goes through the state machine.
4. Green content can publish only after all checks pass.
5. Yellow content cannot publish without founder approval.
6. Red content cannot publish at all.
7. Reddit and Facebook groups remain draft-only.
8. Official APIs are used for all publishing.
9. Every published item has a platform post ID stored.
10. Analytics are collected and mapped back to the originating content ID.
11. Learning memory updates after analytics review.
12. Kill switches work.
13. The founder can review, approve, reject, or block from the local command line.
14. Rig Receipts constraints are enforced.
15. Tilawah Lock constraints are enforced.

---

## Final Instruction

Build the safest minimal autonomous version first. Do not overbuild dashboards, SaaS-style UI, or complex automations before the audit proves which connectors are actually available. Prioritize reliability, brand safety, auditability, official APIs, and a self-improving memory system.

The goal is not to make noise. The goal is to make Rig Receipts and Tilawah Lock grow through disciplined, data-driven, $0 ad spend organic marketing that improves every week.

---

# Implementation Addendum

Everything above is the governing spec and is unchanged. This addendum exists because the spec instructs: *"If the current codebase, tooling, connector permissions, or platform APIs conflict with this file, document the conflict, propose the safest production-ready path, and wait for founder approval."*

Each conflict below was surfaced and the resolution founder-approved before implementation. Nothing here weakens a constraint; where a resolution restores autonomy it does so by making an existing safety requirement mechanically enforceable rather than discretionary.

## A1. Phase 4 is not a single phase

The spec lists five social adapters as one deliverable. Verified against current platform documentation, their access gates differ enough to change build order:

| Channel | Gate | Consequence |
|---|---|---|
| LinkedIn personal profile | `w_member_social`, self-serve | Available now |
| Facebook Page + Instagram Reels | Meta Standard Access covers assets the app owner administers; Advanced Access + Business Verification only for third-party assets | Feasible without full App Review. IG Reels requires a **Business** account — Creator accounts cannot publish via API |
| YouTube Shorts | API projects created after 2020-07-28 without a passed compliance audit upload as **private only** | Uploads succeed but are invisible until audit passes |
| TikTok | Unaudited clients locked to `SELF_ONLY`, max 5 users/24h | No meaningful auto-publish before audit |
| LinkedIn **Page** | Community Management API, Marketing Developer Platform approval, effectively enterprise-partner only | Treated as out of scope |

Meta App Review runs 2–6 weeks with rejection expected, plus 1–2 weeks business verification.

**Revised Phase 4 order:** LinkedIn personal → Meta (Page + Instagram) → YouTube (accepting private-until-audit) → TikTok. LinkedIn Page is dropped from scope until circumstances change.

The spec's stated YouTube upload cost of 1600 quota units is in flux; current sources indicate it may now be ~100. Verify against the real project before sizing quota.

## A2. Tilawah Lock autonomy — approved template library

**Conflict.** The Yellow rules gate any mention of Salah, Quran, worship, iman, or spiritual outcomes. Tilawah Lock's core promise is *"Pray. Read. Then Unlock."* and its default campaign is *"Read Before You Scroll."* Essentially all on-brand content therefore trips Yellow, making Tilawah Lock ~100% approval-gated — irreconcilable with the 60–70% autonomous publishing target.

**Resolution.** A founder-approved template library. The founder approves a template once; instances rendered from it may auto-publish. This is enforced mechanically, not by judgment. An instance is auto-publish eligible only when **all** of the following hold:

1. It is byte-identical to the template outside explicitly declared slots.
2. Every slot value independently passes the full Red and Yellow rule pass.
3. The template's content hash still matches an approved record.

Any drift on any condition falls back to normal founder approval. No religious claim can enter through a slot, because slot values are rule-checked in isolation. The template's own religious framing was approved once, by the founder, deliberately.

## A3. Risk scores are defined deterministically

The spec gates Green on three scores ≥ 85 but never defines their scale or computation. Left undefined this is an unreviewable model judgment sitting on the auto-publish gate.

**Resolution.** Two layers:

- A **deterministic rule pass** (regex/lexicon, versioned in `src/risk/rules/`) that can only ever *downgrade* content.
- An **LLM rubric scorer** producing the three 0–100 scores.

Final level is the most severe of the two. A model score can never lift content above a triggered rule. Every classification records the IDs of all triggered rules, so any decision is reconstructable after the fact.

## A4. State machine failure edges

The spec's state machine is happy-path only. Four states are added because their absence is a safety hole rather than an inconvenience:

- `edited` — a founder edit re-enters `brand_checked`. Without this, editing content in the approval queue bypasses classification entirely.
- `publish_failed` — a failed publish must not read as published.
- `expired` — approval requests that time out must not linger as publishable.
- `retracted` — a platform warning needs a path to pull content down.

A single `transition()` function in `src/state/machine.ts` is the only code permitted to write an item's status, which is what makes Acceptance Criterion 3 enforceable rather than aspirational.

## A5. Learning thresholds

At the spec's daily targets the system produces 30–60 measurable items per month. The Learning Rules as written ("high saves + high shares: scale the hook") would act on samples of n=1. Rules now require a minimum sample count and compare against a rolling median rather than absolute cutoffs. No campaign is classified `SCALE`/`REWORK`/`ARCHIVE`/`KILL` below the threshold.

## A6. Smaller corrections

- `npm run block` and `npm run weekly:plan` exist in the spec's command list but had no corresponding script in the file tree. Both are implemented.
- Duplicate detection (a Green criterion with no stated mechanism) uses normalized 5-gram shingle Jaccard similarity against the published corpus: ≥0.60 → Yellow, ≥0.85 → Red.
- Analytics attribution requires a platform-post-ID ↔ content-ID mapping written at publish time, since platforms provide no custom field to carry our ID.
- Kill switches fail closed: only the exact string `"true"` enables publishing, and the check lives in the publisher adapter, not the calling script.
- Storage is local JSON rather than SQLite. The spec permits either and prefers local-first; JSON is git-diffable, which directly serves the auditability requirement.

## A7. Operating environment

The connector audit **must be run on the founder's laptop**. An audit generated in a cloud container reports `ffmpeg`, `sqlite3`, `gh`, and `cron` as absent when they may be present locally. Committed audit output from any other machine should be treated as invalid.

## A8. Inference cost

The spec targets $0 ad spend and minimal tooling cost but never budgets model inference. Current backend is `claude -p`, which runs on the existing Claude subscription at no marginal cost.

If the system later moves to the Anthropic API, the modeled cost at the spec's daily targets is approximately **$14–23/month on Sonnet 5** with prompt caching and the Batch API, ~$8/month on Haiku 4.5, ~$37/month on Opus 5. The three levers, in order of impact: prompt caching on the stable brand/campaign/memory prefix (cache reads bill at ~0.1x), the Batch API (50% discount; content generation and risk classification are both scheduled and latency-tolerant), and model tiering (risk classification is a constrained rubric task well suited to a smaller model).

The provider interface accepts model and batch hints per call site today, so this migration is configuration rather than a refactor.
