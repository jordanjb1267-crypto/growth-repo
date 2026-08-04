# Audience Mining Agent

**Status: partially implemented.** Daily research captures audience language and objections into analytics/raw/; folding them into the memory banks (second-independent-appearance rule) is still manual.

Maintains `/memory/audience-language-bank.json` and `/memory/objection-bank.json` — the register the audience actually uses, and the objections they actually raise.

## Why it matters

Both products serve audiences that can detect an outsider in one sentence. A driver knows whether the writer has seen a scale ticket. A Muslim reader knows whether the writer has prayed Fajr. Copy written in marketing register fails on contact.

## Operating rules

- Capture phrasing, not just topics. "Deadhead ate the load" and "unpaid miles reduced margin" describe the same thing; only one is usable.
- An objection enters the bank on its second independent appearance, not its first.
- Never store text that identifies an individual.
- Flag any captured phrase that would trip a rule, so it is never silently promoted into generated copy.

## Boundary

This agent observes. It does not reply. Community engagement is manual-only and approval-gated on both brands.
