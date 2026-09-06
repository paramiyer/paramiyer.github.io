#!/usr/bin/env node
/**
 * build-stats.mjs — regenerate the GitHub-derived sections of index.html.
 *
 * Zero dependencies, Node 20+ (native fetch). Run by .github/workflows/static.yml
 * every Monday 05:00 UTC (09:00 Asia/Dubai), and runnable locally with no token.
 *
 * Design notes worth knowing before editing:
 *
 *  - The repos carry NO descriptions and NO topics on GitHub. Anything rendered
 *    from `repo.description` or `repo.topics` would come out blank, so the prose
 *    lives in CATALOGUE below and only volatile facts (language, last push,
 *    language byte mix) are fetched live.
 *
 *  - Only the regions between <!-- GEN:x --> and <!-- /GEN:x --> in index.html are
 *    rewritten. Hand-written prose outside those markers is never touched.
 *
 *  - Deliberately no stars / followers / streaks / contribution calendar. The
 *    public numbers are zero and the real work lives in Azure DevOps, so counting
 *    would understate rather than evidence. We show what the code demonstrates.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const USER = 'paramiyer';
const TZ = 'Asia/Dubai';

/* ── Curated catalogue ─────────────────────────────────────────────────────
 * Blurbs are Param's own, lifted from the previous hand-written index.html.
 * `caps` drives the capability matrix. Repos absent here still surface in the
 * live repo list, they just don't get a curated card.
 * ------------------------------------------------------------------------- */
const CATALOGUE = {
  'pii-schema-classifier': {
    title: 'AI Schema Classifier',
    blurb:
      'Open-source tool for automated PII and DAMA data-classification audits using LLMs, delivering over 94% cost saving against manual review.',
    caps: ['llm', 'governance'],
    flagship: true,
  },
  'multi-agent-enterprise-reporting-PMO-planner': {
    title: 'Multi-Agent AI PMO Planner',
    blurb:
      'Multi-agent orchestration system that generates project plans across six technology functions, producing four delivery options with different timelines and costs.',
    caps: ['agents', 'llm'],
    flagship: true,
  },
  'Time_series_LSTM_Autoencoder': {
    title: 'LSTM Autoencoder for Time Series',
    blurb:
      'Deep learning for synthetic data generation, anomaly detection and missing-value imputation — applied to temperature and financial series.',
    caps: ['timeseries'],
  },
  'Pharma_Demand-Forecasting-Optimization-Pipeline': {
    title: 'Supply Chain Engagement Optimisation',
    blurb:
      'ML and optimisation pipeline over CRM activity data, combining SHAP-based explainability with Google OR-Tools for constrained resource allocation.',
    caps: ['timeseries', 'optimisation'],
    flagship: true,
  },

  /* Private repos. Not visible to the API and not linkable — rendered as cards
   * without a URL so the page never ships a 404. Facts here are static. */
  'myBob': {
    title: 'myBob — Local-First Analytics Dashboard',
    blurb:
      'Personal analytics and insight dashboard over an MCP server, running entirely locally — no central hosting. TypeScript monorepo with a browser SPA and its own API layer.',
    caps: ['tooling'],
    private: true, language: 'TypeScript', since: '2026',
    flagship: true,
  },
  'coach-slot': {
    title: 'CoachSlot — Booking & Billing Mini-App',
    blurb:
      'Google Workspace mini-app for coach-owned booking: slot management, calendar integration, tokenised email confirmations and session-based invoicing.',
    caps: ['tooling'],
    private: true, language: 'JavaScript', since: '2026',
  },
  'ai-center-locator': {
    title: 'AI Center Locator — US Datacenter Site Suitability',
    blurb:
      'Site suitability scoring for US AI datacenters at H3 resolution 7 — ~1.5M hexagons over the continental US, ~29.7M rows. A dozen normalised infrastructure layers (power capacity and price, renewables, fibre, water, transport, workforce, land, hazard risk, cloud-region adjacency, plus competitor and community-opposition penalties) blended with live weight sliders.',
    caps: ['geo', 'fullstack'],
    private: true, language: 'Python', since: '2026',
    flagship: true,
  },
  'ltx-reel': {
    title: 'ltx-reel — Keyframe-Continuous Video Generation',
    blurb:
      'Turns an ordered folder of images plus one prompt into a single continuous video, rendered locally on Apple Silicon with LTX-Video. Consecutive images act as keyframes so the motion flows through them rather than cutting between independently animated clips. CLI with a model-free planning mode and a stand-in renderer for end-to-end wiring tests.',
    caps: ['vision', 'llm'],
    private: true, language: 'Python', since: '2026',
    flagship: true,
  },
  'astro': {
    title: 'Multi-Hop RAG Application with Row-Level Security',
    blurb:
      'A privacy-first reading and Q&A app built on two-pass multi-hop retrieval over stored context, with every answer citing its sources. Postgres with pgvector for embeddings, row-level security so a user can only ever retrieve their own context, and edge functions for question generation and chat. Provider-agnostic: runs against any OpenAI-compatible endpoint, including a local model.',
    caps: ['llm', 'fullstack'],
    private: true, language: 'TypeScript', since: '2026',
    flagship: true,
  },
  'smith': {
    title: 'smith — Ticketing Product with an MCP Server',
    blurb:
      'Project → stream → ticket → subtask, with a board, comment threads and an MCP server so the product can be driven from Claude Code. Tables live in a Postgres schema and PostgREST generates the REST API from them, so the web app and the MCP server are two clients of one API. TypeScript monorepo shipping to Vercel with preview-on-PR.',
    caps: ['tooling', 'fullstack'],
    private: true, language: 'TypeScript', since: '2026',
    flagship: true,
  },
};

/* Capability areas, in display order. `proves` is the claim the code backs up. */
const CAPABILITIES = [
  { id: 'llm',         name: 'LLMs & Applied GenAI',       proves: 'Production LLM systems: grounding, structured extraction, cost control' },
  { id: 'agents',      name: 'Multi-Agent Orchestration',  proves: 'Decomposing work across specialised agents with an orchestration layer' },
  { id: 'timeseries',  name: 'Time Series & Forecasting',  proves: 'Sequence models for forecasting, anomaly detection and imputation' },
  { id: 'optimisation',name: 'Optimisation & OR',          proves: 'Constrained allocation under real business limits, not just prediction' },
  { id: 'vision',      name: 'Computer Vision & Generative Media', proves: 'Diffusion video generation run locally on GPU, with keyframe-conditioned continuity' },
  { id: 'governance',  name: 'Data Governance & PII',      proves: 'Automated classification of sensitive data estates at audit scale' },
  { id: 'geo',         name: 'Geospatial & Location Intelligence', proves: 'Continental-scale H3 tiling and weighted multi-criteria site scoring' },
  { id: 'fullstack',   name: 'Full-Stack Product Engineering', proves: 'Schema to deployed UI: TypeScript monorepos, Postgres, CI/CD with preview deploys' },
  { id: 'tooling',     name: 'Agent Tooling & MCP', proves: 'MCP servers built so products can be driven directly from an AI client' },
];

/* Language swatches — kept in step with the palette in index.html. */
const LANG_COLOUR = {
  Python: '#3572A5', 'Jupyter Notebook': '#DA5B0B', HTML: '#e34c26', JavaScript: '#f1e05a',
  TypeScript: '#3178c6', CSS: '#563d7c', Shell: '#89e051', R: '#198CE7', Dockerfile: '#384d54',
};

const EXCLUDE = new Set(['paramiyer.github.io', 'pythonSamples']);

/* OpenAlex author IDs. Param's record is split across two — a General Motors
 * one and a Robert Bosch one — so both are queried and merged. OpenAlex is CC0
 * and needs no key; Google Scholar has no public API and scraping it from a CI
 * runner gets CAPTCHA'd, which is why this is the source for the chart. */
const OPENALEX_AUTHORS = ['A5045119494', 'A5080782322'];
const OPENALEX_MAILTO = 'paramiyer@gmail.com'; // polite-pool contact, already public on this page

/* ── fetch helpers ───────────────────────────────────────────────────────── */

/* GH_PAT is a read-only personal token with visibility across all repos, public
 * and private. Without it we fall back to GITHUB_TOKEN, which in Actions is
 * scoped to THIS repo only — the weekly activity counts would then see one repo
 * and understate the week by an order of magnitude. `activity.scope` records
 * which happened, so a thin week is distinguishable from a missing token. */
const token = process.env.GH_PAT || process.env.GITHUB_TOKEN || '';
const HAS_PAT = Boolean(process.env.GH_PAT);
const ACTIVITY_DAYS = 7;
const SITE = 'https://paramiyer.github.io/';

/* Indexable routes. Phase 3 adds to this list; the sitemap follows from it. */
const ROUTES = [
  '', 'enterprise-ai-architecture/', 'enterprise-rag/', 'agentic-ai/', 'about/',
  'case-studies/', 'case-studies/enterprise-signal-intelligence/',
  'case-studies/agentic-data-reuse/', 'case-studies/geospatial-site-suitability/',
  'case-studies/mcp-product/',
];

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'paramiyer-site-stats',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText} for ${path}`);
  }
  return res.json();
}

/* ── formatting ──────────────────────────────────────────────────────────── */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Recent work gets a relative age; anything over a year old shows its year.
 * "updated 1.3y ago" reads as neglected where "updated 2025" reads as dated —
 * same fact, and the reader can still do the arithmetic. */
function relativeAge(iso) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return String(d.getUTCFullYear());
}

const swatch = (lang) =>
  `<span class="dot" style="background:${LANG_COLOUR[lang] || '#8b949e'}" aria-hidden="true"></span>`;

/* ── renderers ───────────────────────────────────────────────────────────── */

/* Products shipped to production. Static because none of this is on GitHub:
 * two are client-confidential bank systems and three are vendor/marketplace
 * products. Kept in step with the Data Products section of index.html. */
/* Products shipped to production. This list is now the single source for BOTH the
 * metric tile and the Products section, so the count can no longer disagree with
 * what is listed. `repo` ties an entry to a CATALOGUE key — those are rendered here
 * rather than as project cards, so nothing appears twice on the page. */
const PRODUCTS = [
  {
    group: 'client', title: 'Prospect & Deal-Signal Monitor', tag: 'client engagement',
    blurb: 'Signal-driven prospecting and screening for corporate and investment banking relationship managers at a leading UAE bank. Scored signal feed, six-pillar entity scoring, grounded AI lead narratives and compliance screening. In production.',
  },
  {
    group: 'client', title: 'Branch & ATM Network Intelligence', tag: 'client engagement',
    blurb: "Geospatial siting, relocation and network planning across a UAE bank's branch and ATM estate, with per-branch catchment signals and a natural-language configuration assistant. In production.",
  },
  { group: 'venture', repo: 'ai-center-locator', tag: 'venture' },
  {
    group: 'commercial', title: 'Ijaba', // marketplace listing 404s as of 2026-08-29 — link removed

    blurb: 'An AI-driven platform for industrial IoT analytics and insights, listed on the Azure Marketplace.',
  },
  {
    group: 'commercial', title: 'Experience Based Repair', // Bosch page 404s as of 2026-08-29 — link removed

    blurb: "Bosch's intelligent repair recommendation system, built from historical and expert repair knowledge.",
  },
  {
    group: 'commercial', title: 'Agile Field Quality Monitoring', url: 'https://aws.amazon.com/solutions/case-studies/Robert-Bosch-GmbH-Case-Study/',
    blurb: 'Cloud-based predictive system for detecting and analysing field failures across connected devices and vehicles.',
  },
];

/* CATALOGUE keys promoted into the Products section, so renderProjects skips them. */
const PRODUCT_REPOS = new Set(PRODUCTS.filter((p) => p.repo).map((p) => p.repo));

/* Grouped deliberately. The page states "two enterprise AI products" for the bank
 * and a total in the proof bar; both are true, the two being a subset of the total.
 * Without the grouping a reader sees 2 and 6 and assumes an error.
 *
 * smith is deliberately NOT here. It is a personal build for learning the stack,
 * not a product shipped for anyone, and listing it beside client platforms and a
 * funded-stage venture overstates it. It renders under Selected Technical Builds
 * instead. A reader who is told "product" and then hears "side project" in an
 * interview has found a credibility gap, and that is expensive to spend. */
const GROUPS = [
  { id: 'client',     label: 'Enterprise platforms delivered for clients' },
  { id: 'venture',    label: 'Independent venture' },
  { id: 'commercial', label: 'Commercial and marketplace products' },
];

function renderProducts() {
  const item = (p) => {
    const meta = p.repo ? CATALOGUE[p.repo] : null;
    const title = meta ? meta.title : p.title;
    const blurb = meta ? meta.blurb : p.blurb;
    const head = p.url
      ? `<a href="${esc(p.url)}" target="_blank" rel="noopener"><strong>${esc(title)}</strong></a>`
      : `<strong>${esc(title)}</strong>`;
    return `        <li>${head} — ${esc(blurb)}</li>`;
  };

  const blocks = GROUPS.map((g) => {
    const rows = PRODUCTS.filter((p) => p.group === g.id);
    return `      <h3 class="pgroup">${esc(g.label)} <span class="pcount">${rows.length}</span></h3>
      <ul class="plain">
${rows.map(item).join('\n')}
      </ul>`;
  }).join('\n');

  return `<div class="products">
${blocks}
      <p class="pnote">Seven in total: two enterprise platforms built for a leading UAE
      bank, two products I build and run myself, and three commercial products taken
      to market. Where the page says "two enterprise AI products", it means the two
      bank platforms.</p>
    </div>`;
}

/* Executive proof bar. Deliberately career and delivery signals only — commit
 * counts, repo counts and citations are evidence of a different kind and live
 * further down the page, where they support rather than lead. */
function renderMetrics({ projectCount, languageCount, capabilityCount, citationTotal }) {
  const tiles = [
    { v: '20+',           l: 'Years leading AI &amp; data',        src: 'career' },
    { v: 'AED 90M+',      l: 'Enterprise value delivered',         src: 'career' },
    { v: PRODUCTS.length, l: 'Products shipped to production',     src: 'product' },
    { v: '40',            l: 'AI engineers in the function I built', src: 'career' },
  ];
  return `<div class="metrics">
${tiles
  .map(
    (t) => `      <div class="metric">
        <div class="metric-v" data-count="${typeof t.v === 'number' ? t.v : ''}">${t.v}</div>
        <div class="metric-l">${t.l}</div>
        <div class="metric-src metric-src--${t.src}">${
          { career: 'career', product: 'shipped', live: 'live from API' }[t.src]
        }</div>
      </div>`
  )
  .join('\n')}
    </div>`;
}

function renderCapability(byCapability) {
  const blocks = CAPABILITIES.filter((c) => byCapability[c.id]?.length).map((c) => {
    const repos = byCapability[c.id]
      .map((r) =>
        r.url
          ? `<a class="chip" href="${esc(r.url)}" target="_blank" rel="noopener">${swatch(r.language)}${esc(r.title)}</a>`
          : `<span class="chip chip--private">${swatch(r.language)}${esc(r.title)}</span>`
      )
      .join('\n            ');
    return `      <div class="cap">
        <h3 class="cap-name">${esc(c.name)}</h3>
        <p class="cap-proves">${esc(c.proves)}</p>
        <div class="chips">
            ${repos}
        </div>
      </div>`;
  });
  return `<div class="caps">\n${blocks.join('\n')}\n    </div>`;
}

function renderProjects(items) {
  const cards = items
    .filter((r) => !PRODUCT_REPOS.has(r.name))
    .map((r) => {
      const heading = r.url
        ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>`
        : esc(r.title);
      const when = r.pushed_at ? `updated ${relativeAge(r.pushed_at)}` : `${esc(r.since || '')}`;
      const tag = r.url ? '' : '<span class="sep">·</span><span class="tag-private">private repo</span>';
      return `      <article class="card${r.flagship ? ' card--flagship' : ''}">
        <h3 class="card-t">${heading}</h3>
        <p class="card-d">${esc(r.blurb)}</p>
        <div class="card-m">${swatch(r.language)}<span>${esc(r.language || 'Mixed')}</span><span class="sep">·</span><span>${when}</span>${tag}</div>
      </article>`;
    })
    .join('\n');
  return `<div class="cards">\n${cards}\n    </div>`;
}

/**
 * Language mix, weighted by PROJECT COUNT rather than bytes.
 *
 * Byte-weighting is actively misleading here: .ipynb files embed base64 image
 * outputs, so the byte split came out 98.3% Jupyter / 1.7% Python — a near-solid
 * bar implying notebooks are all there is. Counting projects gives the honest
 * shape, and needs no per-repo API calls.
 */
function renderLanguages(totals) {
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  const bar = rows
    .map(
      ([lang, v]) =>
        `<span class="seg" style="width:${((v / sum) * 100).toFixed(2)}%;background:${
          LANG_COLOUR[lang] || '#8b949e'
        }" title="${esc(lang)} ${((v / sum) * 100).toFixed(1)}%"></span>`
    )
    .join('');

  const key = rows
    .map(
      ([lang, v]) =>
        `<li>${swatch(lang)}${esc(lang)} <span class="pct">${v} ${v === 1 ? 'project' : 'projects'}</span></li>`
    )
    .join('\n        ');

  return `<div class="langbar" role="img" aria-label="Primary language across ${sum} projects">${bar}</div>
      <ul class="langkey">
        ${key}
      </ul>`;
}

/**
 * Citation trend, drawn as inline SVG so it themes with the page and pulls in
 * nothing third-party. Bars are citations RECEIVED in each year, summed across
 * every work — the same shape as the Google Scholar chart this replaces.
 */
function renderCitations({ perYear, total, works, hIndex }) {
  const years = Object.keys(perYear).map(Number).sort((a, b) => a - b);
  if (!years.length) throw new Error('OpenAlex returned no citation years');

  const W = 720, H = 190, PAD_L = 34, PAD_B = 26, PAD_T = 14;
  const max = Math.max(...years.map((y) => perYear[y]));
  const plotW = W - PAD_L - 10, plotH = H - PAD_B - PAD_T;
  const slot = plotW / years.length;
  const bw = Math.min(30, slot * 0.62);

  const bars = years
    .map((y, i) => {
      const v = perYear[y];
      const h = max ? (v / max) * plotH : 0;
      const x = PAD_L + i * slot + (slot - bw) / 2;
      const yy = PAD_T + (plotH - h);
      return `<g><title>${y}: ${v} citation${v === 1 ? '' : 's'}</title>` +
        `<rect class="cbar" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" ` +
        `height="${Math.max(h, 1).toFixed(1)}" rx="2"/></g>`;
    })
    .join('');

  // Label every other year so they never collide.
  const labels = years
    .map((y, i) =>
      i % 2 === 0 || i === years.length - 1
        ? `<text class="cax" x="${(PAD_L + i * slot + slot / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${String(y).slice(2)}</text>`
        : ''
    )
    .join('');

  const gridY = PAD_T + plotH;
  const summary =
    `${total} citations across ${works} works, h-index ${hIndex}. ` +
    `Peak ${max} citations in ${years.find((y) => perYear[y] === max)}.`;

  return `<div class="citebox">
      <div class="citestats">
        <span><b>${total}</b> indexed citations</span>
        <span><b>${works}</b> works</span>
        <span><b>${hIndex}</b> h-index</span>
      </div>
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Citations received per year. ${esc(summary)}">
        <line class="cgrid" x1="${PAD_L}" y1="${gridY}" x2="${W - 10}" y2="${gridY}"/>
        <text class="cax" x="${PAD_L - 8}" y="${PAD_T + 8}" text-anchor="end">${max}</text>
        <text class="cax" x="${PAD_L - 8}" y="${gridY}" text-anchor="end">0</text>
        ${bars}
        ${labels}
      </svg>
      <p class="citenote">
        Citations received per year · source
        <a href="https://openalex.org/A5045119494" target="_blank" rel="noopener">OpenAlex</a>, refreshed weekly.
        <a href="https://scholar.google.com/citations?user=4xdbJC8AAAAJ&amp;hl=en&amp;oi=ao" target="_blank" rel="noopener">Google Scholar</a>
        reports 200+, as it also indexes theses, preprints and other grey literature.
      </p>
    </div>`;
}

/**
 * Rolling-7-day activity: commits, repositories touched, pull requests and CI runs.
 *
 * Aggregate counts only — no repository, project or client names are fetched into
 * the rendered output, which is both the brief and the right default for work done
 * under client confidentiality.
 */
async function fetchActivity() {
  /* A locally-counted snapshot beats the API: it sees private repos without any
   * credential. Used when present and fresher than the window it describes. */
  try {
    const raw = await readFile(join(ROOT, 'data', 'activity-local.json'), 'utf8');
    const local = JSON.parse(raw);
    const ageDays = (Date.now() - new Date(local.generated_at)) / 86400000;
    if (ageDays <= local.days) return local;
    console.warn(`  ! activity-local.json is ${ageDays.toFixed(1)}d old — falling back to the API`);
  } catch { /* no local snapshot; use the API */ }

  const since = new Date(Date.now() - ACTIVITY_DAYS * 86400000).toISOString();
  const sinceDay = since.slice(0, 10);

  // With a PAT this lists private repos too; without one it is public-only.
  const repos = HAS_PAT
    ? await gh(`/user/repos?per_page=100&affiliation=owner&sort=pushed`)
    : await gh(`/users/${USER}/repos?per_page=100&type=owner&sort=pushed`);

  const active = repos.filter((r) => !r.fork && r.pushed_at >= since);

  let commits = 0, runs = 0, touched = 0;
  for (const r of active) {
    const cs = await gh(
      `/repos/${r.full_name}/commits?since=${since}&author=${USER}&per_page=100`
    ).catch(() => []);
    if (cs.length) { commits += cs.length; touched += 1; }
    const wf = await gh(
      `/repos/${r.full_name}/actions/runs?created=%3E%3D${sinceDay}&per_page=100`
    ).catch(() => ({ workflow_runs: [] }));
    runs += (wf.workflow_runs || []).length;
  }

  // One search call covers every repo the token can see, including private.
  const pr = await gh(
    `/search/issues?q=${encodeURIComponent(`author:${USER} type:pr created:>=${sinceDay}`)}&per_page=1`
  ).catch(() => ({ total_count: 0 }));

  return {
    days: ACTIVITY_DAYS,
    commits, repos: touched, prs: pr.total_count || 0, runs,
    scope: HAS_PAT
      ? 'the GitHub API across all repositories'
      : 'the GitHub API across public repositories only',
  };
}

function renderActivity(a, refreshed) {
  const bits = [
    [a.commits, a.commits === 1 ? 'commit' : 'commits'],
    [a.repos, a.repos === 1 ? 'repository' : 'repositories'],
    [a.prs, a.prs === 1 ? 'pull request' : 'pull requests'],
    // Pipeline runs only exist on the API path; omitted rather than shown as 0.
    ...(a.runs === undefined ? [] : [[a.runs, a.runs === 1 ? 'pipeline run' : 'pipeline runs']]),
  ]
    .map(([n, l]) => `<span><b>${n}</b> ${l}</span>`)
    .join('<span class="sep" aria-hidden="true">·</span>');

  return `<div class="activity">
      <p class="act-line">${bits}</p>
      <p class="act-note">Rolling ${a.days} days to ${esc(refreshed)}, counted from ${esc(a.scope)}. Repository and client names are omitted by design.</p>
    </div>`;
}

/**
 * Person / ProfilePage / WebSite graph.
 *
 * Deliberately NO `jobTitle` and NO `worksFor`. The positioning line is
 * "Principal AI Architect", but the role actually held is AI Consultant, and the
 * page says so in Career Journey. Asserting the positioning as a title in
 * structured data would contradict the page's own content and overstate a fact.
 * `hasOccupation` describes the occupation without claiming an employer
 * relationship, and `description` carries the positioning as prose.
 */
function renderJsonLd(refreshedIso) {
  const person = {
    '@type': 'Person',
    '@id': SITE + '#person',
    name: 'Parameshwaran S Iyer',
    alternateName: 'Parameshwaran Iyer',
    description:
      'Principal AI Architect and Enterprise AI Leader based in the UAE. Designs, builds and scales production AI and GenAI platforms, from enterprise strategy and architecture through to working systems.',
    url: SITE,
    image: SITE + 'ParamProfile.png',
    email: 'mailto:paramiyer@gmail.com',
    address: { '@type': 'PostalAddress', addressCountry: 'AE' },
    hasOccupation: {
      '@type': 'Occupation',
      name: 'Enterprise AI Architect',
      occupationLocation: { '@type': 'Country', name: 'United Arab Emirates' },
    },
    alumniOf: [
      { '@type': 'CollegeOrUniversity', name: 'Pennsylvania State University' },
      { '@type': 'CollegeOrUniversity', name: 'University of Mumbai' },
    ],
    knowsAbout: [
      'Enterprise AI Architecture', 'Generative AI', 'Retrieval-Augmented Generation',
      'Agentic AI', 'AI Platforms', 'MLOps', 'Databricks', 'Data Governance',
      'Machine Learning', 'Geospatial Analysis', 'Enterprise Architecture',
    ],
    sameAs: [
      'https://www.linkedin.com/in/parameshwaran-iyer-790b2131/',
      'https://github.com/paramiyer',
      'https://scholar.google.com/citations?user=4xdbJC8AAAAJ',
      /* Both OpenAlex author records. The profile is split across a General Motors
       * one and a Robert Bosch one; asserting both as sameAs tells a consumer they
       * are the same person, which is the disambiguation this graph exists for. */
      'https://openalex.org/A5045119494',
      'https://openalex.org/A5080782322',
    ],
  };

  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      person,
      {
        '@type': 'ProfilePage',
        '@id': SITE + '#profilepage',
        url: SITE,
        name: 'Parameshwaran Iyer | Principal AI Architect & Enterprise AI Leader',
        mainEntity: { '@id': SITE + '#person' },
        dateModified: refreshedIso.slice(0, 10),   // date only — a full timestamp would break idempotence
        inLanguage: 'en',
        isPartOf: { '@id': SITE + '#website' },
      },
      {
        '@type': 'WebSite',
        '@id': SITE + '#website',
        url: SITE,
        name: 'Parameshwaran Iyer',
        inLanguage: 'en',
        author: { '@id': SITE + '#person' },
      },
    ],
  };

  return `<script type="application/ld+json">\n${JSON.stringify(graph, null, 2)}\n</` + `script>`;
}

function renderSitemap(refreshedIso) {
  const urls = ROUTES.map(
    (r) => `  <url>\n    <loc>${SITE}${r}</loc>\n    <lastmod>${refreshedIso.slice(0, 10)}</lastmod>\n  </url>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/* ── injection ───────────────────────────────────────────────────────────── */

function inject(html, marker, body) {
  const re = new RegExp(`(<!-- GEN:${marker} -->)([\\s\\S]*?)(<!-- /GEN:${marker} -->)`);
  if (!re.test(html)) throw new Error(`Marker GEN:${marker} not found in index.html`);
  return html.replace(re, `$1\n    ${body}\n    $3`);
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
  const all = await gh(`/users/${USER}/repos?per_page=100&type=owner&sort=pushed`);
  const live = new Map(
    all.filter((r) => !r.fork && !r.archived && !EXCLUDE.has(r.name)).map((r) => [r.name, r])
  );

  // Build from the catalogue, merging live facts on top. Public entries that have
  // vanished from GitHub (renamed/deleted) are dropped rather than rendered dead.
  const items = [];
  for (const [name, meta] of Object.entries(CATALOGUE)) {
    const l = live.get(name);
    if (!l && !meta.private) {
      console.warn(`  ! catalogue entry '${name}' not found on GitHub — skipped`);
      continue;
    }
    items.push({
      name,
      title: meta.title,
      blurb: meta.blurb,
      caps: meta.caps || [],
      flagship: !!meta.flagship,
      language: l?.language || meta.language || null,
      url: l?.html_url || null,
      pushed_at: l?.pushed_at || null,
      since: meta.since || null,
    });
  }

  // Flagship first, then most-recently pushed. Private entries have no push date
  // and sort last within their group.
  items.sort(
    (a, b) =>
      Number(b.flagship) - Number(a.flagship) ||
      new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0)
  );

  // Primary language per project. See renderLanguages() for why this is counted
  // by project rather than by bytes.
  const totals = {};
  for (const r of items) if (r.language) totals[r.language] = (totals[r.language] || 0) + 1;

  const byCapability = {};
  for (const r of items) for (const cap of r.caps) (byCapability[cap] ||= []).push(r);

  const capabilityCount = CAPABILITIES.filter((c) => byCapability[c.id]?.length).length;
  const publicCount = items.filter((i) => i.url).length;

  /* ── OpenAlex citations ───────────────────────────────────────────────── */
  const oaUrl =
    `https://api.openalex.org/works?filter=author.id:${OPENALEX_AUTHORS.join('|')}` +
    `&per-page=100&select=publication_year,cited_by_count,counts_by_year&mailto=${OPENALEX_MAILTO}`;
  const oaRes = await fetch(oaUrl, { headers: { 'User-Agent': `paramiyer.github.io (${OPENALEX_MAILTO})` } });
  if (!oaRes.ok) throw new Error(`OpenAlex ${oaRes.status} ${oaRes.statusText}`);
  const oa = await oaRes.json();

  const perYear = {};
  let citeTotal = 0;
  const citeCounts = [];
  for (const w of oa.results) {
    citeTotal += w.cited_by_count;
    citeCounts.push(w.cited_by_count);
    for (const c of w.counts_by_year || []) {
      perYear[c.year] = (perYear[c.year] || 0) + c.cited_by_count;
    }
  }
  // h-index: largest h such that h works have >= h citations each.
  citeCounts.sort((a, b) => b - a);
  const hIndex = citeCounts.reduce((h, c, i) => (c >= i + 1 ? i + 1 : h), 0);
  const citations = { perYear, total: citeTotal, works: oa.results.length, hIndex };

  const activity = await fetchActivity();

  const refreshed = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ,
  }).format(new Date());

  const snapshot = {
    generated_at: new Date().toISOString(),
    refreshed_label: refreshed,
    project_count: items.length,
    public_project_count: publicCount,
    capability_count: capabilityCount,
    languages: totals,
    citations,
    activity,
    projects: items.map(({ name, url, language, pushed_at, caps }) => ({
      name, url, language, pushed_at, caps,
    })),
  };
  await writeFile(join(ROOT, 'data', 'github-stats.json'), JSON.stringify(snapshot, null, 2) + '\n');

  let html = await readFile(join(ROOT, 'index.html'), 'utf8');
  html = inject(html, 'METRICS', renderMetrics({
    projectCount: publicCount,
    languageCount: Object.keys(totals).length,
    capabilityCount,
    citationTotal: citations.total,
  }));
  html = inject(html, 'CAPABILITY', renderCapability(byCapability));
  html = inject(html, 'PROJECTS', renderProjects(items));
  html = inject(html, 'LANGUAGES', renderLanguages(totals));
  html = inject(html, 'JSONLD', renderJsonLd(snapshot.generated_at));
  html = inject(html, 'ACTIVITY', renderActivity(activity, refreshed));
  html = inject(html, 'PRODUCTS', renderProducts());
  html = inject(html, 'CITATIONS', renderCitations(citations));
  html = inject(html, 'REFRESHED', `<span class="refreshed">last refresh ${refreshed}</span>`);
  await writeFile(join(ROOT, 'index.html'), html);
  await writeFile(join(ROOT, 'sitemap.xml'), renderSitemap(snapshot.generated_at));

  console.log(
    `ok — ${items.length} projects (${publicCount} public), ${capabilityCount} capability areas, ` +
    `${Object.keys(totals).length} languages, ${citations.total} citations across ` +
    `${citations.works} works (h=${citations.hIndex}), ` +
    `7d: ${activity.commits} commits / ${activity.prs} PRs` +
    (activity.runs === undefined ? '' : ` / ${activity.runs} runs`) +
    ` [${activity.scope}], ` +
    `refreshed ${refreshed}`
  );
}

main().catch((err) => {
  console.error(`build-stats failed: ${err.message}`);
  process.exit(1);
});
