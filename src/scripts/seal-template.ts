#!/usr/bin/env node
/**
 * Re-seal a template: recompute its content hash and write it back.
 *
 * Run this after the founder approves a new template or deliberately edits an
 * existing one. Until a template is sealed, its hash will not match and
 * renderTemplate() refuses the exemption — which is the intended behaviour, not
 * a bug to work around.
 *
 *   npm run seal:template -- tilawah-lock TL-QURAN-LOCK-PRELAUNCH-001
 *   npm run seal:template -- --all
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../lib/paths.ts';
import { computeTemplateHash, type Template } from '../templates/template.ts';

function sealFile(file: string): { id: string; changed: boolean; hash: string } {
  const template = JSON.parse(readFileSync(file, 'utf8')) as Template;
  const hash = computeTemplateHash(template);
  const changed = template.content_hash !== hash;

  if (changed) {
    template.content_hash = hash;
    writeFileSync(file, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  }
  return { id: template.id, changed, hash };
}

function main(): void {
  const args = process.argv.slice(2);
  const files: string[] = [];

  if (args[0] === '--all' || args.length === 0) {
    for (const slug of readdirSync(paths.templates)) {
      const dir = join(paths.templates, slug);
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.json')) files.push(join(dir, file));
      }
    }
  } else {
    const [slug, id] = args;
    if (!slug || !id) {
      console.error('Usage: seal-template <product-slug> <template-id>   |   seal-template --all');
      process.exit(1);
    }
    files.push(join(paths.templates, slug, `${id}.json`));
  }

  if (files.length === 0) {
    console.log('No templates found.');
    return;
  }

  for (const file of files) {
    const { id, changed, hash } = sealFile(file);
    console.log(`${changed ? 'sealed  ' : 'ok      '} ${id}  ${hash.slice(0, 16)}…`);
  }
}

main();
