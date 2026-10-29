'use strict';
// US9 and constitution budgets: plugin shape, hook matchers, policy lint (eval T9),
// no proxies, no personal data, skill and size budgets.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// Every order-tool name seen in the field log (feedback.md, Jul-Oct 2026) plus core's own.
const ORDER_TOOL_NAMES = [
  'place_gtt_order', 'modify_gtt_order', 'delete_gtt_order', 'place_order', 'modify_order', 'cancel_order',
  'mcp__kite__place_gtt_order', 'mcp__kite__delete_gtt_order', 'mcp__kite__place_order', 'mcp__kite__cancel_order',
  'mcp__plugin_portfolio-copilot_kite__place_gtt_order', 'mcp__plugin_portfolio-copilot_kite__modify_gtt_order',
  'mcp__remote-devices__kite__place_gtt_order', 'mcp__remote-devices__plugin_portfolio-copilot_kite__delete_gtt_order',
  'mcp__claude_ai_Interactive_Brokers_IBKR__create_order_instruction', 'mcp__claude_ai_Interactive_Brokers_IBKR__submit_order',
];
const NOT_ORDER_TOOLS = ['mcp__kite__get_gtts', 'mcp__kite__get_orders', 'mcp__kite__get_order_history', 'mcp__claude_ai_Interactive_Brokers_IBKR__get_account_orders', 'Bash', 'mcp__kotak-neo__get_order_book'];

test('hooks.json has the documented {"hooks": {...}} shape and only command hooks guard orders', () => {
  const h = json('hooks/hooks.json');
  assert.ok(h.hooks && typeof h.hooks === 'object', 'missing top-level "hooks"');
  for (const ev of ['SessionStart', 'PostToolUse', 'PreToolUse']) assert.ok(Array.isArray(h.hooks[ev]), `${ev} missing`);
  for (const g of h.hooks.PreToolUse) for (const x of g.hooks) assert.strictEqual(x.type, 'command');
  for (const ev of Object.values(h.hooks)) for (const g of ev) for (const x of g.hooks) {
    if (x.type === 'command') {
      const m = x.command.match(/hooks\/([\w-]+\.js)/);
      assert.ok(m && fs.existsSync(path.join(ROOT, 'hooks', m[1])), `hook script missing: ${x.command}`);
    }
  }
});

test('PreToolUse matcher covers every known order tool name and nothing else', () => {
  const re = new RegExp(`^(?:${json('hooks/hooks.json').hooks.PreToolUse[0].matcher})$`);
  for (const n of ORDER_TOOL_NAMES) assert.ok(re.test(n), `not gated: ${n}`);
  for (const n of NOT_ORDER_TOOLS) assert.ok(!re.test(n), `gated by mistake: ${n}`);
});

test('gate script recognises the same names as the matcher', () => {
  const { WRITE_RE } = require('../hooks/order-gate');
  for (const n of ORDER_TOOL_NAMES) assert.ok(WRITE_RE.test(n), n);
  for (const n of NOT_ORDER_TOOLS) assert.ok(!WRITE_RE.test(n), n);
});

test('capture matcher covers broker read tools on any prefix and no writes', () => {
  const m = json('hooks/hooks.json').hooks.PostToolUse.find((g) => g.hooks.some((x) => /capture\.js/.test(x.command))).matcher;
  const re = new RegExp(m);
  for (const n of ['mcp__kite__get_holdings', 'mcp__kite__get_gtts', 'mcp__remote-devices__kite__get_margins', 'mcp__kotak-neo__get_limits', 'mcp__claude_ai_Interactive_Brokers_IBKR__get_account_positions']) assert.ok(re.test(n), n);
  for (const n of ORDER_TOOL_NAMES.concat(['Bash', 'mcp__claude_ai_Gmail__list_drafts'])) assert.ok(!re.test(n), `captured by mistake: ${n}`);
});

test('the plugin ships no MCP server and no broker client: brokers are reached through their own MCPs (#23)', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, '.mcp.json')));
  for (const f of ['core/server.js', 'core/lib/mcp-client.js', 'core/lib/brokers/kite.js', 'core/lib/brokers/kotak.js']) assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} should be gone`);
  assert.doesNotMatch(read('core/tools.js'), /ctx\.brokers|allow_remote_approval|execute_draft/);
});

test('core has zero runtime dependencies', () => {
  const pkg = json('package.json');
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length);
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(path.join(ROOT, 'core'));
  walk(path.join(ROOT, 'hooks'));
  const builtins = new Set(require('module').builtinModules);
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/require\('([^']+)'\)/g)) {
      const name = m[1].replace(/^node:/, '');
      assert.ok(name.startsWith('.') || builtins.has(name), `${path.relative(ROOT, f)} requires ${m[1]}`);
    }
  }
});

test('at most 6 skills, each under 60 lines, with frontmatter', () => {
  const skills = fs.readdirSync(path.join(ROOT, 'skills'));
  assert.ok(skills.length <= 6, `${skills.length} skills`);
  for (const s of skills) {
    const body = read(`skills/${s}/SKILL.md`);
    assert.match(body, new RegExp(`^---\\nname: ${s}\\ndescription: .+\\n---`), `${s} frontmatter`);
    assert.ok(body.split('\n').length < 60, `${s} is ${body.split('\n').length} lines`);
  }
});

test('old trigger phrases still route to a skill', () => {
  const all = fs.readdirSync(path.join(ROOT, 'skills')).map((s) => read(`skills/${s}/SKILL.md`).split('\n')[2]).join('\n').toLowerCase();
  for (const phrase of ['daily briefing', 'open session', 'eod analysis', 'audit gtts', 'review my mfs', 'risk check', 'monthly rebalance', 'crash mode', 'analyze [stock]', 'import my holdings', 'get started', 'macro brief']) {
    assert.ok(all.includes(phrase), `no skill handles "${phrase}"`);
  }
});

test('skill and agent descriptions have no angle brackets (claude.ai rejects them as XML tags, 15-Oct)', () => {
  const files = [...fs.readdirSync(path.join(ROOT, 'skills')).map((s) => `skills/${s}/SKILL.md`), ...fs.readdirSync(path.join(ROOT, 'agents')).map((a) => `agents/${a}`)];
  for (const f of files) {
    const d = (read(f).match(/^description:.*$/m) || [''])[0];
    assert.doesNotMatch(d, /[<>]/, `${f} description contains < or >`);
  }
});

// Eval T9: no instruction contradicts the 30-Sep GTT policy.
test('T9 policy lint: no skill or agent asks for tight or trailing stops', () => {
  const banned = [/trail(ed|ing)? (the )?(sl|stop)/i, /stop[- ]loss on every/i, /propose trailed/i, /tighten(ing)? (stops?|sls?) (in|during) a fall/i, /above ₹50K with no/i, /prefer two-leg/i];
  const files = [...fs.readdirSync(path.join(ROOT, 'skills')).map((s) => `skills/${s}/SKILL.md`), 'agents/fundamentals-analyst.md', 'context/house-rules.md'];
  for (const f of files) for (const re of banned) assert.doesNotMatch(read(f), re, `${f} contradicts the GTT policy (${re})`);
  assert.match(read('skills/gtt/SKILL.md'), /crash test/i);
  assert.match(read('skills/crash/SKILL.md'), /Never tighten/);
});

test('house rules: 8 numbered rules, consistent with constitution I-III', () => {
  const r = read('context/house-rules.md');
  assert.strictEqual((r.match(/^\d\. /gm) || []).length, 8);
  assert.match(r, /Yes, place <code>/);
  assert.match(r, /Never suggest securities to buy/);
  assert.match(r, /Do not re-read them from disk/);
});

test('analyze keeps source quotes end to end (eval T3, 15-Oct)', () => {
  assert.match(read('agents/fundamentals-analyst.md'), /search-result summary is not quotable/i);
  assert.match(read('skills/analyze/SKILL.md'), /unchanged: keep its format, bracketed source quotes/);
});

test('repo contains no personal data', () => {
  const ignored = read('.gitignore');
  for (const p of ['portfolio-copilot/', 'portfolio-profile.md', 'portfolio-snapshots/', 'dist/']) assert.ok(ignored.includes(p), `${p} not ignored`);
  const fixtures = fs.readdirSync(path.join(__dirname, 'fixtures')).map((f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8')).join('\n');
  assert.doesNotMatch(fixtures, /JIR116|arun|@gmail/i);
});

test('editions/lite is generated from the current source and is lite', () => {
  const { liteFiles, diffLite } = require('../scripts/build');
  const files = liteFiles();
  assert.deepStrictEqual(diffLite(files), [], 'run: node scripts/build.js');
  assert.ok(!files.has('.mcp.json'));
  assert.match(files.get('hooks/hooks.json').toString(), /order-gate\.js\\" --edition=lite/);
  assert.doesNotMatch(read('hooks/hooks.json'), /--edition=lite/, 'the full edition gate is not in deny-all mode');
  assert.strictEqual(JSON.parse(files.get('.claude-plugin/plugin.json')).name, 'portfolio-copilot-lite');
});

test('zip writer output is a valid archive', () => {
  const { zip } = require('../scripts/build');
  const z = zip(new Map([['a.txt', Buffer.from('hello')]]));
  assert.strictEqual(z.readUInt32LE(0), 0x04034b50);
  assert.strictEqual(z.readUInt32LE(z.length - 22), 0x06054b50);
});

test('plugin manifest and marketplace list both editions at the same version', () => {
  const p = json('.claude-plugin/plugin.json');
  const m = json('.claude-plugin/marketplace.json');
  assert.strictEqual(p.version, json('package.json').version);
  const names = m.plugins.map((x) => x.name);
  assert.ok(names.includes('portfolio-copilot') && names.includes('portfolio-copilot-lite'));
});

test('version handshake: broker_status warns when hooks and server differ (29-Oct)', async () => {
  const { tmpEnv, ctxAt, fakeBrokers } = require('./helpers');
  const { callTool } = require('../core/tools');
  const { manifest } = require('../core/lib/version');
  const m = manifest();
  const { folder } = tmpEnv();
  const brokers = fakeBrokers({ kite: { status: { status: 'live' } }, kotak: { status: { status: 'disabled' } } });
  const ok = await callTool('broker_status', { folder, hook_plugin: m.name, hook_version: m.version }, ctxAt('2026-10-29T05:00:00Z', brokers));
  assert.doesNotMatch(ok.text, /Version mismatch/);
  const old = await callTool('broker_status', { folder, hook_plugin: m.name, hook_version: '0.4.1' }, ctxAt('2026-10-29T05:00:00Z', brokers));
  assert.match(old.text, /hooks are v0\.4\.1 but the server is v.*start a new chat/);
  const other = await callTool('broker_status', { folder, hook_plugin: 'portfolio-copilot-lite', hook_version: m.version }, ctxAt('2026-10-29T05:00:00Z', brokers));
  assert.match(other.text, /remove one of them/);
  const out = JSON.parse(require('child_process').execFileSync(process.execPath, [path.join(ROOT, 'hooks', 'session-start.js')]).toString());
  assert.ok(out.hookSpecificOutput.additionalContext.includes(`version ${m.version}`));
});

test('versioning: one declared version, matched by package.json and the changelog', async () => {
  const { manifest } = require('../core/lib/version');
  const v = manifest().version;
  assert.match(v, /^\d+\.\d+\.\d+$/, 'semantic version');
  assert.strictEqual(JSON.parse(read('package.json')).version, v, 'package.json');
  const heading = read('CHANGELOG.md').split(/\r?\n/).find((l) => l.startsWith(`## [${v}] - `));
  assert.ok(heading && /^## \[[^\]]+\] - \d{4}-\d{2}-\d{2}\s*$/.test(heading), `CHANGELOG has no dated entry for ${v}`);
  assert.match(read('docs/release.md'), /## Versioning policy/);
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  for (const p of market.plugins) assert.strictEqual(p.version, undefined, 'marketplace entries must not carry a second version');
});
