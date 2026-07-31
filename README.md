# Autonomous Organic Growth OS

Organic marketing system for **Rig Receipts** (trucking profitability) and **Tilawah Lock** (Islamic digital discipline). Runs locally from the founder's laptop. $0 ad spend.

`CLAUDE.md` is the governing spec. Everything here implements it; where implementation and spec conflicted, the conflict is documented in the Implementation Addendum at the bottom of that file rather than resolved silently.

**Phases 1–5 are built.** The full loop runs: research → generate → classify → approve → publish → analytics → learning → weekly review/plan. All seven channels are wired: Blog and Email first-party, and the five social channels (LinkedIn, Facebook Page, Instagram Reels, YouTube Shorts, TikTok) through **Blotato** — the founder connects each account once in the Blotato dashboard, and the whole social side then needs one API key plus per-platform account IDs (CLAUDE.md addendum A9). The per-platform direct adapters remain available behind `PUBLISH_BACKEND=direct`.

## Standing it up (credential checklist)

Everything is headless-ready. **`npm run doctor` is the companion for this whole section** — it reports per-channel readiness with the exact next command, and the loop is: run doctor → do the next thing it names → run doctor again, until every channel you want reads READY. In order:

1. `npm install && cp .env.example .env` — all kill switches start off.
2. `npm run audit:connectors` on the operating laptop.
3. Owned channels first: set `BLOG_DEPLOY_HOOK_URL` (optional), Resend keys + `FOUNDER_EMAIL`, and the product URLs (`RIG_RECEIPTS_URL`, `TILAWAH_LOCK_URL` — UTM attribution hangs off these).
4. Social, through Blotato — no platform apps, no per-platform OAuth:
   - Create a Blotato API key (dashboard → Settings → API) → `BLOTATO_API_KEY`
   - Connect each social account once in the Blotato dashboard
   - `npm run blotato:accounts` — lists the connected accounts with the exact `.env` line for each (`BLOTATO_*_ACCOUNT_ID`; Facebook also needs `BLOTATO_FACEBOOK_PAGE_ID`)
5. Video hosting: `npm run site:build` renders `site/posts/` to `site/dist/` with `assets/` mirrored alongside — deploy `site/dist` to any static host and point `ASSET_BASE_URL` at `https://<host>/assets`. Blotato ingests media by URL, so all three video platforms need this.
6. Flip switches one at a time: `AUTOPUBLISH_ENABLED=true` plus the platform switch you're enabling.
7. `npm run publish:approved -- --dry-run` at any point shows exactly what is missing per item — switch state, credential gap with the command to run, asset requirements.
8. Schedule it: `npm run scheduler` (long-running, catches up missed jobs on wake), `scripts/crontab.example`, or on macOS `scripts/launchd.example.plist` (cron does not run with the lid closed; launchd + the scheduler's catch-up does the right thing).

**Reach reality:** via Blotato's audited platform apps, YouTube uploads default **public** and TikTok posts default **PUBLIC_TO_EVERYONE** from day one. The audit gauntlet only returns if you switch to `PUBLISH_BACKEND=direct` (per-platform apps + `auth:*` bootstraps), where unaudited projects force YouTube private and TikTok SELF_ONLY — see `/audit/CONNECTOR_AUDIT.md`. TikTok posts disclose `isAiGenerated`. The same Blotato workspace powers the Blotato MCP connector, so the posting queue can also be inspected conversationally from Claude.

## Setup

```bash
npm install
cp .env.example .env      # fill in as needed; all kill switches start off
npm run audit:connectors  # run this on the laptop that will operate the system
```

Requires Node 22.18+ (native TypeScript type stripping — there is no build step) and the `claude` CLI.

## Daily loop

```bash
npm run daily:research      # topics + audience language → analytics/raw/
npm run content:generate    # daily set for both products → content/drafts/
npm run risk:classify       # rules → dedup → scores → routed by level
npm run approval:digest     # review the queue
npm run approve <id>        # or reject / block / edit
npm run publish:approved    # Blog + Email first-party; social via Blotato
npm run analytics:collect   # manual drops + PostHog funnel → scorecard
npm run learning:update     # baselines + hook bank (threshold-gated)
npm run weekly:review       # Fridays — autonomy %, campaign classifications
npm run weekly:plan         # Sundays — next week's allocation
```

Operational notes:
- Social-platform metrics arrive via manual drops (`analytics/raw/manual-metrics-*.json`) until platform analytics APIs are added; the adapters publish, the founder reads platform dashboards.
- A connector that fails repeatedly pauses itself — clear it with `npm run connector:resume <platform>` after investigating.
- A platform warning on a published item: `npm run retract <id> "warning text"` — marks the item retracted and pauses that channel until you resume it. Take the content down on the platform itself first.
- Approval requests untouched for `APPROVAL_EXPIRY_HOURS` (default 168) expire out of the queue during the daily digest — nothing stale stays publishable.
- `npm run typecheck && npm test` also run in CI on every push.

## How content moves

```
drafted → brand_checked → risk_classified → ┬→ auto_publish_ready → scheduled → published → …
                                            ├→ awaiting_founder_approval
                                            └→ blocked (terminal)
```

Founder actions from the queue: `approve`, `reject`, `block`, `edit`. An edit routes to `edited`, whose only onward edge is back to `brand_checked` — editing cannot skip re-classification.

`src/state/machine.ts` holds the transition table, and `transition()` is the only function permitted to write an item's status. Every move is appended to `logs/state-transitions.jsonl` before the item is persisted.

## How risk is decided

```
deterministic rules → duplicate check → model rubric scores → MOST SEVERE WINS
```

The model can only make the outcome worse. There is no path by which a high score lifts content past a triggered rule, and a scoring failure yields Yellow rather than Green.

- **Rules** (`src/risk/rules/*.json`) — versioned regex lexicons with stable IDs, derived from the spec's hard constraints. Every hit is recorded with the text that matched it.
- **Duplicates** (`src/risk/dedup.ts`) — 5-gram shingle Jaccard against published content, scoped to the same product *and* platform. Cross-posting one video to three platforms is not spam; repeating yourself on one platform is.
- **Scores** (`src/risk/score.ts`) — brand, platform-safety, and strategic-quality on a 0–100 scale with published anchors. All three must reach 85.

## Tilawah Lock and the template library

Tilawah Lock's promise is "Pray. Read. Then Unlock.", so nearly all on-brand content mentions Salah or Quran and trips the approval gate. That gate is correct and is not loosened.

The route to autonomy is `/templates/tilawah-lock/`. The founder approves a piece of religious framing once; instances render from it automatically, but only while three conditions all hold:

1. Byte-identical to the template outside declared slots.
2. Every slot value independently passes the full rule pass.
3. The template hash still matches the approved record.

Any drift falls back to normal approval. Red rules are never discounted by an exemption. After editing or approving a template, re-seal it: `npm run seal:template -- --all`.

## Safety posture

- **Kill switches fail closed.** Only the exact string `"true"` enables publishing. `TRUE`, `1`, `yes`, unset, and typos are all disabled. Checked inside the publisher adapter, not the calling script.
- **Reddit, Facebook Groups, and X have no publish path at all** — not a switch defaulting to off, no code path.
- **Secrets** — `.env` is gitignored, and the audit reports key *presence* only. There is no code path in which a secret value is read into a variable that could be logged.

## Verify

```bash
npm run typecheck   # tsc --noEmit
npm test            # 114 tests
npm run doctor      # standup readiness report
```

Covers: every illegal state transition throws; edits re-enter classification; blocked is terminal; scores cannot override rules; the scorer fails closed; template integrity in all its failure modes; kill switches under every malformed value; generation routing and slot-value rejection; the publish gate (red/yellow/switches/pause); and the learning thresholds (UNCLASSIFIED below sample size, KILL only after a full underperformance window).

## Layout

| Path | |
|---|---|
| `CLAUDE.md` | Governing spec + implementation addendum |
| `/audit` | Connector and environment audit output |
| `/agents` | Role definitions; two are implemented as code, not prompts |
| `/brands`, `/campaigns` | Brand constraints and campaign briefs |
| `/templates` | Founder-approved, hash-sealed templates |
| `/content` | Items, in directories matching their state |
| `/memory` | The six learning banks |
| `/site/posts` | Published blog posts (the Blog adapter's output) |
| `/src/risk` | Rules, dedup, scoring, classification, routing |
| `/src/state` | The state machine |
| `/src/content` | Research context + generation |
| `/src/publish` | Adapter framework; Blotato (default social backend), Blog, Email, and the direct-platform fallback adapters |
| `/src/analytics` | Scorecard, PostHog funnel, learning math |
| `/src/llm` | Provider interface (`claude-cli` now, API backend stubbed) |

## Cost

Content generation runs through `claude -p` on the existing subscription — no marginal token cost. The modeled cost of the Anthropic API path, and the three levers that shape it, are documented at the top of `src/llm/anthropic-api.ts` and in CLAUDE.md addendum A8.
