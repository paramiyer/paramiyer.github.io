#!/usr/bin/env node
/**
 * validate.mjs — structural checks over the built site.
 *
 * Not a test framework. A list of invariants that, if broken, would ship a real
 * defect: duplicate metadata, an unresolvable link, a page missing from the
 * sitemap, a jobTitle assertion the evidence does not support, or a client name
 * leaking onto a public page.
 *
 * Run after the generators:
 *   node scripts/build-pages.mjs && node scripts/build-stats.mjs && node scripts/validate.mjs
 *
 * Exits non-zero on any failure so it can gate CI.
 */

import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://paramiyer.github.io/';

/* Names that must never appear on a public page. Employers are fine — they are
 * on the CV. Clients, client systems and ticket ids are not. */
const FORBIDDEN = [
  /first abu dhabi/i, /\bFAB[_ ]/i, /quantumleap/i, /\bLEAP\b/,
  /TASK-\d+/, /dev\.azure\.com/i, /abfss:\/\//i, /\bPR #\d+/,
];

const pass = [];
const fail = [];
const ok = (m) => pass.push(m);
const bad = (m) => fail.push(m);

const exists = (p) => access(join(ROOT, p)).then(() => true, () => false);
const pick = (h, re) => { const m = h.match(re); return m ? m[1] : null; };

async function main() {
  const stats = JSON.parse(await readFile(join(ROOT, 'data/github-stats.json'), 'utf8'));
  const sitemap = await readFile(join(ROOT, 'sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  const routes = locs.map((l) => l.replace(SITE, ''));
  const files = routes.map((r) => (r === '' ? 'index.html' : `${r}index.html`));

  // 1. every sitemap URL has a file on disk
  for (const [i, f] of files.entries()) {
    (await exists(f)) ? ok(`file exists for ${locs[i]}`) : bad(`sitemap lists ${locs[i]} but ${f} is missing`);
  }

  const pages = [];
  for (const [i, f] of files.entries()) {
    if (!(await exists(f))) continue;
    pages.push({ file: f, route: routes[i], html: await readFile(join(ROOT, f), 'utf8') });
  }

  // 2. unique title, unique description, correct canonical, exactly one h1
  const titles = new Map(), descs = new Map();
  for (const p of pages) {
    const t = pick(p.html, /<title>([^<]*)<\/title>/);
    const d = pick(p.html, /<meta name="description" content="([^"]*)"/);
    const c = pick(p.html, /<link rel="canonical" href="([^"]*)"/);
    const h1 = (p.html.match(/<h1[ >]/g) || []).length;

    if (!t) bad(`${p.file}: no <title>`);
    else if (titles.has(t)) bad(`${p.file}: duplicate title, shared with ${titles.get(t)}`);
    else titles.set(t, p.file);

    if (!d) bad(`${p.file}: no meta description`);
    else if (descs.has(d)) bad(`${p.file}: duplicate description, shared with ${descs.get(d)}`);
    else descs.set(d, p.file);

    const want = SITE + p.route;
    if (c !== want) bad(`${p.file}: canonical is "${c}", expected "${want}"`);
    if (h1 !== 1) bad(`${p.file}: ${h1} <h1> elements, expected exactly 1`);
    if (!/property="og:image"/.test(p.html)) bad(`${p.file}: no og:image`);
  }
  ok(`${pages.length} pages have unique titles and descriptions, correct canonicals and one h1 each`);

  // 3. JSON-LD parses, and no jobTitle / worksFor is asserted anywhere
  for (const p of pages) {
    for (const m of p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const g = JSON.parse(m[1]);
        const s = JSON.stringify(g);
        if (/"jobTitle"/.test(s)) bad(`${p.file}: asserts jobTitle — positioning is not a held title`);
        if (/"worksFor"/.test(s)) bad(`${p.file}: asserts worksFor — current employment is not asserted`);
      } catch (e) {
        bad(`${p.file}: JSON-LD does not parse — ${e.message}`);
      }
    }
  }
  ok('all JSON-LD parses; no jobTitle or worksFor asserted');

  // 4. every relative internal link resolves to a real file
  let checked = 0;
  for (const p of pages) {
    const base = p.route;
    for (const m of p.html.matchAll(/href="(?!https?:|mailto:|#)([^"]+)"/g)) {
      const href = m[1];
      const target = posix.normalize(posix.join(base, href));
      const cand = target.endsWith('/') || target === '' ? `${target}index.html` : target;
      checked++;
      if (!(await exists(cand))) bad(`${p.file}: link "${href}" resolves to ${cand}, which does not exist`);
    }
  }
  ok(`${checked} internal links resolve`);

  // 5. no client identifiers on generated pages (index.html may name employers)
  for (const p of pages.filter((x) => x.file !== 'index.html')) {
    for (const re of FORBIDDEN) {
      if (re.test(p.html)) bad(`${p.file}: matches forbidden pattern ${re}`);
    }
  }
  ok('no client identifiers on generated pages');

  // 6. the product count claimed matches the number listed
  const groups = [...pages[0].html.matchAll(/class="pcount">(\d+)</g)].map((m) => Number(m[1]));
  const total = groups.reduce((a, b) => a + b, 0);
  const tile = Number(pick(pages[0].html, /data-count="(\d+)">\d+<\/div>\s*<div class="metric-l">Products/));
  if (groups.length && total !== tile) bad(`homepage: product groups sum to ${total} but the tile says ${tile}`);
  else ok(`product count is consistent: groups sum to ${total}, tile says ${tile}`);

  // 6b. any "N products" claim in prose must match the tile
  const tileN = Number(pick(pages[0].html, /data-count="(\d+)">\d+<\/div>\s*<div class="metric-l">Products/));
  for (const m of pages[0].html.matchAll(/<b>(\d+) products<\/b>/g)) {
    if (Number(m[1]) !== tileN) {
      bad(`homepage: prose claims "${m[1]} products" but the tile says ${tileN}`);
    }
  }
  if (tileN) ok(`prose product claims agree with the tile (${tileN})`);

  // 6c. Consent Mode defaults must precede the gtag library and config on every
  // page. A default declared after config arrives too late to gate the first hit,
  // which is a silent compliance failure - the page looks correct and is not.
  for (const p of pages) {
    const c = p.html.indexOf("gtag('consent', 'default'");
    const lib = p.html.indexOf('googletagmanager.com/gtag/js');
    const cfg = p.html.indexOf("gtag('config'");
    if (lib === -1) continue;                       // no analytics on this page is fine
    if (c === -1) { bad(`${p.file}: loads gtag.js with no Consent Mode default`); continue; }
    if (!(c < lib && lib < cfg)) {
      bad(`${p.file}: consent default must come before gtag.js and config (got ${c}, ${lib}, ${cfg})`);
    }
  }
  ok('Consent Mode defaults precede the tag on every page that loads it');

  // 7. activity numbers are present and non-zero
  if (!stats.activity || !stats.activity.commits) bad('activity snapshot missing or zero');
  else ok(`activity present: ${stats.activity.commits} commits (${stats.activity.scope})`);

  console.log(pass.map((m) => `  ok   ${m}`).join('\n'));
  if (fail.length) {
    console.error('\n' + fail.map((m) => `  FAIL ${m}`).join('\n'));
    console.error(`\n${fail.length} failure(s)`);
    process.exit(1);
  }
  console.log(`\n${pass.length} checks passed, 0 failures`);
}

main().catch((err) => {
  console.error(`validate failed: ${err.message}`);
  process.exit(1);
});
