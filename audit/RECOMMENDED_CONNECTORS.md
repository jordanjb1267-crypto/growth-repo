# Recommended Connector Stack

Generated: 2026-07-28T18:50:20.590Z

## Now (Phases 1-3)

- Claude Code (`claude -p`) — content generation, no marginal token cost
- Local filesystem + git — storage and audit trail
- Node.js + TypeScript — no build step, no runtime dependencies
- Blog / static host — owned channel, no policy risk, no review gate
- Email provider — owned channel, but approval-gated: a send cannot be retracted
- PostHog — already has an organisation provisioned

## Phase 4, in this order

1. **LinkedIn Posts API (personal profile)** — The only social channel with no review gate.
2. **Meta Graph API — Facebook Page** — Standard Access covers Pages the app owner administers, so full App Review is not required for our own Pages — the founder must hold a role on the app.
3. **Meta Graph API — Instagram Reels** — Requires an Instagram BUSINESS account linked to a Facebook Page.
4. **YouTube Data API v3** — API projects created after 2020-07-28 that have not passed a compliance audit can only upload videos as PRIVATE.
5. **TikTok Content Posting API** — Unaudited API clients are restricted to SELF_ONLY viewership — every post is private and visible to nobody but the creator — and are capped at 5 users posting per 24 hours.

## Deliberately not adopted

- **SQLite** — the spec permits JSON or SQLite and prefers local-first. JSON is git-diffable, which serves the auditability requirement directly.
- **LinkedIn Community Management API** — enterprise-partner gated; not realistic solo.
- **X API** — free tier write-capped, paid tier costs more than the rest of the stack combined.
- **Supabase, Notion, Airtable** — no need until local storage is genuinely insufficient.

## Revisit when

- A platform audit passes (YouTube, TikTok) — move that connector up the order.
- Content volume outgrows a single JSON directory — reconsider SQLite then, not before.
- `claude -p` throughput becomes the bottleneck — see the cost model in `src/llm/anthropic-api.ts` before switching.
