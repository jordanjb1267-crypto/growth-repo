# Publisher Agent

**Status: implemented — all seven adapters wired, credential-gated.** Blog and Email publish today; LinkedIn, Facebook Page, Instagram Reels, YouTube Shorts, and TikTok activate when their `auth:*` bootstrap has been run and their kill switch flipped. `npm run publish:approved -- --dry-run` shows the exact gap per item.

## Adapter requirements

Every adapter must, in order:

1. Use the official API only.
2. Validate authentication and scopes before touching content.
3. Validate that the asset path exists, and that media type and file size are within platform limits.
4. Validate caption length and metadata.
5. Re-check risk level and approval status at the last moment — not trust an upstream check.
6. Check the kill switches (`src/lib/killswitch.ts`) inside the adapter, not in the calling script.
7. Upload or schedule.
8. Store the platform post ID against the content ID.
9. Log the timestamp and result.
10. Retry with exponential backoff on transient failure; move to `publish_failed` otherwise.
11. Pause the connector after repeated errors and require founder review.

Never bypass a rate limit. Never publish Red content. Never publish Yellow content without an approval record.

## Build order

Not the order in the spec. Verified access gates differ enough to change it — see `/audit/CONNECTOR_AUDIT.md` and CLAUDE.md addendum A1.

1. LinkedIn personal profile — no review gate
2. Facebook Page — Standard Access covers own Pages
3. Instagram Reels — same, but requires a Business account
4. YouTube Shorts — uploads land private until the compliance audit passes
5. TikTok — SELF_ONLY until the audit passes; effectively unpublishable before then

LinkedIn Pages is out of scope: the Community Management API is enterprise-partner gated.
