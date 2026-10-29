#!/usr/bin/env node
'use strict';
// PostToolUse (AskUserQuestion): the only place an approval is recorded. It reads the
// investor's own click ("Yes, place D7K2") from the question's result, so the model cannot
// approve on the investor's behalf. Pre-filled answers are blocked by the order gate.

const drafts = require('../core/lib/drafts');
const { readStdin, candidateFolders } = require('./lib');

// Codes the investor clicked "Yes, place <code>" for, in a question that names the code and
// also offered a "No" option.
function clickedYes(input) {
  if (String(input.tool_name || '') !== 'AskUserQuestion') return [];
  const res = input.tool_response && typeof input.tool_response === 'object' ? input.tool_response : {};
  const questions = res.questions || (input.tool_input && input.tool_input.questions) || [];
  const answers = res.answers || (input.tool_input && input.tool_input.answers) || {};
  const codes = [];
  for (const q of questions) {
    const m = String(answers[q.question] || '').match(drafts.YES_RE);
    if (!m) continue;
    const code = m[1];
    const labels = (q.options || []).map((o) => o.label);
    if (!String(q.question).includes(code) && q.header !== code) continue;
    if (!labels.includes(`Yes, place ${code}`) || !labels.some((l) => /^No\b/.test(l))) continue;
    codes.push(code);
  }
  return codes;
}

function run(input, now = new Date()) {
  const codes = clickedYes(input);
  if (!codes.length) return null;
  const parts = [];
  for (const code of codes) {
    let hit = null;
    for (const folder of candidateFolders(input)) hit = hit || drafts.approve(folder, code, now);
    if (hit) parts.push(`Investor approved ${code} (${hit.rows} rows). Make the calls listed in the draft, exactly as shown; the order gate allows each once.`);
    else parts.push(`Investor clicked Yes for ${code}, but no open draft ${code} exists in this chat or on this machine. Draft it again here.`);
  }
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: parts.join(' ') } };
}

if (require.main === module) {
  readStdin().then((raw) => {
    try {
      const out = run(JSON.parse(raw || '{}'));
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (e) {
      process.stderr.write(`[portfolio-copilot] approve hook: ${e.message}\n`);
    }
  });
}

module.exports = { run, clickedYes };
