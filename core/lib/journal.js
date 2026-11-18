'use strict';
// Journal read-back (spec 002 FR-036): decisions older than N days beside what the same rule
// measures now. A decision whose task no longer fires shows "no longer due".

const fs = require('fs');
const path = require('path');
const { stateDir } = require('./state');

function lines(folder) {
  try {
    return fs.readFileSync(path.join(stateDir(folder), 'journal.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

const fmt = (ms) => (ms || []).filter((m) => m.name !== 'finding').map((m) => `${m.name.replace(/_/g, ' ')} ${m.value}`).join(', ') || (ms && ms[0] ? String(ms[0].value) : '-');

// current: tasks the rules produce now (any number, not capped), matched by id, then by rule and symbol.
function readback(folder, { olderThanDays, now, current = [] }) {
  const cutoff = new Date(now.getTime() - olderThanDays * 86400000).toISOString();
  const latest = new Map();
  for (const j of lines(folder)) if (j.decided_at && j.decided_at <= cutoff) latest.set(j.id, j);
  return [...latest.values()].sort((a, b) => a.decided_at.localeCompare(b.decided_at)).map((j) => {
    const now_ = current.find((t) => t.id === j.id) || current.find((t) => t.why.rule_ref === j.why.rule_ref && t.symbol === j.symbol);
    return {
      id: j.id, title: j.title, decision: j.decision, reason: j.reason, decided_at: j.decided_at, outcome: j.outcome || null,
      then: j.why.measurements, now: now_ ? now_.why.measurements : null,
      text: `${j.decided_at.slice(0, 10)} ${j.title}: ${j.decision}${j.reason ? ` (${j.reason})` : ''}. Then: ${fmt(j.why.measurements)}. Now: ${now_ ? fmt(now_.why.measurements) : 'no longer due'}.`,
    };
  });
}

module.exports = { readback, lines };
