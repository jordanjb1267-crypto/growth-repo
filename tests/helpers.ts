import type { CompletionRequest, CompletionResponse, LlmProvider } from '../src/llm/provider.ts';
import type { ContentItem, Platform, Product } from '../src/lib/types.ts';

/**
 * Provider stub. Lets a test decide what the rubric scorer returns, so
 * classification behaviour can be exercised without a model call.
 */
export function stubProvider(response: string): LlmProvider {
  return {
    name: 'stub',
    async complete(_request: CompletionRequest): Promise<CompletionResponse> {
      return { text: response, usage: null, model: 'stub' };
    },
    async healthCheck() {
      return { ok: true, detail: 'stub' };
    },
  };
}

/** A provider whose scores clear the threshold, so rule behaviour is isolated. */
export const passingScorer = stubProvider(
  '{"brand": 95, "platform_safety": 95, "strategic_quality": 92, "rationale": "stub pass"}',
);

/** A provider whose scores fail, to verify scores can hold otherwise-clean content. */
export const failingScorer = stubProvider(
  '{"brand": 95, "platform_safety": 95, "strategic_quality": 40, "rationale": "stub fail"}',
);

/** A provider that returns garbage, to verify the scorer fails closed. */
export const brokenScorer = stubProvider('I am not JSON.');

export function publishedItem(overrides: {
  id: string;
  product: Product;
  platform: Platform;
  hook: string;
  full_content: string;
  caption?: string;
}): ContentItem {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    product: overrides.product,
    platform: overrides.platform,
    campaign: 'Test Campaign',
    hook: overrides.hook,
    full_content: overrides.full_content,
    caption: overrides.caption ?? '',
    cta: '',
    asset_path: null,
    risk_level: 'green',
    approval_reason: '',
    recommended_action: '',
    status: 'published',
    created_at: now,
    updated_at: now,
    classification: null,
    template_id: null,
    template_slots: null,
    approval: null,
    platform_post_id: 'stub-post-id',
    published_at: now,
    founder_note: null,
  };
}

export function draftItem(overrides: Partial<ContentItem> & { id: string; product: Product }): ContentItem {
  const now = new Date().toISOString();
  return {
    platform: 'Instagram Reels',
    campaign: 'Test Campaign',
    hook: '',
    full_content: '',
    caption: '',
    cta: '',
    asset_path: null,
    risk_level: 'green',
    approval_reason: '',
    recommended_action: '',
    status: 'drafted',
    created_at: now,
    updated_at: now,
    classification: null,
    template_id: null,
    template_slots: null,
    approval: null,
    platform_post_id: null,
    published_at: null,
    founder_note: null,
    ...overrides,
  };
}
