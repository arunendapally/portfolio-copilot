'use strict';
// Rendering helpers. Everything the model shows comes through here so output is stable.

const IST_OFFSET_MIN = 330;

function istStamp(date = new Date()) {
  const d = new Date(date.getTime() + IST_OFFSET_MIN * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} IST`;
}

function istDate(date = new Date()) {
  return istStamp(date).slice(0, 10);
}

function round(n, dp = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

// Indian digit grouping: 12,34,567
function inr(n, dp = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  const neg = n < 0;
  const fixed = Math.abs(round(n, dp)).toFixed(dp);
  const [int, frac] = fixed.split('.');
  let head = int.slice(0, -3);
  const tail = int.slice(-3);
  head = head.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const body = head ? `${head},${tail}` : tail;
  return `${neg ? '-' : ''}₹${body}${frac ? '.' + frac : ''}`;
}

function pct(n, dp = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'n/a';
  return `${round(n, dp).toFixed(dp)}%`;
}

function table(headers, rows) {
  if (!rows.length) return '_none_';
  const esc = (v) => String(v === null || v === undefined ? '' : v).replace(/\|/g, '\\|');
  const out = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.map(esc).join(' | ')} |`);
  return out.join('\n');
}

module.exports = { istStamp, istDate, round, inr, pct, table };
