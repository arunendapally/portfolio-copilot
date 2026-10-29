'use strict';
// Capability gaps: logged to the investor's feedback file, and filed as a GitHub issue
// (or commented on an open duplicate) when a token is configured.

const fs = require('fs');
const path = require('path');
const { stateDir, readJson, writeJson } = require('./state');
const { istStamp } = require('./format');

const DEFAULT_REPO = 'arunendapally/portfolio-copilot';
const OUTPUT_MAX = 1500;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500; // doubles each retry: 500, 1000, 2000
const COOLDOWN_MS = 60000; // after the retries are spent, fail fast for this long
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function feedbackPath(folder) {
  return path.join(stateDir(folder), 'feedback.md');
}

function bodyOf(gap, now) {
  const L = [`## Gap (${istStamp(now).slice(0, 10)})`, `**Attempted:** ${gap.attempted || 'not stated'}`, `**Missing:** ${gap.missing}`];
  if (gap.output) L.push('**Tool output or error:**', '```', String(gap.output).slice(0, OUTPUT_MAX), '```');
  L.push('', '---', '_Filed by the report_gap tool of portfolio-core_');
  return L.join('\n');
}

function logLocal(folder, gap, now, filedUrl) {
  const file = feedbackPath(folder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const head = fs.existsSync(file) ? '' : '# Feedback log\n';
  fs.appendFileSync(file, `${head}\n### ${istStamp(now)} ${gap.title}\n${bodyOf(gap, now)}\n${filedUrl ? `Filed: ${filedUrl}\n` : ''}`);
  return file;
}

// Retries network errors, 429 and 5xx with exponential backoff. After MAX_RETRIES the breaker opens
// and later calls fail fast (the caller falls back to the local log) until the cooldown ends.
async function api(gh, route, init = {}) {
  const breaker = gh.breaker || (gh.breaker = { openUntil: 0 });
  const clock = gh.clock || Date.now;
  if (clock() < breaker.openUntil) throw new Error('GitHub circuit open after repeated failures; not retrying yet');
  let last;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt) await (gh.sleep || sleep)(BASE_DELAY_MS * 2 ** (attempt - 1));
    try {
      const res = await gh.fetch(`https://api.github.com/repos/${gh.repo}${route}`, {
        ...init,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${gh.token}`, 'Content-Type': 'application/json', 'User-Agent': 'portfolio-copilot' },
      });
      if (res.ok) return await res.json();
      last = new Error(`GitHub ${res.status} on ${init.method || 'GET'} ${route}`);
      if (res.status !== 429 && res.status < 500) throw Object.assign(last, { permanent: true });
    } catch (e) {
      if (e.permanent) throw e;
      last = e;
    }
  }
  breaker.openUntil = clock() + COOLDOWN_MS;
  throw new Error(`${last.message}; gave up after ${MAX_RETRIES} retries`);
}

// GitHub's issue list lags a moment behind a new issue, so remember what we filed and ask for it directly.
function filedPath(folder) {
  return path.join(stateDir(folder), 'gap-issues.json');
}

async function fileGap(gap, gh, now, folder) {
  const key = gap.title.trim().toLowerCase();
  const filed = readJson(filedPath(folder), {});
  let dup = null;
  if (filed[key]) {
    try {
      const known = await api(gh, `/issues/${filed[key]}`);
      if (known.state === 'open') dup = known;
    } catch { /* gone or unreadable: fall through to the list */ }
  }
  if (!dup) {
    const open = await api(gh, '/issues?state=open&labels=gap&per_page=100');
    dup = open.find((i) => !i.pull_request && i.title.trim().toLowerCase() === key) || null;
  }
  if (dup) {
    writeJson(filedPath(folder), { ...filed, [key]: dup.number });
    await api(gh, `/issues/${dup.number}/comments`, { method: 'POST', body: JSON.stringify({ body: bodyOf(gap, now) }) });
    return { action: 'commented', url: dup.html_url };
  }
  const made = await api(gh, '/issues', { method: 'POST', body: JSON.stringify({ title: gap.title, body: bodyOf(gap, now), labels: ['gap'] }) });
  writeJson(filedPath(folder), { ...filed, [key]: made.number });
  return { action: 'created', url: made.html_url };
}

module.exports = { DEFAULT_REPO, feedbackPath, logLocal, fileGap };
