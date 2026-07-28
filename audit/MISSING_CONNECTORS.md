# Missing Connectors

Generated: 2026-07-28T18:50:20.590Z

> **This audit describes the machine it was generated on.**
> Regenerate it on the founder's laptop before trusting it. An audit produced
> in a cloud container will report ffmpeg, sqlite3, gh, and cron as absent when
> they may be installed locally. See CLAUDE.md addendum A7.

## Connectors awaiting credentials

Official API available, credentials not fully configured.

| Connector | Status | Missing env vars |
|---|---|---|
| LinkedIn Posts API (personal profile) | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_MEMBER_URN` |
| Meta Graph API — Facebook Page | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `META_APP_ID`, `META_APP_SECRET`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN` |
| Meta Graph API — Instagram Reels | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `META_APP_ID`, `META_APP_SECRET`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `META_PAGE_ACCESS_TOKEN` |
| YouTube Data API v3 | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` |
| TikTok Content Posting API | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN` |
| Blog / landing page (static deploy) | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `BLOG_DEPLOY_HOOK_URL` |
| Email / waitlist provider | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` |
| PostHog | OFFICIAL_API_AVAILABLE_NOT_CONFIGURED | `POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST` |

## Missing tooling

| Tool | Required | Purpose |
|---|---|---|
| GitHub CLI | no | Convenience only |
| SQLite | no | Not used — storage is local JSON by design |
| ffmpeg | no | Video validation and processing (Phase 4) |
| ImageMagick | no | Thumbnail processing (Phase 4) |
| ImageMagick (legacy) | no | Thumbnail processing fallback |
| cron | no | Local scheduling |

Tools marked not-required are needed from Phase 4 onward, with one exception:
SQLite is not used at all — storage is local JSON by design, so its absence is not a gap.
