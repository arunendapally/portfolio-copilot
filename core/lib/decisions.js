'use strict';
// Runs the rule evaluators and returns the tasks for a review (spec 002 plan section 5).
// Evaluators are added per user story; v0.8 has the GTT rules.

const tasks = require('./tasks');
const gttGaps = require('./rules/gtt_gaps');

const RULES = [gttGaps];

function evaluate(input, { deferred = {}, today, live = [] } = {}) {
  const all = RULES.flatMap((r) => r.evaluate(input));
  return tasks.select(all, { deferred, today, live });
}

module.exports = { evaluate, RULES };
