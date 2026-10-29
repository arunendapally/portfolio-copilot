'use strict';
// Protection and emergency-fund check against the investor's own recorded inputs.

const MIN_MONTHS = 6;
const MAX_MONTHS = 12;

function check(profile) {
  const p = profile.protection;
  const findings = [];
  let months = null;
  if (p.emergency_fund_inr === null || p.monthly_expenses_inr === null) {
    findings.push({ level: 'info', text: 'Emergency fund or monthly expenses not recorded: buffer cannot be measured' });
  } else if (p.monthly_expenses_inr > 0) {
    months = p.emergency_fund_inr / p.monthly_expenses_inr;
    if (months < MIN_MONTHS) findings.push({ level: 'warn', text: `Emergency fund covers ${months.toFixed(1)} months of expenses; target ${MIN_MONTHS}-${MAX_MONTHS}` });
  }
  if (p.term_cover_inr === null) findings.push({ level: 'info', text: 'Term cover sum assured not recorded' });
  if (p.health_cover === 'unknown') findings.push({ level: 'info', text: 'Health insurance status not recorded' });
  else if (p.health_cover === 'none') findings.push({ level: 'warn', text: 'No health insurance recorded' });
  return { months, findings };
}

module.exports = { check, MIN_MONTHS, MAX_MONTHS };
