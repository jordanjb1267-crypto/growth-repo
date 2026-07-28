# Autonomous Organic Growth OS

Organic marketing system for **Rig Receipts** (trucking profitability) and **Tilawah Lock** (Islamic digital discipline). Runs locally from the founder's laptop. $0 ad spend.

`CLAUDE.md` is the governing spec. Everything here implements it; where implementation and spec conflicted, the conflict is documented in the Implementation Addendum at the bottom of that file rather than resolved silently.

**Phase 1 is complete. Nothing publishes yet, by design.**

## Setup

```bash
npm install
cp .env.example .env      # fill in as needed; all kill switches start off
npm run audit:connectors  # run this on the laptop that will operate the system
```

Requires Node 22.18+ (native TypeScript type stripping — there is no build step) and the `claude` CLI.

## Daily loop

```bash
npm run daily:research      # Phase 2 — not built
npm run content:generate    # Phase 2 — not built
npm run risk:classify       # works
npm run approval:digest     # works
npm run approve <id>        # works
npm run publish:approved    # gate works; adapters are Phase 4
```

Commands belonging to later phases exit with an error rather than doing nothing — a scheduled command that silently no-ops looks identical to a working one in a cron log.

## How content moves

```
drafted → brand_checked → risk_classified → ┬→ auto_publish_ready → scheduled → published → …
                                            ├→ awaiting_founder_approval
                                            └→ blocked (terminal)
```

Founder actions from the queue: `approve`, `reject`, `block`, `edit`. An edit routes to `edited`, whose only onward edge is back to `brand_checked` — editing cannot skip re-classification.

`src/state/machine.ts` holds the transition table, and `transition()` is the only function permitted to write an item's status. Every move is appended to `logs/state-transitions.jsonl` before the item is persisted.

## How risk is decided

```
deterministic rules → duplicate check → model rubric scores → MOST SEVERE WINS
```

The model can only make the outcome worse. There is no path by which a high score lifts content past a triggered rule, and a scoring failure yields Yellow rather than Green.

- **Rules** (`src/risk/rules/*.json`) — versioned regex lexicons with stable IDs, derived from the spec's hard constraints. Every hit is recorded with the text that matched it.
- **Duplicates** (`src/risk/dedup.ts`) — 5-gram shingle Jaccard against published content, scoped to the same product *and* platform. Cross-posting one video to three platforms is not spam; repeating yourself on one platform is.
- **Scores** (`src/risk/score.ts`) — brand, platform-safety, and strategic-quality on a 0–100 scale with published anchors. All three must reach 85.

## Tilawah Lock and the template library

Tilawah Lock's promise is "Pray. Read. Then Unlock.", so nearly all on-brand content mentions Salah or Quran and trips the approval gate. That gate is correct and is not loosened.

The route to autonomy is `/templates/tilawah-lock/`. The founder approves a piece of religious framing once; instances render from it automatically, but only while three conditions all hold:

1. Byte-identical to the template outside declared slots.
2. Every slot value independently passes the full rule pass.
3. The template hash still matches the approved record.

Any drift falls back to normal approval. Red rules are never discounted by an exemption. After editing or approving a template, re-seal it: `npm run seal:template -- --all`.

## Safety posture

- **Kill switches fail closed.** Only the exact string `"true"` enables publishing. `TRUE`, `1`, `yes`, unset, and typos are all disabled. Checked inside the publisher adapter, not the calling script.
- **Reddit, Facebook Groups, and X have no publish path at all** — not a switch defaulting to off, no code path.
- **Secrets** — `.env` is gitignored, and the audit reports key *presence* only. There is no code path in which a secret value is read into a variable that could be logged.

## Verify

```bash
npm run typecheck   # tsc --noEmit
npm test            # 56 tests
```

Covers: every illegal state transition throws; edits re-enter classification; blocked is terminal; scores cannot override rules; the scorer fails closed; template integrity in all its failure modes; and kill switches under every malformed value.

## Layout

| Path | |
|---|---|
| `CLAUDE.md` | Governing spec + implementation addendum |
| `/audit` | Connector and environment audit output |
| `/agents` | Role definitions; two are implemented as code, not prompts |
| `/brands`, `/campaigns` | Brand constraints and campaign briefs |
| `/templates` | Founder-approved, hash-sealed templates |
| `/content` | Items, in directories matching their state |
| `/memory` | The six learning banks |
| `/src/risk` | Rules, dedup, scoring, classification |
| `/src/state` | The state machine |
| `/src/llm` | Provider interface (`claude-cli` now, API backend stubbed) |

## Cost

Content generation runs through `claude -p` on the existing subscription — no marginal token cost. The modeled cost of the Anthropic API path, and the three levers that shape it, are documented at the top of `src/llm/anthropic-api.ts` and in CLAUDE.md addendum A8.
