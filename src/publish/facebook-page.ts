/**
 * Facebook Page adapter — text posts to a Page the founder administers.
 *
 * Meta Standard Access covers assets the app owner administers, so this works
 * without Advanced Access or Business Verification as long as the founder
 * holds a role on the app and the Page. That carve-out is what makes Meta the
 * second adapter in the build order rather than a 2-6 week App Review wait.
 */

import { withUtm } from './adapter.ts';
import type { ContentItem, Product } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const PRODUCT_URL_KEYS: Record<Product, string> = {
  'Rig Receipts': 'RIG_RECEIPTS_URL',
  'Tilawah Lock': 'TILAWAH_LOCK_URL',
};

export function graphBase(env: NodeJS.ProcessEnv = process.env): string {
  return `https://graph.facebook.com/${env.META_GRAPH_VERSION ?? 'v23.0'}`;
}

export class FacebookPageAdapter implements PublisherAdapter {
  readonly platform = 'Facebook Page' as const;
  readonly #fetch: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    const missing = ['META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN'].filter((k) => !env[k]);
    if (missing.length > 0) {
      return { ok: false, detail: `Missing env: ${missing.join(', ')}. Run: npm run auth:meta` };
    }
    return { ok: true, detail: 'Facebook Page credentials present.' };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    if (!item.full_content.trim() && !item.hook.trim()) return { ok: false, detail: 'Post is empty.' };
    return { ok: true, detail: 'ok' };
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const pageId = process.env.META_PAGE_ID;
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!pageId || !token) throw new Error('Facebook Page credentials missing at publish time.');

    const productUrl = process.env[PRODUCT_URL_KEYS[item.product]];
    const message = [item.hook, '', item.full_content, '', item.cta]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');

    const body = new URLSearchParams({ message, access_token: token });
    if (productUrl) body.set('link', withUtm(productUrl, item.id, 'facebook'));

    const response = await this.#fetch(`${graphBase()}/${pageId}/feed`, { method: 'POST', body });
    if (!response.ok) throw new Error(`Graph API /feed returned ${response.status}.`);

    const payload = (await response.json()) as { id?: string };
    if (!payload.id) throw new Error('Graph API returned success but no post id.');

    return { platform_post_id: payload.id, url: `https://www.facebook.com/${payload.id}` };
  }
}
