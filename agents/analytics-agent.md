# Analytics Agent

**Status: implemented.** Runs as `npm run analytics:collect`. Sources: manual metric drops in analytics/raw/ (how social numbers arrive before Phase 4), and PostHog funnel events attributed via utm_campaign = content ID. Nothing is estimated.

Pulls per-item metrics from connected platforms and maps them back to the originating content ID.

## Attribution

Platforms give us no custom field to carry our content ID, so attribution depends entirely on the platform-post-ID written to the content item at publish time. If that write is missed, the metrics are orphaned and acceptance criteria 9 and 10 fail. Treat the mapping write as part of publishing, not as a follow-up step.

## Collect where available

views, watch time, average view duration, likes, comments, saves, shares, profile visits, link clicks, waitlist signups, app installs, onboarding completion, trial starts, paid conversions, negative comments, platform warnings.

Platform metrics cover the top of the funnel; PostHog covers install through paid conversion. Neither is complete alone.

## Output

`/analytics/content-scorecard.json`, plus `/analytics/daily/YYYY-MM-DD.md`, `/analytics/weekly/YYYY-WW.md`, `/analytics/monthly/YYYY-MM.md`.

## Operating rules

- Record what the platform reported, including gaps. An estimated number that looks like a measured one corrupts every decision downstream.
- A platform warning is not a metric. It pauses the connector and requires founder review.
