'use strict';
// The guided review run (spec 002 US3, plan section 4): connect, pull, research, evaluate,
// propose, execute, verify, record. Each call performs the current stage; a gate that fails
// returns what it needs and leaves the stage where it is. The run is a file, so it resumes.
// The engine cannot browse, ask or call brokers: those are `next` steps for the model.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stateDir, readJson, writeJson } = require('./state');
const profiles = require('./profile');
const decisions = require('./decisions');
const drafts = require('./drafts');
const gtt = require('./gtt');
const session = require('./session');
const toolmap = require('./brokers/toolmap');
const manual = require('./manual_steps');
const snapshotLib = require('./snapshot');
const journal = require('./journal');
const marksLib = require('./marks');
const effects = require('./effects');
const { istStamp, istDate } = require('./format');

const STAGES = {
  full: ['connect', 'pull', 'research', 'evaluate', 'propose', 'execute', 'verify', 'record'],
  friday: ['connect', 'pull', 'research', 'evaluate', 'propose', 'execute', 'verify', 'record'],
  eod: ['connect', 'pull', 'evaluate', 'record'],
};
const RESULTS_WINDOW_DAYS = 14;

const runsDir = (folder) => path.join(stateDir(folder), 'runs');
const runFile = (folder, id) => path.join(runsDir(folder), `${id}.json`);
const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

function save(folder, run) {
  writeJson(runFile(folder, run.id), run);
  return run;
}

function load(folder, id) {
  return readJson(runFile(folder, id), null);
}

function start(folder, { kind = 'full', unattended = false, tools = [] }, now) {
  if (!STAGES[kind]) throw new Error(`kind must be ${Object.keys(STAGES).join(' | ')}`);
  const date = istDate(now);
  const id = `${date}-${kind}`;
  const existing = load(folder, id);
  if (existing) {
    // The investor picking up a run the scheduled task left waiting.
    if (existing.unattended && !unattended) { existing.unattended = false; if (tools.length) existing.tools = tools; save(folder, existing); }
    return { run: existing, resumed: true };
  }
  const { profile } = profiles.load(folder);
  const run = {
    schema_version: 1, id, kind, date, started_at: now.toISOString(), closed_at: null, unattended: !!unattended,
    profile_hash: hash(profile), profile, rules_frozen: true, tools,
    stage: STAGES[kind][0],
    stages: Object.fromEntries(STAGES[kind].map((s) => [s, { status: 'pending' }])),
    tasks: [], also_due: 0,
  };
  return { run: save(folder, run), resumed: false };
}

// ---- journal and findings ------------------------------------------------------------------

function lines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
const journalFile = (folder) => path.join(stateDir(folder), 'journal.jsonl');
const findingsFile = (folder) => path.join(stateDir(folder), 'findings.jsonl');

function appendLines(file, rows) {
  if (!rows.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const before = fs.existsSync(file) ? fs.statSync(file).size : 0;
  fs.appendFileSync(file, text);
  if (fs.statSync(file).size !== before + Buffer.byteLength(text)) throw new Error(`write to ${file} did not stick`);
}

function deferredIds(folder) {
  const out = {};
  for (const j of lines(journalFile(folder))) if (j.decision === 'deferred' && j.defer_until) out[j.id] = j.defer_until;
  return out;
}

// ---- research ------------------------------------------------------------------------------

// Everything the rules read: the snapshot, the consolidated book, findings and the clock.
function ruleInput(folder, profile, snap, prev, now, edition, corporateActions = []) {
  return { snap, prev, profile, c: snap ? snapshotLib.consolidate(snap, profile) : null, findings: lines(findingsFile(folder)), marks: marksLib.load(folder), now, today: istDate(now), edition, corporateActions };
}

function heldSymbols(snap) {
  const s = new Set();
  for (const b of Object.values((snap && snap.brokers) || {})) for (const h of b.holdings || []) if (h.type === 'equity') s.add(h.symbol);
  return [...s].sort();
}

function brief(run, snap, now) {
  const items = [];
  const soon = new Date(now.getTime() + RESULTS_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const today = istDate(now);
  for (const sym of heldSymbols(snap)) {
    const v = run.profile.verdicts[sym];
    if (!v) continue;
    const results = v.next_results && v.next_results >= today && v.next_results <= soon;
    const metrics = [...new Set((v.tripwires || []).map((t) => t.metric))];
    if (results || metrics.length) items.push({ symbol: sym, why: results ? `results due ${v.next_results}` : 'tripwires', metrics: metrics.length ? metrics : ['sales_growth_yoy_pct', 'profit_growth_yoy_pct'] });
  }
  return { items, corporate_actions: { symbols: heldSymbols(snap), ask: 'bonus, split or demerger ex-dates in the next 30 days' } };
}

function validateFinding(f, allowed, today) {
  const errs = [];
  if (!f || typeof f !== 'object') return ['not an object'];
  if (!allowed.has(f.symbol)) errs.push('symbol not in the brief');
  if (!profiles.METRICS.includes(f.metric)) errs.push(`metric not one of the known metrics`);
  const status = f.status || 'found';
  if (!['found', 'not_found', 'blocked_source'].includes(status)) errs.push('status: found | not_found | blocked_source');
  if (status === 'found' && (typeof f.value !== 'number' || Number.isNaN(f.value))) errs.push('value: a number');
  if (status !== 'found' && f.value !== undefined) errs.push(`value must be absent when ${status}`);
  if (!f.period || !String(f.period).trim()) errs.push('period required');
  if (!/^https?:\/\//.test(String(f.source_url || ''))) errs.push('source_url: http(s) link required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f.accessed || '')) || f.accessed > today) errs.push('accessed: a date, not after today');
  return errs;
}

function submitResearch(folder, runId, { findings = [], corporate_actions }, now) {
  const run = load(folder, runId);
  if (!run) throw new Error(`no run ${runId}`);
  if (run.stage !== 'research') return { ok: false, error: `run is at ${run.stage}, not research` };
  const st = run.stages.research;
  const allowed = new Set((st.brief || []).map((b) => b.symbol));
  const today = istDate(now);
  const accepted = [];
  const rejected = [];
  for (const f of findings) {
    const errs = validateFinding(f, allowed, today);
    if (errs.length) rejected.push({ finding: f, reasons: errs });
    else accepted.push({ ...f, status: f.status || 'found' });
  }
  appendLines(findingsFile(folder), accepted.map((f) => ({ ...f, run_id: run.id })));
  st.findings = [...(st.findings || []), ...accepted];
  if (Array.isArray(corporate_actions)) st.corporate_actions = corporate_actions;
  save(folder, run);
  return { ok: true, accepted, rejected };
}

// ---- verify --------------------------------------------------------------------------------

function check(expect, row) {
  if (!expect || expect.kind === 'none') return true;
  if (!row) return (expect.kind === 'gtt_stop' && expect.none) || expect.kind === 'holding_qty';
  const codes = new Set(row.issues.map((i) => i.code));
  if (expect.kind === 'gtt_qty') return !codes.has('no_gtt') && !codes.has('qty_short') && !(expect.exact && codes.has('double_coverage'));
  if (expect.kind === 'gtt_stop') {
    if (expect.none) return row.stop === null;
    if (expect.min_stop !== undefined) return row.stop !== null && row.stop >= expect.min_stop - 0.05;
    return row.stop !== null && row.stop <= expect.max_stop;
  }
  if (expect.kind === 'holding_qty') return row.qty <= expect.max_qty;
  if (expect.kind === 'gtt_target') return row.target !== null && expect.target && Math.abs(row.target - expect.target) / expect.target < 0.01;
  return false;
}

// ---- the stage machine ---------------------------------------------------------------------

const pass = (extra = {}) => ({ pass: true, next: [], ...extra });
const wait = (reason, needs, next = []) => ({ pass: false, reason, needs, next });

function taskQuestion(t, n) {
  const why = t.why.measurements.map((m) => `${m.name.replace(/_/g, ' ')}: ${m.value}${m.base ? ` (${m.base})` : ''}`).join('; ');
  return {
    questions: [{
      header: t.id, multiSelect: false,
      question: `${n}. ${t.title}. Why: your rule ${t.why.rule_ref}. ${why}. ${t.executor === 'plugin' ? 'Approving drafts the change; nothing is placed until you click Yes on that draft.' : 'You do this one yourself; Claude gives the steps.'}`,
      options: [{ label: 'Approve', description: `${t.options[0].label}. ${effects.line(t.options[0].effects)}`.slice(0, 300) }, { label: 'Defer', description: 'Ask again later' }, { label: 'Decline', description: t.options[t.options.length - 1].label }],
    }],
  };
}

async function stage(folder, run, now, deps) {
  const st = run.stages[run.stage];
  const snapFresh = () => { const s = deps.latestSnapshot(folder); return s && istDate(new Date(s.taken_at)) === run.date ? s : null; };
  switch (run.stage) {
    case 'connect': {
      const r = deps.connect({ tools: run.tools, skip: st.skip || [], unattended: run.unattended }, run.profile, now);
      st.brokers = r.brokers;
      st.skipped_brokers = Object.entries(r.brokers).filter(([, b]) => b.status !== 'live').map(([b]) => b);
      return r.ready ? pass({ text: r.text }) : wait('brokers not connected', Object.entries(r.brokers).filter(([, b]) => b.status !== 'live').map(([b, s]) => `${b}: ${s.status}`), [...r.next, ...r.manual.map((m) => ({ do: 'manual', steps: m.steps, then: 'review_next' }))]);
    }
    case 'pull': {
      const r = await deps.refresh(folder);
      const s = snapFresh();
      if (!s) return wait('no snapshot today', ['refresh did not write today\'s snapshot'], []);
      st.snapshot = run.date;
      return pass({ text: r && r.text ? r.text.split('\n').slice(0, 6).join('\n') : '' });
    }
    case 'research': {
      if (!st.brief) {
        const b = brief(run, snapFresh() || deps.latestSnapshot(folder), now);
        st.brief = b.items;
        st.corporate_brief = b.corporate_actions;
      }
      const have = new Set((st.findings || []).map((f) => `${f.symbol}|${f.metric}`));
      const missing = st.brief.flatMap((b) => b.metrics.filter((m) => !have.has(`${b.symbol}|${m}`)).map((m) => `${b.symbol} ${m}`));
      if (!Array.isArray(st.corporate_actions)) missing.push('corporate-action check for held stocks');
      if (missing.length) return wait(`${missing.length} research item(s) missing`, missing, [{ do: 'research', brief: { items: st.brief, corporate_actions: st.corporate_brief }, then: 'research_submit' }]);
      return pass();
    }
    case 'evaluate': {
      const snap = snapFresh() || deps.latestSnapshot(folder);
      const prev = snap ? deps.previousSnapshot(folder, istDate(new Date(snap.taken_at))) : null;
      const live = Object.entries((run.stages.connect && run.stages.connect.brokers) || {}).filter(([, b]) => b.status === 'live').map(([b]) => b);
      const r = decisions.evaluate(ruleInput(folder, run.profile, snap, prev, now, deps.edition, (run.stages.research && run.stages.research.corporate_actions) || []), { deferred: deferredIds(folder), today: run.date, live });
      run.tasks = r.tasks;
      run.also_due = r.also_due;
      st.task_ids = r.tasks.map((t) => t.id);
      st.also_due = r.also_due;
      st.not_set = r.not_set;
      // Friday: decisions older than the read-back window, beside what the same rules measure now.
      if (run.kind === 'friday') {
        st.readback = journal.readback(folder, { olderThanDays: run.profile.review.readback_after_days, now, current: r.all });
        return pass({ text: st.readback.length ? ['Read-back of earlier decisions:', ...st.readback.map((x) => `- ${x.text}`)].join('\n') : 'Read-back: no decisions old enough yet.' });
      }
      return pass();
    }
    case 'propose': {
      const open = run.tasks.filter((t) => !t.decision);
      if (open.length) return wait(`${open.length} task(s) need your decision`, open.map((t) => t.id), open.map((t) => ({ do: 'ask', question: taskQuestion(t, run.tasks.indexOf(t) + 1), then: 'task_decide' })));
      return pass();
    }
    case 'execute': {
      const next = [];
      const needs = [];
      for (const t of run.tasks.filter((x) => x.decision === 'approved' && !x.outcome)) {
        if (t.not_executable || t.executor === 'blocked') { t.outcome = 'blocked'; continue; }
        if (t.executor === 'investor') {
          t.manual_steps = t.manual_steps || manual.forTask(t);
          needs.push(t.id);
          next.push({ do: 'manual', task: t.id, steps: t.manual_steps, then: 'task_done' });
          continue;
        }
        if (t.draft_code === null) {
          const d = await deps.draft(folder, t);
          if (!d.ok) { t.outcome = 'blocked'; t.blocked_reason = d.text; continue; }
          if (!d.code) { t.outcome = 'executed'; t.note = 'no change needed'; continue; }
          t.draft_code = d.code;
        }
        const d = drafts.load(folder, t.draft_code);
        const used = d.rows.every((_, i) => drafts.rowUsed(folder, d.code, i));
        if (used) { t.outcome = 'executed'; t.executed_at = now.toISOString(); continue; }
        needs.push(t.id);
        next.push({ do: 'ask', task: t.id, question: { questions: [{ header: d.code, multiSelect: false, question: `Place draft ${d.code} for ${t.symbol} (${d.rows.length} call(s), shown above)?`, options: [{ label: `Yes, place ${d.code}`, description: 'Make exactly these calls' }, { label: 'No, not now', description: 'Nothing is placed' }] }] }, then: 'calls' });
        for (const [i, r] of d.rows.entries()) if (!drafts.rowUsed(folder, d.code, i)) next.push({ do: 'call', task: t.id, tool: r.tool, args: r.args, only_if: `Yes, place ${d.code}`, why: r.reason || t.title });
      }
      if (next.length) return wait(`${needs.length} approved task(s) not done yet`, needs, next);
      st.at = now.toISOString();
      return pass();
    }
    case 'verify': {
      // A decision with no broker effect, or a change that turned out not to be needed, has nothing to read back.
      for (const t of run.tasks.filter((x) => ['executed', 'handed_over'].includes(x.outcome) && (x.expect.kind === 'none' || x.note === 'no change needed'))) {
        t.outcome = 'confirmed';
        t.verified_at = now.toISOString();
      }
      const touched = run.tasks.filter((t) => ['executed', 'handed_over'].includes(t.outcome));
      if (!touched.length) return pass();
      const since = new Date(run.stages.execute.at || run.started_at);
      const caps = ['holdings', 'gtts'];
      const stale = caps.filter((c) => { const r = session.read('kite', c); return !r || !r.ok || new Date(r.at) < since; });
      if (stale.length) {
        const gen = toolmap.generation('kite', run.tools.filter((n) => toolmap.resolve(n, {}).broker === 'kite'));
        const calls = toolmap.readCalls('kite', gen).filter((c) => stale.includes(c.cap));
        const full = (bare) => run.tools.find((n) => { const r = toolmap.resolve(n, {}); return r.broker === 'kite' && r.tool === bare; }) || bare;
        return wait('a fresh read is needed to verify', stale.map((c) => `kite ${c}`), calls.map((c) => ({ do: 'call', tool: full(c.tool), args: c.args, why: `verify: fresh ${c.cap}` })));
      }
      await deps.refresh(folder);
      const snap = deps.latestSnapshot(folder);
      const a = gtt.audit(snap, null, run.profile, { today: run.date, marks: marksLib.load(folder) });
      for (const t of touched) {
        const ok = check(t.expect, a.rows.find((r) => r.symbol === t.symbol));
        t.outcome = ok ? 'confirmed' : 'not_confirmed';
        t.verified_at = now.toISOString();
      }
      const bad = touched.filter((t) => t.outcome === 'not_confirmed' && t.executor === 'plugin');
      if (bad.length) return wait('executed but not confirmed by the fresh read', bad.map((t) => `${t.symbol}: ${t.title}`), []);
      return pass();
    }
    case 'record': {
      // Writes once: journal, log, bundle, dashboard files. Then the run waits until the model
      // confirms Todoist and the dashboard were updated (FR-022: say which did not).
      if (!st.written) {
        const decided = run.tasks.filter((t) => t.decision);
        appendLines(journalFile(folder), decided.map((t) => ({ ...t, run_id: run.id })));
        deps.log(folder, `Review ${run.id}: ${summaryLine(run)}${run.tasks.length ? `\n${run.tasks.map((t) => `- ${t.title}: ${t.decision || 'listed'}${t.outcome ? `, ${t.outcome}` : ''}`).join('\n')}` : ''}`);
        deps.exportBundle(folder);
        st.dashboard_files = deps.exportDashboard(folder).files;
        st.written = now.toISOString();
      }
      const got = deps.record || {};
      if (got.todoist) st.todoist = got.todoist;
      if (got.dashboard) st.dashboard = got.dashboard;
      const ops = run.tasks.map((t) => {
        const ext = `pc:${t.id}`;
        if (t.outcome === 'confirmed') return { op: 'complete', external_id: ext };
        if (t.decision === 'declined') return { op: 'complete', external_id: ext, note: 'declined' };
        return { op: 'create', external_id: ext, content: t.title, description: `${t.why.rule_ref}${t.outcome ? ` · ${t.outcome}` : ''}`, due: t.defer_until || null };
      });
      const pending = [];
      const next = [];
      if (!st.todoist) { pending.push('Todoist'); next.push({ do: 'todoist', ops, then: 'review_next with record.todoist = synced (or skipped if the investor said so)' }); }
      if (!st.dashboard) { pending.push('dashboard'); next.push({ do: 'dashboard', files: st.dashboard_files, then: 'review_next with record.dashboard = updated (or skipped)' }); }
      if (pending.length) return wait(`waiting for ${pending.join(' and ')} to be updated`, pending, next);
      st.summary = summaryLine(run);
      const skipped = ['todoist', 'dashboard'].filter((k) => st[k] !== 'synced' && st[k] !== 'updated');
      if (skipped.length) run.note_skipped = skipped;
      return pass();
    }
    default:
      throw new Error(`unknown stage ${run.stage}`);
  }
}

function summaryLine(run) {
  const n = (f) => run.tasks.filter(f).length;
  return `${n((t) => t.outcome === 'confirmed')} done, ${n((t) => t.decision === 'deferred')} deferred, ${n((t) => t.outcome === 'blocked')} blocked`;
}

function proposeText(run) {
  const L = run.tasks.map((t, i) => {
    const m = t.why.measurements.map((x) => (x.name === 'finding' ? String(x.value) : `${x.name.replace(/_/g, ' ')} ${x.value} (base: ${x.base})`)).join('; ');
    const at = t.why.measurements.find((x) => x.as_of);
    return `${i + 1}. ${t.title}  · ${t.executor} · ${t.urgency.replace('_', ' ')}${t.not_executable ? ` · ${t.not_executable}` : ''}\n   Why: your rule ${t.why.rule_ref}: ${m}${at ? ` (${istStamp(new Date(at.as_of))})` : ''}\n   Options: ${t.options.map((o) => o.label.toLowerCase()).join(' · ')}${t.options[0].effects ? `\n   ${effects.line(t.options[0].effects)}` : ''}${t.decision ? `\n   Decided: ${t.decision}` : ''}`;
  });
  if (run.also_due) L.push(`Also due: ${run.also_due} (shown next run)`);
  const notSet = (run.stages.evaluate && run.stages.evaluate.not_set) || [];
  if (notSet.length) L.push(`Not set: ${notSet.join(', ')}`);
  return L.length ? L.join('\n') : 'Nothing needs a decision today.';
}

async function next(folder, runId, now, deps) {
  let run = load(folder, runId);
  if (!run) throw new Error(`no run ${runId}: call review_start`);
  const order = STAGES[run.kind];
  const notes = [];
  if (hash(profiles.load(folder).profile) !== run.profile_hash) notes.push('Your profile changed since this run started; the run keeps the rules it started with.');
  let gate = { pass: true };
  let next = [];
  const texts = [];
  while (run.stage !== 'closed') {
    const r = await stage(folder, run, now, deps);
    const st = run.stages[run.stage];
    if (r.text) texts.push(r.text);
    if (!r.pass) {
      st.status = 'waiting';
      Object.assign(st, { reason: r.reason, needs: r.needs });
      gate = { pass: false, reason: r.reason, needs: r.needs };
      next = r.next;
      break;
    }
    st.status = 'passed';
    st.at = st.at || now.toISOString();
    delete st.reason; delete st.needs;
    next = r.next;
    // Unattended runs stop after research; end-of-day runs list tasks and record.
    // Unattended runs evaluate, then stop before propose and wait for the investor (FR-025).
    if (run.unattended && run.stage === 'evaluate') {
      run.stage = 'propose';
      run.stages.propose.status = 'waiting';
      gate = { pass: false, reason: 'unattended: waiting for you to review the tasks', needs: run.tasks.map((t) => t.id) };
      next = [];
      break;
    }
    const i = order.indexOf(run.stage);
    run.stage = i + 1 < order.length ? order[i + 1] : 'closed';
    if (run.stage === 'closed') run.closed_at = now.toISOString();
    if (next.length) break;
  }
  save(folder, run);
  const text = render(run, gate, texts, notes);
  return { ok: true, run: run.id, stage: run.stage, gate, next, tasks: ['propose', 'execute', 'verify', 'record', 'closed'].includes(run.stage) ? run.tasks : undefined, text };
}

function render(run, gate, texts, notes) {
  const L = [`**Review ${run.id}** · stage: ${run.stage}`, ...notes, ...texts];
  if (['propose', 'execute', 'verify'].includes(run.stage)) L.push(proposeText(run));
  if (!gate.pass) L.push(`Waiting: ${gate.reason}${gate.needs && gate.needs.length ? ` (${gate.needs.slice(0, 8).join('; ')})` : ''}`);
  if (run.stage === 'closed') L.push(run.note ? `Run closed · ${run.note}` : `Run closed · ${summaryLine(run)} · log, journal, bundle${run.note_skipped && run.note_skipped.includes('todoist') ? '' : ', Todoist'}${run.note_skipped && run.note_skipped.includes('dashboard') ? '' : ', dashboard'} updated${run.note_skipped ? ` · not updated (you said skip): ${run.note_skipped.join(', ')}` : ''}`);
  return L.join('\n');
}

function decide(folder, runId, { task, decision, reason, defer_until, option }, now) {
  const run = load(folder, runId);
  if (!run) throw new Error(`no run ${runId}`);
  if (!['propose', 'execute'].includes(run.stage)) return { ok: false, error: `run is at ${run.stage}; decisions are taken at propose or execute` };
  const t = run.tasks.find((x) => x.id === task);
  if (!t) return { ok: false, error: `no task ${task} in ${runId}` };
  if (!['approved', 'deferred', 'declined'].includes(decision)) return { ok: false, error: 'decision: approved | deferred | declined' };
  if (decision === 'deferred' && !/^\d{4}-\d{2}-\d{2}$/.test(String(defer_until || ''))) return { ok: false, error: 'defer_until (YYYY-MM-DD) required for deferred' };
  Object.assign(t, { decision, reason: reason || null, decided_at: now.toISOString(), defer_until: decision === 'deferred' ? defer_until : null, decision_option: option || (decision === 'approved' ? 'do' : 'nothing') });
  save(folder, run);
  return { ok: true, task: t };
}

function done(folder, runId, { task, result, note }, now) {
  const run = load(folder, runId);
  if (!run) throw new Error(`no run ${runId}`);
  const t = run.tasks.find((x) => x.id === task);
  if (!t) return { ok: false, error: `no task ${task}` };
  if (t.executor !== 'investor') return { ok: false, error: 'task_done is for tasks the investor carries out; plugin tasks are confirmed from the draft and a fresh read' };
  if (!['done', 'could_not', 'skipped'].includes(result)) return { ok: false, error: 'result: done | could_not | skipped' };
  t.outcome = result === 'done' ? 'handed_over' : 'blocked';
  t.note = note || null;
  t.done_at = now.toISOString();
  save(folder, run);
  return { ok: true, task: t };
}

module.exports = { STAGES, ruleInput, start, next, load, decide, done, submitResearch, validateFinding, check, brief, runFile };
