'use strict';
// Runs the rule evaluators and returns the tasks for a review (spec 002 plan section 5):
// deterministic for the same snapshot, profile and findings; fixed priority; at most five.
// A rule whose threshold is not saved is skipped and listed once as "not set" (FR-037).

const tasks = require('./tasks');
const RULES = [
  require('./rules/gtt_gaps'),
  require('./rules/profit_lock'),
  require('./rules/tripwires'),
  require('./rules/concentration'),
  require('./rules/drift'),
  require('./rules/contributions'),
  require('./rules/loss_tolerance'),
];

function notSet(profile) {
  return RULES.flatMap((r) => (r.notSet ? r.notSet(profile) : []));
}

function evaluate(input, { deferred = {}, today, live = [] } = {}) {
  const all = RULES.flatMap((r) => r.evaluate(input));
  return { ...tasks.select(all, { deferred, today, live }), all, not_set: notSet(input.profile) };
}

module.exports = { evaluate, notSet, RULES };
