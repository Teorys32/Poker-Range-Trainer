import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outputDir = join(root, '..', 'dist', 'public');
const indexPath = join(outputDir, 'index.html');
const standalonePath = join(outputDir, 'range-desk.html');

let html = await readFile(indexPath, 'utf8');
const matches = [];
const stylesheetPattern = /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi;
const scriptPattern = /<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;

for (const match of html.matchAll(stylesheetPattern)) {
  const tag = match[0];
  const asset = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
  if (asset) matches.push({ index: match.index ?? 0, tag, asset, kind: 'css' });
}
for (const match of html.matchAll(scriptPattern)) {
  matches.push({ index: match.index ?? 0, tag: match[0], asset: match[1], kind: 'js' });
}

for (const match of matches.sort((a, b) => b.index - a.index)) {
  if (match.asset.startsWith('http')) continue;
  const assetPath = join(outputDir, match.asset.replace(/^\//, ''));
  const source = await readFile(assetPath, 'utf8');
  if (match.kind === 'css') {
    const inlineCss = source.replace(/@import\s+url\([^;]+;?/g, '');
    html = html.replace(match.tag, `<style>${inlineCss}</style>`);
  } else {
    const safeSource = source.replace(/<\/script/gi, '<\\\\/script');
    html = html.replace(match.tag, `<script type="module">${safeSource}</script>`);
  }
}

html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/gi, '');
html = html.replace(/<link\b[^>]*\brel=["']preconnect["'][^>]*>\s*/gi, '');
html = html.replace(/<link\b[^>]*\bhref=["']https?:\/\/[^"']+["'][^>]*>\s*/gi, '');
html = html.replace(/<link\b[^>]*\brel=["']icon["'][^>]*>\s*/gi, '');
await writeFile(standalonePath, html, 'utf8');
console.log(`Standalone HTML written to ${standalonePath}`);