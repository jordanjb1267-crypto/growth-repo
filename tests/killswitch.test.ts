import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPublishAllowed, DRAFT_ONLY_PLATFORMS, GLOBAL_SWITCH } from '../src/lib/killswitch.ts';
import { PLATFORMS } from '../src/lib/types.ts';

const ON = { AUTOPUBLISH_ENABLED: 'true', INSTAGRAM_AUTOPUBLISH_ENABLED: 'true' } as NodeJS.ProcessEnv;

describe('kill switches', () => {
  it('refuses when the environment is empty', () => {
    const check = checkPublishAllowed('Instagram Reels', {});
    assert.equal(check.allowed, false);
    assert.match(check.reason, new RegExp(GLOBAL_SWITCH));
  });

  it('allows only when both the global and platform switch are exactly "true"', () => {
    assert.equal(checkPublishAllowed('Instagram Reels', ON).allowed, true);

    assert.equal(
      checkPublishAllowed('Instagram Reels', { ...ON, AUTOPUBLISH_ENABLED: 'false' }).allowed,
      false,
      'the global switch alone must be able to stop everything',
    );
    assert.equal(
      checkPublishAllowed('Instagram Reels', { ...ON, INSTAGRAM_AUTOPUBLISH_ENABLED: undefined }).allowed,
      false,
      'a missing platform switch must not fall back to enabled',
    );
  });

  it('treats every truthy-looking value other than exactly "true" as disabled', () => {
    // The whole point of failing closed: a typo or a well-intentioned "1"
    // must not publish to a real audience.
    for (const value of ['TRUE', 'True', '1', 'yes', 'on', 'enabled', ' true', 'true ', '']) {
      const check = checkPublishAllowed('Instagram Reels', {
        AUTOPUBLISH_ENABLED: value,
        INSTAGRAM_AUTOPUBLISH_ENABLED: 'true',
      });
      assert.equal(check.allowed, false, `"${value}" must not enable publishing`);
    }
  });

  it('refuses draft-only platforms even with every switch on', () => {
    for (const platform of DRAFT_ONLY_PLATFORMS) {
      const check = checkPublishAllowed(platform, {
        AUTOPUBLISH_ENABLED: 'true',
        YOUTUBE_AUTOPUBLISH_ENABLED: 'true',
        TIKTOK_AUTOPUBLISH_ENABLED: 'true',
        INSTAGRAM_AUTOPUBLISH_ENABLED: 'true',
        FACEBOOK_AUTOPUBLISH_ENABLED: 'true',
        LINKEDIN_AUTOPUBLISH_ENABLED: 'true',
        BLOG_AUTOPUBLISH_ENABLED: 'true',
        EMAIL_AUTOSEND_ENABLED: 'true',
      });
      assert.equal(check.allowed, false, `${platform} is draft-only and must never publish`);
      assert.match(check.reason, /draft-only/);
    }
  });

  it('defaults every platform to refused under a blank environment', () => {
    for (const platform of PLATFORMS) {
      assert.equal(checkPublishAllowed(platform, {}).allowed, false, `${platform} should default to refused`);
    }
  });
});
