# Environment Audit

Generated: 2026-08-02T18:27:55.448Z
Platform: darwin

> **This audit describes the machine it was generated on.**
> Regenerate it on the founder's laptop before trusting it. An audit produced
> in a cloud container will report ffmpeg, sqlite3, gh, and cron as absent when
> they may be installed locally. See CLAUDE.md addendum A7.

## Toolchain

| Tool | Present | Version | Required | Purpose |
|---|---|---|---|---|
| Node.js | yes | v24.18.0 | yes | Runtime for every script here |
| npm | yes | 11.16.0 | yes | Runs the command list |
| pnpm | NO | — | no | Alternative package manager |
| yarn | NO | — | no | Alternative package manager |
| TypeScript | yes | Version 5.9.3 | no | Typecheck gate (npm run typecheck) |
| Python 3 | yes | Python 3.11.2 | no | Ad-hoc data work |
| git | yes | git version 2.39.5 (Apple Git-154) | yes | Version control and the audit trail |
| GitHub CLI | yes | gh version 2.97.0 (2026-07-31) | no | Convenience only |
| SQLite | yes | 3.43.2 2023-10-10 13:08:14 1b37c146ee9ebb7acd0160c0ab1fd11017a419fa8a3187386ed8cb32b709aapl (64-bit) | no | Not used — storage is local JSON by design |
| ffmpeg | NO | — | no | Video validation and processing (Phase 4) |
| ImageMagick | NO | — | no | Thumbnail processing (Phase 4) |
| ImageMagick (legacy) | NO | — | no | Thumbnail processing fallback |
| cron | NO | — | no | Local scheduling |
| Claude Code | yes | 2.1.220 (Claude Code) | yes | Content generation backend (claude -p) |

All required tools present.

## Claude Code and MCP

- `claude` binary: present
- Non-interactive `claude -p`: assumed available (binary present)
- `claude mcp list`: failed

```text
spawnSync claude ETIMEDOUT
```

## Secrets

> Only key NAMES are inspected. No value is read, logged, or written by this audit.

- `.env` present: yes
- `.env.example` present: yes
- Keys with a non-empty value in `.env`: 20

| Key | Configured |
|---|---|
| `APPROVAL_EXPIRY_HOURS` | yes |
| `AUTOPUBLISH_ENABLED` | yes |
| `BLOG_AUTOPUBLISH_ENABLED` | yes |
| `EMAIL_AUTOSEND_ENABLED` | yes |
| `FACEBOOK_AUTOPUBLISH_ENABLED` | yes |
| `INSTAGRAM_AUTOPUBLISH_ENABLED` | yes |
| `LINKEDIN_AUTOPUBLISH_ENABLED` | yes |
| `LINKEDIN_VERSION` | yes |
| `LLM_MODEL_CLASSIFICATION` | yes |
| `LLM_MODEL_GENERATION` | yes |
| `LLM_PROVIDER` | yes |
| `META_GRAPH_VERSION` | yes |
| `POSTHOG_HOST` | yes |
| `POSTHOG_PROJECT_ID_RIG_RECEIPTS` | yes |
| `POSTHOG_PROJECT_ID_TILAWAH_LOCK` | yes |
| `PUBLISH_BACKEND` | yes |
| `TIKTOK_AUTOPUBLISH_ENABLED` | yes |
| `TIKTOK_PRIVACY_LEVEL` | yes |
| `YOUTUBE_AUTOPUBLISH_ENABLED` | yes |
| `YOUTUBE_PRIVACY_STATUS` | yes |

## Repository

| Location | Files |
|---|---|
| `/campaigns/rig-receipts` | 4 |
| `/campaigns/tilawah-lock` | 4 |
| `/brands` | 3 |
| `/memory` | 6 |
| `/templates/rig-receipts` | 1 |
| `/templates/tilawah-lock` | 1 |
| `/content/drafts` | 0 |
| `/content/approval-queue` | 0 |
| `/content/published` | 0 |
| `/publishers` | 0 |

## Scheduling

cron was not detected. On macOS use launchd, or run a Node scheduler in a long-lived process. Do not assume a scheduled job will inherit your shell environment.
