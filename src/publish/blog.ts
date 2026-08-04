/**
 * Blog adapter — the first real publisher, and deliberately the simplest:
 * "publishing" is writing a markdown post into the site directory and, when a
 * deploy hook is configured, POSTing it (no body, no secrets in the URL log).
 *
 * Owned channel: no platform policy risk, no review gate. This is where the
 * publish loop gets proven before any social adapter exists.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../lib/paths.ts';
import { withUtm } from './adapter.ts';
import type { ContentItem, Product } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const PRODUCT_URL_KEYS: Record<Product, string> = {
  'Rig Receipts': 'RIG_RECEIPTS_URL',
  'Tilawah Lock': 'TILAWAH_LOCK_URL',
};

function frontmatterEscape(value: string): string {
  return value.replace(/"/g, '\\"');
}

export class BlogAdapter implements PublisherAdapter {
  readonly platform = 'Blog' as const;
  readonly #postsDir: string;
  readonly #fetch: typeof fetch;

  constructor(options: { postsDir?: string; fetchImpl?: typeof fetch } = {}) {
    this.#postsDir = options.postsDir ?? join(REPO_ROOT, 'site', 'posts');
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    const hook = env.BLOG_DEPLOY_HOOK_URL;
    if (hook && !hook.startsWith('https://')) {
      return { ok: false, detail: 'BLOG_DEPLOY_HOOK_URL is set but is not https.' };
    }
    return { ok: true, detail: hook ? 'Deploy hook configured.' : 'Local write only; no deploy hook set.' };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    if (!item.hook.trim()) return { ok: false, detail: 'Blog post needs a hook (it becomes the title).' };
    if (!item.full_content.trim()) return { ok: false, detail: 'Blog post has an empty body.' };
    return { ok: true, detail: 'ok' };
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const slug = `${item.published_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)}-${item.id.toLowerCase()}`;
    const file = join(this.#postsDir, `${slug}.md`);

    if (existsSync(file)) {
      throw new Error(`Post ${slug} already exists — refusing to overwrite a published post.`);
    }

    const productUrl = process.env[PRODUCT_URL_KEYS[item.product]];
    const ctaLink = productUrl ? withUtm(productUrl, item.id, 'blog') : null;

    const post = [
      '---',
      `title: "${frontmatterEscape(item.hook)}"`,
      `date: ${new Date().toISOString()}`,
      `product: "${item.product}"`,
      `campaign: "${frontmatterEscape(item.campaign)}"`,
      `content_id: ${item.id}`,
      '---',
      '',
      item.full_content,
      '',
      item.caption ? `*${item.caption}*` : '',
      '',
      ctaLink ? `[${item.cta || item.product}](${ctaLink})` : item.cta,
      '',
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');

    mkdirSync(this.#postsDir, { recursive: true });
    writeFileSync(file, post, 'utf8');

    const hook = process.env.BLOG_DEPLOY_HOOK_URL;
    if (hook) {
      const response = await this.#fetch(hook, { method: 'POST' });
      if (!response.ok) {
        // The post file exists but the deploy didn't fire — surface as failure
        // so the item lands in publish_failed and the founder sees it, rather
        // than reading "published" for a page that is not live.
        throw new Error(`Deploy hook returned ${response.status}.`);
      }
    }

    return { platform_post_id: slug, url: null };
  }
}
