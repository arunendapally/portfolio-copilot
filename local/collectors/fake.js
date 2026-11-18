'use strict';
// A collector for tests: writes the captures it is given, through the same path real collectors use.

const c = require('./index');

module.exports = function fake({ broker = 'kite', data = {}, state = 'ready', now = () => new Date() } = {}) {
  return {
    broker,
    async status() { return state === 'ready' ? { state, detail: 'fake' } : { state, detail: 'fake needs a login', login: { steps: ['log in'] } }; },
    async login() { return { state: 'ready', detail: 'fake' }; },
    async pull(caps = Object.keys(data)) {
      if (state !== 'ready') return { written: [], partial: [], errors: ['not logged in'], state };
      const written = [];
      for (const cap of caps.filter((x) => data[x] !== undefined)) { c.save(broker, cap, data[cap], { tool: `local:${broker}:fake`, now: now() }); written.push(cap); }
      return { written, partial: [], errors: [], state: 'ready' };
    },
  };
};
