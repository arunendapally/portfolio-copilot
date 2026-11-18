'use strict';
// IBKR collector through the Flex Web Service (research R6, decided 18-Nov-2026): a report
// token made in Client Portal (expiry the investor chooses), no IB credentials, end of day.
// Secrets: ~/.portfolio-copilot/secrets/ibkr.json { token, query_id, host? }. The Flex query
// should include Open Positions, Cash Report and Conversion Rates (to INR) sections.

const c = require('./index');

const HOST = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const elements = (xml, name) => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*/?>`, 'g'))].map((m) => attrs(m[0]));
const field = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)); return m ? m[1] : null; };

// Positions, cash and the INR rate from a Flex statement, as plain rows.
function parse(xml) {
  const positions = elements(xml, 'OpenPosition').filter((p) => !p.levelOfDetail || p.levelOfDetail === 'SUMMARY').map((p) => ({
    symbol: p.symbol, description: p.description || null, asset: p.assetCategory || null, currency: p.currency,
    qty: Number(p.position), market_price: Number(p.markPrice), market_value: Number(p.positionValue), avg_cost: p.costBasisPrice !== undefined ? Number(p.costBasisPrice) : null,
    unrealized_pnl: p.fifoPnlUnrealized !== undefined ? Number(p.fifoPnlUnrealized) : null, report_date: p.reportDate || null,
  }));
  const cash = elements(xml, 'CashReportCurrency').filter((x) => x.currency && x.currency !== 'BASE_SUMMARY').map((x) => ({ currency: x.currency, ending_cash: Number(x.endingCash), report_date: x.toDate || x.reportDate || null }));
  const rates = elements(xml, 'ConversionRate').filter((r) => r.toCurrency === 'INR').map((r) => ({ from: r.fromCurrency, rate: Number(r.rate), date: r.reportDate || null }));
  return { positions, cash, rates };
}

module.exports = function ibkr({ fetch: fetchImpl = globalThis.fetch, now = () => new Date(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 6 } = {}) {
  const secrets = () => c.readSecrets('ibkr');

  async function status() {
    const s = secrets();
    if (!s || !s.token || !s.query_id) return { state: 'needs_login', detail: 'no Flex token yet', login: { steps: ['In IBKR Client Portal: Settings > Account Settings > Reporting > Flex Web Service: enable it and create a token (choose its expiry)', 'Create a Flex Query with Open Positions, Cash Report and Conversion Rates; note its Query ID', 'Save token and query_id in ~/.portfolio-copilot/secrets/ibkr.json'] } };
    if (s.expires && s.expires < now().toISOString().slice(0, 10)) return { state: 'needs_login', detail: `the Flex token expired on ${s.expires}: make a new one in Client Portal` };
    return { state: 'ready', detail: 'Flex token on file' };
  }

  async function login() {
    return status();
  }

  async function pull() {
    const st = await status();
    if (st.state !== 'ready') return { written: [], partial: [], errors: [st.detail], state: st.state };
    const s = secrets();
    const host = s.host || HOST;
    const send = await c.get(fetchImpl, `${host}/SendRequest?t=${encodeURIComponent(s.token)}&q=${encodeURIComponent(s.query_id)}&v=3`, { 'User-Agent': 'portfolio-copilot' });
    const ref = field(send.text, 'ReferenceCode');
    if (!ref) return { written: [], partial: [], errors: [`Flex request refused: ${field(send.text, 'ErrorMessage') || field(send.text, 'ErrorCode') || send.status}`], state: 'error' };
    for (let i = 0; i < tries; i++) {
      const r = await c.get(fetchImpl, `${host}/GetStatement?t=${encodeURIComponent(s.token)}&q=${encodeURIComponent(ref)}&v=3`, { 'User-Agent': 'portfolio-copilot' });
      if (/<FlexQueryResponse/.test(r.text)) {
        const p = parse(r.text);
        c.save('ibkr', 'holdings', p.positions, { tool: 'local:ibkr:flex', now: now() });
        c.save('ibkr', 'balances', { cash: p.cash, rates: p.rates }, { tool: 'local:ibkr:flex', now: now() });
        return { written: ['holdings', 'balances'], partial: [], errors: [], state: 'ready', parsed: p };
      }
      // Still being generated: wait and ask again (IBKR: a large report may take a while).
      await wait(5000 * (i + 1));
    }
    return { written: [], partial: [], errors: ['the Flex statement was not ready after several tries; try again later'], state: 'error' };
  }

  return { broker: 'ibkr', status, login, pull, parse };
};

module.exports.parse = (xml) => module.exports().parse(xml);
