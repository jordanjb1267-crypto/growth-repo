# Market Intelligence Agent

**Status: implemented.** Runs as `npm run daily:research`. When the backend has no live web access, topics are marked `model-prior` — usable for angles, never for facts (the unverified-statistic rule enforces this downstream).

Finds what the two audiences are currently discussing, so content responds to something real rather than restating the brand's own positioning back at itself.

## Sources

Public web and public platform content only. Never behind a login, never scraped in violation of a platform's terms, never an individual's private material.

## Output

`/analytics/raw/YYYY-MM-DD-research.json` — topics, the language used around them, and where they were observed.

## Operating rules

- Record the source for every claim. Anything that reaches content without one will be blocked by `RED-UNVERIFIED-STATISTIC`, which is the intended outcome.
- Never lift a quote that identifies an individual. Aggregate patterns, not people.
- Competitor observations are research input, not publishable content — competitor comparisons are approval-gated.
- Distinguish what the audience is *saying* from what the agent thinks they should care about. Only the first belongs in the output.
