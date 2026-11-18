'use strict';
// Connect first, then work (spec 002 US2, contracts/pc-commands.md "connect"). One call per
// round: it looks at what the capture hook saved and returns the next broker calls, every human
// step for all brokers at once, and `ready` when each broker is live or skipped.
//
// Sequence per broker: Kite's session check first (it says whether a read will renew the
// session); then the full reads from the tool map; a login only after a read came back with a
// login error. Kotak's cheap read (limits) is one of its two full reads, so it has no extra step.

const session = require('./session');
const inputs = require('./inputs');
const toolmap = require('./brokers/toolmap');
const { istStamp } = require('./format');

const SESSION_MAX_AGE_MS = 30 * 60 * 1000;
// Statuses that end the connect loop: live, skipped, or a failure no login fixes.
const SETTLED = new Set(['live', 'skipped', 'outage', 'format_error', 'tools_changed']);
const NAME = { kite: 'Kite', kotak: 'Kotak Neo', ibkr: 'IBKR' };

// The full tool name present in this chat for a bare tool name, e.g. "gtt" -> "mcp__kite__gtt".
function fullName(tools, broker, bare) {
  return tools.find((n) => { const r = toolmap.resolve(n, {}); return r.broker === broker && r.tool === bare; }) || bare;
}

function callStep(tools, broker, c, why) {
  return { do: 'call', tool: fullName(tools, broker, c.tool), args: { ...c.args }, why };
}

function kiteSession(now) {
  const rec = session.read('kite', 'session');
  if (!rec || !rec.ok || now - new Date(rec.at) > SESSION_MAX_AGE_MS) return null;
  const j = session.asJson(rec.text);
  return j && typeof j === 'object' ? j : null;
}

function readSteps(tools, broker, row, caps) {
  return row.calls.filter((c) => (caps ? caps.includes(c.cap) : c.required)).map((c) => callStep(tools, broker, c, `read ${NAME[broker]} ${c.cap}`));
}

function loginSteps(broker, profile, tools) {
  if (broker === 'kotak') {
    const ucc = (profile.brokers.kotak && profile.brokers.kotak.ucc) || '<your UCC>';
    return {
      next: [{ do: 'call', tool: fullName(tools, 'kotak', toolmap.loginCall('kotak').tool), args: { ucc }, why: 'start the Kotak Neo QR login' }],
      manual: { broker, steps: ['Open the login link Kotak Neo returned', 'In the Kotak Neo app: Profile > Web Login > scan the QR', 'Say done; Claude validates the login and reads again'] },
    };
  }
  return {
    next: [],
    manual: { broker, steps: [`Reconnect ${NAME[broker]} in this chat's connector settings (Claude Code: /mcp) and log in`, 'Say done; Claude reads again'] },
  };
}

function connectOne(broker, { tools, profile, now, unattended, row, fromCaptures }) {
  const skip = (reason, as_of = null) => ({ status: 'skipped', as_of, detail: reason, next: [], manual: null });
  // Fresh, complete data is live whoever read it: the chat's broker tools or the local engine.
  if (broker !== 'ibkr') {
    const fresh = inputs.pull(broker, profile, now);
    if (fresh.status === 'live') return { status: 'live', as_of: fresh.as_of, detail: '', next: [], manual: null };
  }
  const mine = tools.filter((n) => toolmap.resolve(n, {}).broker === broker);
  if (!mine.length) {
    const detail = `the ${NAME[broker]} MCP is not in this chat: connect it, or skip ${broker}`;
    return unattended ? skip(detail) : { status: 'not_connected', detail, next: [], manual: { broker, steps: [`Connect the ${NAME[broker]} MCP in this chat, or say "skip ${broker}"`] } };
  }
  // Tools taken from captures are only the ones already called, so they cannot show a missing read.
  if (!fromCaptures && !row.read_path) {
    return { status: 'tools_changed', as_of: lastData(broker), detail: `no ${row.missing.join(', ')} read among this chat's ${NAME[broker]} tools. Run doctor`, next: [], manual: null };
  }

  if (broker === 'ibkr') return connectIbkr({ tools, now, unattended, row, skip });

  const r = inputs.pull(broker, profile, now);
  if (r.status === 'live') return { status: 'live', as_of: r.as_of, detail: '', next: [], manual: null };

  // Generation-2 Kite says whether a read will renew the session; ask before reading.
  if (broker === 'kite' && row.generation === 2) {
    const s = kiteSession(now);
    if (!s) {
      if (unattended) return skip(`not read in this chat: ${r.detail}`, r.as_of || lastData(broker));
      const sc = toolmap.sessionCall('kite', 2);
      return { status: 'checking', detail: 'checking the Kite session', next: [{ do: 'call', tool: fullName(tools, 'kite', sc.tool), args: sc.args, why: 'check whether Kite renews by itself' }], manual: null };
    }
    if (s.kite_session_expired === true && s.refresh_available === false) {
      if (unattended) return skip('Kite session expired and cannot renew without you', lastData(broker));
      const l = loginSteps(broker, profile, tools);
      return { status: 'needs_login', detail: 'Kite session expired and will not renew by itself', next: l.next, manual: l.manual };
    }
  }

  if (r.status === 'needs_login') {
    if (unattended) return skip(`${NAME[broker]} wants a login`, lastData(broker));
    const l = loginSteps(broker, profile, tools);
    return { status: 'needs_login', detail: r.detail, next: l.next, manual: l.manual };
  }
  // Nothing the investor can do now: reported, and it does not hold up ready.
  if (SETTLED.has(r.status)) return { status: r.status, as_of: lastData(broker), detail: r.detail, next: [], manual: null };
  // not_connected (nothing read yet) or stale: make the reads.
  if (unattended) return skip(`${r.status.replace('_', ' ')}: ${r.detail}`, r.as_of || lastData(broker));
  return { status: r.status === 'stale' ? 'stale' : 'reading', detail: r.detail, next: readSteps(tools, broker, row), manual: null };
}

function connectIbkr({ tools, now, unattended, row, skip }) {
  const recs = row.calls.filter((c) => c.required).map((c) => [c, session.read('ibkr', c.cap)]);
  const fresh = recs.every(([, r]) => r && r.ok && now - new Date(r.at) <= inputs.MAX_AGE_MS);
  if (fresh) {
    const as_of = new Date(Math.min(...recs.map(([, r]) => new Date(r.at).getTime()))).toISOString();
    return {
      status: 'live', as_of, detail: 'read; ingest it with a dated FX rate (without one IBKR is left out of totals)',
      next: [{ do: 'call', tool: 'ingest', args: { broker: 'ibkr', currency: 'USD', holdings: '<positions from the read>', cash: '<cash from balances>', fx_rate: '<INR per USD>', fx_source: '<where and when the rate is from>' }, why: 'IBKR holdings join the totals only with a dated FX rate' }],
      manual: null,
    };
  }
  if (unattended) return skip('IBKR not read in this chat', lastData('ibkr'));
  return { status: 'reading', detail: 'read IBKR', next: readSteps(tools, 'ibkr', row), manual: null };
}

function lastData(broker) {
  const r = session.read(broker, 'holdings');
  return r && r.ok ? r.at : null;
}

function connect({ tools = [], skip = [], unattended = false, fromCaptures = false }, profile, now) {
  const rows = toolmap.doctor(tools, profile);
  const enabled = Object.entries(profile.brokers || {}).filter(([b, v]) => toolmap.BROKERS[b] && v && v.enabled).map(([b]) => b);
  const brokers = {};
  const next = [];
  const manual = [];
  for (const b of enabled) {
    if (skip.includes(b)) { brokers[b] = { status: 'skipped', as_of: lastData(b), detail: 'skipped by you' }; continue; }
    const row = rows.find((x) => x.broker === b);
    const r = connectOne(b, { tools, profile, now, unattended, row, fromCaptures });
    brokers[b] = { status: r.status, as_of: r.as_of || null, detail: r.detail };
    next.push(...r.next);
    if (r.manual) manual.push(r.manual);
  }
  // A live IBKR still carries its ingest step; it does not hold up `ready`.
  const ready = Object.values(brokers).every((b) => SETTLED.has(b.status));
  return { ok: true, ready, brokers, next, manual, text: render(brokers, ready, manual, now) };
}

function render(brokers, ready, manual, now) {
  const when = (iso) => (iso ? istStamp(new Date(iso)) : 'no data');
  const lines = Object.entries(brokers).map(([b, s]) => `${b}: ${s.status.replace('_', ' ')}${s.status === 'live' ? `, data ${when(s.as_of)}` : s.detail ? `, ${s.detail}` : ''}`);
  if (!ready) {
    if (manual.length) lines.push('', 'Needs you, all at once:', ...manual.map((m) => `- ${NAME[m.broker]}: ${m.steps.join('; ')}`));
    return lines.join('\n');
  }
  const live = Object.entries(brokers).filter(([, s]) => s.status === 'live').map(([b]) => b);
  const skipped = Object.entries(brokers).filter(([, s]) => s.status !== 'live');
  lines.push(skipped.length
    ? `Connected: ${live.join(', ') || 'none'} · skipped: ${skipped.map(([b, s]) => `${b} (${s.status === 'skipped' ? '' : `${s.status.replace('_', ' ')}, `}data from ${when(s.as_of)})`).join(', ')}`
    : `All connected · ${istStamp(now)}`);
  return lines.join('\n');
}

module.exports = { connect };
