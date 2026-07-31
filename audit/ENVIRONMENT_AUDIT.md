# Environment Audit

Generated: 2026-07-31T16:47:09.484Z
Platform: linux

> **This audit describes the machine it was generated on.**
> Regenerate it on the founder's laptop before trusting it. An audit produced
> in a cloud container will report ffmpeg, sqlite3, gh, and cron as absent when
> they may be installed locally. See CLAUDE.md addendum A7.

## Toolchain

| Tool | Present | Version | Required | Purpose |
|---|---|---|---|---|
| Node.js | yes | v22.22.2 | yes | Runtime for every script here |
| npm | yes | 10.9.7 | yes | Runs the command list |
| pnpm | yes | 10.33.0 | no | Alternative package manager |
| yarn | yes | 1.22.22 | no | Alternative package manager |
| TypeScript | yes | Version 5.9.3 | no | Typecheck gate (npm run typecheck) |
| Python 3 | yes | Python 3.11.15 | no | Ad-hoc data work |
| git | yes | git version 2.43.0 | yes | Version control and the audit trail |
| GitHub CLI | NO | — | no | Convenience only |
| SQLite | NO | — | no | Not used — storage is local JSON by design |
| ffmpeg | NO | — | no | Video validation and processing (Phase 4) |
| ImageMagick | NO | — | no | Thumbnail processing (Phase 4) |
| ImageMagick (legacy) | NO | — | no | Thumbnail processing fallback |
| cron | NO | — | no | Local scheduling |
| Claude Code | yes | 2.1.220 (Claude Code) | yes | Content generation backend (claude -p) |

All required tools present.

## Claude Code and MCP

- `claude` binary: present
- Non-interactive `claude -p`: assumed available (binary present)
- `claude mcp list`: succeeded

```text
No MCP servers configured. Use `claude mcp add` to add a server.
```

## Secrets

> Only key NAMES are inspected. No value is read, logged, or written by this audit.

- `.env` present: no
- `.env.example` present: yes
- Keys with a non-empty value in `.env`: 0

| Key | Configured |
|---|---|
| `APPROVAL_EXPIRY_HOURS` | no |
| `AUTOPUBLISH_ENABLED` | no |
| `BLOG_AUTOPUBLISH_ENABLED` | no |
| `EMAIL_AUTOSEND_ENABLED` | no |
| `FACEBOOK_AUTOPUBLISH_ENABLED` | no |
| `INSTAGRAM_AUTOPUBLISH_ENABLED` | no |
| `LINKEDIN_AUTOPUBLISH_ENABLED` | no |
| `LINKEDIN_VERSION` | no |
| `LLM_MODEL_CLASSIFICATION` | no |
| `LLM_MODEL_GENERATION` | no |
| `LLM_PROVIDER` | no |
| `META_GRAPH_VERSION` | no |
| `POSTHOG_HOST` | no |
| `PUBLISH_BACKEND` | no |
| `TIKTOK_AUTOPUBLISH_ENABLED` | no |
| `TIKTOK_PRIVACY_LEVEL` | no |
| `YOUTUBE_AUTOPUBLISH_ENABLED` | no |
| `YOUTUBE_PRIVACY_STATUS` | no |

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
