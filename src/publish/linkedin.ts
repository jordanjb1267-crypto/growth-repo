/**
 * LinkedIn adapter — personal profile posts via the versioned Posts API.
 *
 * First in the Phase 4 build order because it is the only social channel with
 * no review gate: the self-serve "Share on LinkedIn" product grants
 * w_member_social. Text posts only for now — the founder-authority format this
 * channel carries.
 *
 * Auth note: self-serve LinkedIn tokens live ~60 days and cannot be refreshed
 * programmatically without partner approval. When validateAuth starts failing,
 * re-run `npm run auth:linkedin`.
 */

import type { ContentItem } from '../lib/types.ts';
import type { PublishOutput, PublisherAdapter } from './adapter.ts';

const API = 'https://api.linkedin.com/rest/posts';
const COMMENTARY_LIMIT = 3000;

export class LinkedInAdapter implements PublisherAdapter {
  readonly platform = 'LinkedIn' as const;
  readonly #fetch: typeof fetch;

  constructor(options: { fetchImpl?: typeof fetch } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async validateAuth(env: NodeJS.ProcessEnv): Promise<{ ok: boolean; detail: string }> {
    const missing = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_MEMBER_URN'].filter((k) => !env[k]);
    if (missing.length > 0) {
      return { ok: false, detail: `Missing env: ${missing.join(', ')}. Run: npm run auth:linkedin` };
    }
    if (!env.LINKEDIN_MEMBER_URN?.startsWith('urn:li:person:')) {
      return { ok: false, detail: 'LINKEDIN_MEMBER_URN must look like urn:li:person:<id>. Re-run: npm run auth:linkedin' };
    }
    return { ok: true, detail: 'LinkedIn credentials present (60-day token — re-run auth:linkedin when it expires).' };
  }

  validateContent(item: ContentItem): { ok: boolean; detail: string } {
    const commentary = buildCommentary(item);
    if (!commentary.trim()) return { ok: false, detail: 'Post is empty.' };
    if (commentary.length > COMMENTARY_LIMIT) {
      return { ok: false, detail: `Post is ${commentary.length} chars; LinkedIn commentary caps at ${COMMENTARY_LIMIT}.` };
    }
    return { ok: true, detail: 'ok' };
  }

  async publish(item: ContentItem): Promise<PublishOutput> {
    const token = process.env.LINKEDIN_ACCESS_TOKEN;
    const author = process.env.LINKEDIN_MEMBER_URN;
    if (!token || !author) throw new Error('LinkedIn credentials missing at publish time.');

    const response = await this.#fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'LinkedIn-Version': process.env.LINKEDIN_VERSION ?? '202506',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author,
        commentary: buildCommentary(item),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });

    if (response.status === 401) {
      throw new Error('LinkedIn returned 401 — the 60-day token has likely expired. Re-run: npm run auth:linkedin');
    }
    if (!response.ok) throw new Error(`LinkedIn Posts API returned ${response.status}.`);

    // The created post URN arrives in a response header, not the body.
    const postUrn = response.headers.get('x-restli-id');
    if (!postUrn) throw new Error('LinkedIn returned success but no x-restli-id header.');

    return { platform_post_id: postUrn, url: `https://www.linkedin.com/feed/update/${postUrn}/` };
  }
}

function buildCommentary(item: ContentItem): string {
  return [item.hook, '', item.full_content, '', item.cta].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');
}
