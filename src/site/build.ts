/**
 * Static site builder — zero dependencies, renders site/posts/*.md to
 * site/dist/. Deployable to any static host; the same host then serves
 * /assets, which is exactly what Instagram's pull-from-URL publishing needs
 * (point ASSET_BASE_URL at https://<host>/assets).
 *
 * The markdown renderer is intentionally minimal: it covers the constructs the
 * blog adapter emits (headings, paragraphs, bold, italic, links) and escapes
 * everything else. It is not a general markdown engine and should not become
 * one — posts are our own generated format.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../lib/paths.ts';

export interface Post {
  slug: string;
  title: string;
  date: string;
  product: string;
  campaign: string;
  content_id: string;
  body: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Inline markdown AFTER escaping, so markup can only come from our syntax. */
function renderInline(escaped: string): string {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderMarkdown(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
      if (heading) {
        const level = heading[1]?.length ?? 1;
        return `<h${level + 1}>${renderInline(escapeHtml(heading[2] ?? ''))}</h${level + 1}>`;
      }
      return `<p>${renderInline(escapeHtml(trimmed)).replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');
}

export function parsePost(filename: string, raw: string): Post | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!match) return null;

  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv?.[1] && kv[2] !== undefined) meta[kv[1]] = kv[2].replace(/^"|"$/g, '').replace(/\\"/g, '"');
  }

  return {
    slug: filename.replace(/\.md$/, ''),
    title: meta.title ?? filename,
    date: meta.date ?? '',
    product: meta.product ?? '',
    campaign: meta.campaign ?? '',
    content_id: meta.content_id ?? '',
    body: match[2] ?? '',
  };
}

const STYLE = `
  body { max-width: 44rem; margin: 2rem auto; padding: 0 1rem; font: 17px/1.6 Georgia, serif; color: #222; }
  @media (prefers-color-scheme: dark) { body { background: #14120f; color: #ddd; } a { color: #e8a15c; } }
  h1, h2, h3 { line-height: 1.25; } a { color: #a4501e; }
  .meta { color: #888; font-size: 0.85em; } li { margin: 0.4rem 0; }
`.trim();

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
<body>
${body}
</body>
</html>
`;
}

export function buildSite(
  postsDir = join(REPO_ROOT, 'site', 'posts'),
  outDir = join(REPO_ROOT, 'site', 'dist'),
  assetsDir = join(REPO_ROOT, 'assets'),
): { posts: number } {
  const posts: Post[] = [];
  if (existsSync(postsDir)) {
    for (const file of readdirSync(postsDir).filter((f) => f.endsWith('.md')).sort().reverse()) {
      const post = parsePost(file, readFileSync(join(postsDir, file), 'utf8'));
      if (post) posts.push(post);
    }
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'posts'), { recursive: true });

  for (const post of posts) {
    const html = page(
      post.title,
      [
        `<p class="meta"><a href="../index.html">← All posts</a></p>`,
        `<h1>${escapeHtml(post.title)}</h1>`,
        `<p class="meta">${escapeHtml(post.product)} · ${escapeHtml(post.campaign)} · ${escapeHtml(post.date.slice(0, 10))}</p>`,
        renderMarkdown(post.body),
      ].join('\n'),
    );
    writeFileSync(join(outDir, 'posts', `${post.slug}.html`), html, 'utf8');
  }

  const index = page(
    'Posts',
    [
      '<h1>Posts</h1>',
      posts.length === 0 ? '<p>Nothing published yet.</p>' : '<ul>',
      ...posts.map(
        (p) =>
          `<li><a href="posts/${encodeURIComponent(p.slug)}.html">${escapeHtml(p.title)}</a> <span class="meta">— ${escapeHtml(p.product)}, ${escapeHtml(p.date.slice(0, 10))}</span></li>`,
      ),
      posts.length === 0 ? '' : '</ul>',
    ].join('\n'),
  );
  writeFileSync(join(outDir, 'index.html'), index, 'utf8');

  // Serve assets/ from the same host so ASSET_BASE_URL can point at
  // https://<host>/assets for Instagram's pull-from-URL flow.
  if (existsSync(assetsDir)) {
    cpSync(assetsDir, join(outDir, 'assets'), { recursive: true });
  }

  return { posts: posts.length };
}
