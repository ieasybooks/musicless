// The About, Privacy policy, Terms of use and Contact & support pages.
// pages.txt holds their approved text, one block per page and language. In a
// block, line 1 is the title, line 2 the lead paragraph, "## " starts a section
// heading and every other line is a paragraph. Links are [label](href);
// tab:<page> links to that page in the same language.
import { readFileSync } from 'node:fs';

export const slugs = ['about', 'privacy', 'terms', 'support'];
// The pages that show their "Last updated" line.
export const dated = ['privacy', 'terms'];

const escape = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const link = /\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parsePages(text) {
  const pages = {};
  for (const block of text.split(/^===== /m).slice(1)) {
    const [header, ...rest] = block.split('\n');
    const [, slug, lang] = header.split(' / ').map(part => part.trim());
    const lines = rest.filter(line => line.trim());
    if (!slugs.includes(slug) || lines.length < 3) throw new Error('Unexpected page block: ' + header);
    pages[lang] ??= {};
    if (pages[lang][slug]) throw new Error('Duplicate page block: ' + header);
    pages[lang][slug] = { title: lines[0], lead: lines[1], body: lines.slice(2) };
  }
  for (const lang of ['en', 'ar']) for (const slug of slugs) {
    if (!pages[lang]?.[slug]) throw new Error(`pages.txt has no ${slug} page in ${lang}`);
  }
  return pages;
}

// Text to HTML, with [label](href) as links.
export function inline(text, lang) {
  if (text.replace(link, '').includes('](')) throw new Error('Malformed link in: ' + text);
  let html = '', at = 0;
  for (const match of text.matchAll(link)) {
    let href = match[2];
    if (href.startsWith('tab:')) {
      if (!slugs.includes(href.slice(4))) throw new Error('Unknown page link: ' + href);
      href = `/${lang}/${href.slice(4)}`;
    }
    html += escape(text.slice(at, match.index)) + `<a href="${escape(href)}">${escape(match[1])}</a>`;
    at = match.index + match[0].length;
  }
  return html + escape(text.slice(at));
}

export const plain = text => text.replace(link, '$1');

export function pageBody(page, lang, updated) {
  return [
    `<h1>${inline(page.title, lang)}</h1>`,
    `<p class="lead">${inline(page.lead, lang)}</p>`,
    ...(updated ? [`<p class="updated">${updated}</p>`] : []),
    ...page.body.map(line => line.startsWith('## ')
      ? `<h2>${inline(line.slice(3), lang)}</h2>`
      : `<p>${inline(line, lang)}</p>`),
  ].join('\n    ');
}

export const pages = parsePages(readFileSync(new URL('./pages.txt', import.meta.url), 'utf8'));
