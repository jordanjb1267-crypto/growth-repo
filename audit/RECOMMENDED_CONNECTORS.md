# Recommended Connector Stack

Generated: 2026-08-02T18:27:55.448Z

## Now (Phases 1-3)

- Claude Code (`claude -p`) — content generation, no marginal token cost
- Local filesystem + git — storage and audit trail
- Node.js + TypeScript — no build step, no runtime dependencies
- Blog / static host — owned channel, no policy risk, no review gate
- Email provider — owned channel, but approval-gated: a send cannot be retracted
- PostHog — already has an organisation provisioned

## Phase 4, in this order

0. **Blotato (social publishing backend)** — Accounts connect once in the Blotato dashboard (user-authorized OAuth against each platform's official API); posting then needs only BLOTATO_API_KEY plus per-platform account IDs (npm run blotato:accounts).
1. **LinkedIn Posts API (personal profile)** — Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path.
2. **Meta Graph API — Facebook Page** — Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path.
3. **Meta Graph API — Instagram Reels** — Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path.
4. **YouTube Data API v3** — Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path, and via Blotato's audited app public uploads work from day one.
5. **TikTok Content Posting API** — Alternate direct backend (PUBLISH_BACKEND=direct) — Blotato is the default delivery path, and via Blotato public posting works from day one.

## Deliberately not adopted

- **SQLite** — the spec permits JSON or SQLite and prefers local-first. JSON is git-diffable, which serves the auditability requirement directly.
- **LinkedIn Community Management API** — enterprise-partner gated; not realistic solo.
- **X API** — free tier write-capped, paid tier costs more than the rest of the stack combined.
- **Supabase, Notion, Airtable** — no need until local storage is genuinely insufficient.

## Revisit when

- A platform audit passes (YouTube, TikTok) — move that connector up the order.
- Content volume outgrows a single JSON directory — reconsider SQLite then, not before.
- `claude -p` throughput becomes the bottleneck — see the cost model in `src/llm/anthropic-api.ts` before switching.
