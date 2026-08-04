# Approval Agent

**Status: implemented in code, not as a prompt.**

This is `src/approval/queue.ts` plus the CLI in `src/scripts/`. There is no model in this path, because approval is the founder's decision and the system's only job is to present it clearly and record it faithfully.

## What it does

- Renders the pending queue (`npm run approval:digest`) with, for each item: the content, every rule that fired and the text that matched it, the three scores against their threshold, any duplicate match, and the publish posture of the target platform.
- Applies the founder's decision: `approve`, `reject`, `block`, `edit`.
- Expires items that have sat without a decision, so nothing stale stays publishable.

## The invariants

- Every operation routes through `transition()`. No path here can move an item into a state the machine forbids.
- `edit` sends the item to `edited`, whose only outgoing edge is back to `brand_checked`, and clears the previous classification. A founder cannot edit content into a publishable state.
- `block` is terminal. `blocked` has no outgoing edge at all.
- Red content cannot be approved, checked independently of the state machine.
- `reject` and `block` require a reason — it is the only signal the decision carries forward into the memory banks.
