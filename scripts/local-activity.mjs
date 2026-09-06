#!/usr/bin/env node
/**
 * local-activity.mjs — count the last week's work from local clones.
 *
 * Why this exists: the GitHub API path in build-stats.mjs can only see private
 * repositories if a personal access token is provided. Counting locally needs no
 * credential at all — the repos are already on disk and `git log` reads them
 * directly — so this gives complete numbers with nothing to mint, store or leak.
 *
 * Writes data/activity-local.json. build-stats.mjs prefers that file when it is
 * fresh, and falls back to the API otherwise.
 *
 * Pipeline runs are deliberately absent: CI history lives on GitHub, not in the
 * clone, so it cannot be counted here. The renderer shows only the metrics that
 * are actually present rather than reporting a zero it cannot stand behind.
 *
 * Run from anywhere:  node scripts/local-activity.mjs
 */

import { execFileSync } from 'node:child_process';
import { writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAYS = 7;
const SCAN = [join(homedir(), 'Documents/code'), join(homedir(), 'Code/github')];
const OWNER = 'paramiyer';
const AUTHORS = ['paramiyer@gmail.com', 'param.iyer@whiteshield.com', 'paramiyer'];

const git = (cwd, args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

async function repoDirs() {
  /* Deduplicated by git's COMMON directory, not by path. A linked worktree has its
   * own .git file and reports the same origin URL as its parent, so counting by
   * directory multiplies one repository's history by the number of worktrees open
   * against it. That is not a hypothetical: six worktrees of one repo inflated a
   * week from 275 commits to 1577. An implausible number on a page whose whole
   * argument is verifiability is worse than no number at all. */
  const out = [];
  const seen = new Set();
  for (const base of SCAN) {
    if (!existsSync(base)) continue;
    for (const name of await readdir(base)) {
      const dir = join(base, name);
      if (!existsSync(join(dir, '.git'))) continue;
      if (!git(dir, ['config', '--get', 'remote.origin.url']).includes(OWNER)) continue;
      const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim();
      const key = common || dir;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(dir);
    }
  }
  return out;
}

async function main() {
  const since = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const authorArgs = AUTHORS.flatMap((a) => ['--author', a]);

  let commits = 0, repos = 0;
  const prRefs = new Set();

  for (const dir of await repoDirs()) {
    // --all so work on feature branches counts, not just whatever is checked out.
    const hashes = git(dir, ['log', '--all', `--since=${since}`, '--pretty=%H', ...authorArgs])
      .split('\n').filter(Boolean);
    if (!hashes.length) continue;
    commits += hashes.length;
    repos += 1;

    // Squash merges carry "(#15)"; merge commits carry "Merge pull request #15".
    // Namespaced by repo so #15 in two repos counts twice, as it should.
    // Author-filtered like the commit count above: without it, every teammate's
    // merge in a shared repo was being counted as one of his.
    for (const subject of git(dir, ['log', '--all', `--since=${since}`, '--pretty=%s', ...authorArgs]).split('\n')) {
      for (const m of subject.matchAll(/\(#(\d+)\)|Merge pull request #(\d+)/g)) {
        prRefs.add(`${dir}#${m[1] || m[2]}`);
      }
    }
  }

  const activity = {
    generated_at: new Date().toISOString(),
    days: DAYS,
    commits,
    repos,
    prs: prRefs.size,
    scope: 'local git history across all repositories',
  };

  await writeFile(join(ROOT, 'data', 'activity-local.json'), JSON.stringify(activity, null, 2) + '\n');
  console.log(`ok — ${commits} commits, ${repos} repositories, ${prRefs.size} pull requests since ${since}`);
}

main().catch((err) => {
  console.error(`local-activity failed: ${err.message}`);
  process.exit(1);
});
