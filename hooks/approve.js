#!/usr/bin/env node
'use strict';
// UserPromptSubmit: the only place an approval is recorded. It reads the investor's own
// prompt, so the model cannot approve on the investor's behalf.

const drafts = require('../core/lib/drafts');
const { readStdin, candidateFolders } = require('./lib');

function run(input) {
  const prompt = String(input.prompt || '');
  if (!drafts.APPROVE_RE.test(prompt)) return null;
  drafts.APPROVE_RE.lastIndex = 0;
  const approved = [];
  let missing = null;
  for (const folder of candidateFolders(input)) {
    const r = drafts.approveFromPrompt(folder, prompt);
    approved.push(...r.approved);
    missing = missing === null ? r.missing : missing.filter((c) => r.missing.includes(c));
  }
  const parts = [];
  if (approved.length) parts.push(`Investor approved ${approved.map((a) => `${a.code} (${a.rows} rows)`).join(', ')}. You may now call execute_draft for exactly these codes.`);
  if (missing && missing.length) parts.push(`No open draft found for ${missing.join(', ')}; nothing was approved for it.`);
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: parts.join(' ') } };
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

module.exports = { run };
