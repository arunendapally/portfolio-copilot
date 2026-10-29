'use strict';
// Capability gaps: logged to the investor's feedback file, and filed as a GitHub issue
// (or commented on an open duplicate) when a token is configured.

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./state');
const { istStamp } = require('./format');

const DEFAULT_REPO = 'arunendapally/portfolio-copilot';
const OUTPUT_MAX = 1500;

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

async function api(gh, route, init = {}) {
  const res = await gh.fetch(`https://api.github.com/repos/${gh.repo}${route}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${gh.token}`, 'Content-Type': 'application/json', 'User-Agent': 'portfolio-copilot' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${init.method || 'GET'} ${route}`);
  return res.json();
}

async function fileGap(gap, gh, now) {
  const same = (t) => t.trim().toLowerCase() === gap.title.trim().toLowerCase();
  const open = await api(gh, '/issues?state=open&labels=gap&per_page=100');
  const dup = open.find((i) => !i.pull_request && same(i.title));
  if (dup) {
    await api(gh, `/issues/${dup.number}/comments`, { method: 'POST', body: JSON.stringify({ body: bodyOf(gap, now) }) });
    return { action: 'commented', url: dup.html_url };
  }
  const made = await api(gh, '/issues', { method: 'POST', body: JSON.stringify({ title: gap.title, body: bodyOf(gap, now), labels: ['gap'] }) });
  return { action: 'created', url: made.html_url };
}

module.exports = { DEFAULT_REPO, feedbackPath, logLocal, fileGap };
