'use strict';
// Spec 002, FR-002 and FR-055: broker tool names live only in core/lib/brokers/toolmap.js.
// Skills describe capabilities; exact calls come from the engine (doctor, drafts).
// Only names with an underscore are checked: one-word tools (gtt, orders, session, login) are
// also ordinary words in prose.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fixture } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const ALLOWED = new Set(['core/lib/brokers/toolmap.js']);
const NAMES = [...new Set(fixture('toolnames.json').tools.map((t) => t.tool).filter((n) => n.includes('_')))];

function files(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? files(rel) : [rel];
  });
}

test('no broker tool name appears outside the tool map in core, hooks, skills, agents or context', () => {
  const hits = [];
  for (const f of ['core', 'hooks', 'skills', 'agents', 'context'].flatMap(files)) {
    if (ALLOWED.has(f) || !/\.(js|json|md)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const n of NAMES) if (new RegExp(`\\b${n}\\b`).test(text)) hits.push(`${f}: ${n}`);
  }
  assert.deepStrictEqual(hits, []);
});
