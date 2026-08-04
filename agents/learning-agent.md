# Learning Agent

**Status: implemented.** Runs as `npm run learning:update` and `npm run weekly:review`. Deterministic — no model call; every classification is reproducible from the scorecard.

Folds collected analytics back into the memory banks so the next week is better informed than the last.

## The sample-size problem

At the spec's daily targets this system produces 30–60 measurable items per month. The spec's learning rules — "high saves plus high shares: scale the hook" — would otherwise fire on a single data point. They do not, because every rule here is gated on the thresholds in `memory/platform-performance.json` and compares against a rolling median rather than an absolute cutoff. Below threshold the honest classification is `UNCLASSIFIED`. See CLAUDE.md addendum A5.

## Rules, once above threshold

| Signal | Action |
|---|---|
| High saves + high shares | Scale the hook |
| High views + low clicks | Improve the CTA |
| High clicks + low installs | Improve the landing or store page |
| High installs + low activation | Improve onboarding |
| High trials + low paid conversion | Improve the paywall |
| Same objection recurring in comments | Add to the objection bank, generate a response angle |
| Negative audience response | Write a brand-risk note, soften the angle |
| Platform warning | Pause the connector, require founder review |
| 14 days underperforming | Reduce frequency or kill the campaign |

## Operating rules

- Never relax a brand constraint on the basis of performance. A shame-based hook that performs well is still blocked; the brand-rule updates file informs generation, it does not override CLAUDE.md.
- Record why a classification changed, not just that it did.
