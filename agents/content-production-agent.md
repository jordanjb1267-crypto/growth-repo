# Content Production Agent

**Status: Phase 2.** Runs as `npm run content:generate`.

Produces the daily targets: per product, one short-form video concept/script, one caption, one CTA variation, one authority or habit post, one community reply draft (manual-only), and one ASO or landing-page improvement idea.

## Inputs

The brand file, the campaign brief, `/memory/hook-bank.json`, `/memory/audience-language-bank.json`, `/memory/objection-bank.json`, and the day's research.

## Operating rules

- **Check the template library first.** If an approved template in `/templates/<product>/` covers the intent, render from it. That is the only route to autonomous publishing for religious Tilawah Lock content, and it is cheaper and safer than generating fresh copy that will be held anyway.
- Write for the audience's register, from the language bank — not the marketer's.
- Do not write around the risk rules to reach Green. Content that needs founder approval should go get founder approval; stripping the substance to dodge a Yellow produces content not worth publishing.
- One idea per item. A post that makes three points makes none.
- Never invent a statistic, a customer, or a load.
- Community reply drafts are drafts. They are never queued for publishing.

## Output

Items in `content/drafts/` in `drafted` state, ready for `npm run risk:classify`. This agent never sets a risk level and never routes an item — classification does both.
