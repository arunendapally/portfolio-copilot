'use strict';
// log.md = "Start here" block + this month's dated entries. Older months rotate to log/YYYY-MM.md
// so session start only ever reads a small file.

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./state');
const { istStamp } = require('./format');

const HEADER = '# Portfolio log\n';
const START = '## Start here';
const ENTRY_RE = /^## (\d{4}-\d{2})-\d{2} \d{2}:\d{2} IST$/;

function logPath(folder) {
  return path.join(stateDir(folder), 'log.md');
}

function parse(text) {
  const lines = text.split(/\r?\n/);
  let start = [];
  const entries = [];
  let cur = null;
  for (const line of lines) {
    if (line === START) { cur = { kind: 'start', lines: [] }; start = cur.lines; continue; }
    const m = line.match(ENTRY_RE);
    if (m) { cur = { kind: 'entry', month: m[1], lines: [line] }; entries.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return { start: start.join('\n').trim(), entries };
}

function render(start, entries) {
  const body = entries.map((e) => e.lines.join('\n').trimEnd()).join('\n\n');
  return `${HEADER}\n${START}\n${start || '_Nothing yet._'}\n${body ? `\n${body}\n` : ''}`;
}

function append(folder, { text, startHere } = {}, now = new Date()) {
  const file = logPath(folder);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const parsed = fs.existsSync(file) ? parse(fs.readFileSync(file, 'utf8')) : { start: '', entries: [] };
  const stamp = istStamp(now);
  const month = stamp.slice(0, 7);
  const old = parsed.entries.filter((e) => e.month !== month);
  const keep = parsed.entries.filter((e) => e.month === month);
  const archived = [];
  for (const m of [...new Set(old.map((e) => e.month))]) {
    const target = path.join(path.dirname(file), 'log', `${m}.md`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const chunk = old.filter((e) => e.month === m).map((e) => e.lines.join('\n').trimEnd()).join('\n\n');
    fs.appendFileSync(target, (fs.existsSync(target) ? '\n\n' : `# Portfolio log ${m}\n\n`) + chunk + '\n');
    archived.push(m);
  }
  if (text) keep.push({ month, lines: [`## ${stamp}`, String(text).trim()] });
  fs.writeFileSync(file, render(startHere !== undefined ? String(startHere).trim() : parsed.start, keep));
  return { path: file, archived, bytes: fs.statSync(file).size };
}

module.exports = { append, parse, logPath };
