#!/usr/bin/env node
/**
 *   npm run site:build
 *
 * Renders site/posts/*.md to site/dist/ and copies assets/ alongside. Deploy
 * site/dist to any static host (Cloudflare Pages build command: this script).
 * Point ASSET_BASE_URL at https://<host>/assets once deployed.
 */

import { buildSite } from '../site/build.ts';

const result = buildSite();
console.log(`Built site/dist — ${result.posts} post(s), index, and the assets/ mirror.`);
