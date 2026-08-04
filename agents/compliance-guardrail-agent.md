# Compliance Guardrail Agent

**Status: implemented in code, not as a prompt.**

This role is deliberately not an LLM agent. It is `src/risk/` — a deterministic rule pass over versioned lexicons, plus a duplicate check, plus a rubric scorer whose output can only ever make a decision *more* severe.

## Why it is code

The spec gates auto-publishing on this role. A prompt-based guardrail can be argued with, drifts between model versions, and leaves no reconstructable record of why a decision went the way it did. A rule ID in a JSON file can be read, tested, and disagreed with months later.

## What it does

1. **Rule pass** (`src/risk/evaluate.ts`) — regex over normalized text against `src/risk/rules/*.json`. Returns every hit, not just the most severe.
2. **Duplicate check** (`src/risk/dedup.ts`) — 5-gram shingle Jaccard against published content, scoped to the same product and platform.
3. **Rubric scores** (`src/risk/score.ts`) — the one model call, producing brand / platform-safety / strategic-quality on a 0–100 scale with published anchors.
4. **Combination** (`src/risk/classify.ts`) — most severe wins. A failed or unparseable score yields Yellow, never Green.

## The invariants

- A model score can never lift content above a triggered rule.
- A template exemption can discount Yellow hits, never Red ones.
- Every hit is recorded, including ones the exemption discounted.

## Changing it

Rules live in `src/risk/rules/`. Add a rule by adding an entry with a new stable ID; never renumber a shipped ID, because classification records reference it. Every pattern is compile-checked and every rule set is duplicate-ID-checked by `tests/risk.test.ts`.
