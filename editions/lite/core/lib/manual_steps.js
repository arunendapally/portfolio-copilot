'use strict';
// Numbered steps for work the investor does themselves (spec 002 T050). Placeholders are filled
// from the task; nothing here is a number the engine did not compute.

const TEMPLATES = {
  gtt_change: [
    'Open {broker_web} > Orders > GTT.',
    'Find {symbol}. {action}',
    'Check the GTT list shows it as you intended, then say done.',
  ],
  basket: [
    'Open {broker_web} > Orders > Baskets > New basket; name it {name}.',
    'Add each row from the draft: search the symbol, pick the NSE row, set quantity and LIMIT price.',
    'Review the basket. Press Execute only if you want to buy now; then say done.',
  ],
  bank_transfer: [
    'From your bank, transfer {amount} to {to}.',
    'Wait for it to show as available cash at {to}, then say done.',
  ],
  qr_login: [
    'Open the login link {broker} returned.',
    'In the {broker} app: Profile > Web Login > scan the QR.',
    'Say done.',
  ],
  review: [
    'Look at {symbol}: {finding}.',
    'Decide whether anything should change; say done when you have looked.',
  ],
};

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));

function steps(template, vars) {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`no manual step template ${template}`);
  return t.map((s, i) => `${i + 1}. ${fill(s, vars)}`);
}

// The manual steps for a review task the investor carries out.
function forTask(task) {
  const finding = ((task.why.measurements || []).find((m) => m.name === 'finding') || {}).value || task.title;
  if (task.options.find((o) => o.id === task.decision_option && o.draft_kind === 'gtt_plan') || (task.kind.startsWith('gtt') && task.expect.kind !== 'none')) {
    return steps('gtt_change', { broker_web: 'Kite web', symbol: task.symbol, action: `${task.title}: ${finding}.` });
  }
  return steps('review', { symbol: task.symbol || 'this', finding });
}

module.exports = { TEMPLATES, steps, forTask };
