/**
 * Email adapter — Resend broadcasts.
 *
 * The one channel where a mistake is unrecoverable: a published post can be
 * deleted, a sent email cannot. The orchestrator therefore requires a founder
 * approval record on EVERY email item regardless of risk level, and the
 * EMAIL_AUTOSEND_ENABLED switch fails closed like all the others.
 *
 * Credentials are read from env inside each call and never logged.
 */

import { withUtm } from './adapter.ts';
import type { ContentItem, Product } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const RESEND_API = 'https://api.resend.com';

const PRODUCT_URL_KEYS: Record<Product, string> = {
  'Rig Receipts': 'RIG_RECEIPTS_URL',
  'Tilawah Lock': 'TILAWAH_LOCK_URL',
};

export class EmailAdapter implements PublisherAdapter {
  readonly platform = 'Email' as const;
  readonly #fetch: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    const missing = ['RESEND_API_KEY', 'EMAIL_FROM_ADDRESS', 'RESEND_AUDIENCE_ID'].filter((k) => !env[k]);
    if (missing.length > 0) {
      return { ok: false, detail: `Missing env: ${missing.join(', ')}. (Presence checked only; values never logged.)` };
    }
    return { ok: true, detail: 'Resend credentials present.' };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    if (!item.hook.trim()) return { ok: false, detail: 'Email needs a hook (it becomes the subject).' };
    if (item.hook.length > 150) return { ok: false, detail: 'Subject over 150 chars will truncate badly.' };
    if (!item.full_content.trim()) return { ok: false, detail: 'Email has an empty body.' };
    return { ok: true, detail: 'ok' };
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM_ADDRESS;
    const audience = process.env.RESEND_AUDIENCE_ID;
    if (!key || !from || !audience) throw new Error('Resend credentials missing at publish time.');

    const productUrl = process.env[PRODUCT_URL_KEYS[item.product]];
    const ctaLine = productUrl ? `${item.cta || item.product}: ${withUtm(productUrl, item.id, 'email')}` : item.cta;
    const text = [item.full_content, '', ctaLine].filter(Boolean).join('\n');

    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };

    const create = await this.#fetch(`${RESEND_API}/broadcasts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ audience_id: audience, from, subject: item.hook, text }),
    });
    if (!create.ok) throw new Error(`Resend broadcast create returned ${create.status}.`);

    const created = (await create.json()) as { id?: string };
    if (!created.id) throw new Error('Resend broadcast create returned no id.');

    const send = await this.#fetch(`${RESEND_API}/broadcasts/${created.id}/send`, {
      method: 'POST',
      headers,
    });
    if (!send.ok) {
      throw new Error(`Broadcast ${created.id} was created but send returned ${send.status} — check the Resend dashboard before retrying, or the list gets the email twice.`);
    }

    return { platform_post_id: created.id, url: null };
  }
}
