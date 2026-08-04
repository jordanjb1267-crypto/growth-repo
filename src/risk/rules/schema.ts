/**
 * Rule schema for the deterministic classification pass.
 *
 * These rules are the floor of the risk system. They are intentionally
 * mechanical — regex over normalized text — so that a classification decision
 * can be reproduced and argued with months later. The model-produced scores
 * layer on top and can only ever make the outcome *more* severe.
 */

import type { Product, RiskLevel } from '../../lib/types.ts';

export interface Rule {
  /** Stable ID, recorded on every classification. Never renumber a shipped ID. */
  id: string;
  level: RiskLevel;
  category: string;
  /** Shown to the founder in the approval digest. Write it as the reason the
   *  content is being held, not as a description of the regex. */
  reason: string;
  /** `"*"` for both products, or specific product names. */
  applies_to: (Product | '*')[];

  /** Fires if ANY pattern matches. */
  patterns?: string[];
  /** Fires only if EVERY pattern matches somewhere in the text. Used for
   *  co-occurrence rules, e.g. a guarantee word near a financial outcome. */
  all_of?: string[];
  /** Suppresses the rule if any of these match. Used to let properly-sourced
   *  statistics through a rule that otherwise flags bare numbers. */
  none_of?: string[];

  /** Extra context for whoever maintains the rule. Not shown to the founder. */
  notes?: string;
}

export interface RuleFile {
  $schema_version: 1;
  rules: Rule[];
}

export function isRuleFile(value: unknown): value is RuleFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RuleFile>;
  return candidate.$schema_version === 1 && Array.isArray(candidate.rules);
}
