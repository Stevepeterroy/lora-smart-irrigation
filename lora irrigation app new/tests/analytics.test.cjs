const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

function harness() {
  const drawing = [];
  const context = new Proxy({}, {
    get: (_, name) => (...args) => drawing.push([name, ...args]),
    set: () => true
  });
  let visible = false;
  const canvas = {
    width: 0, height: 0,
    getContext: () => context,
    getBoundingClientRect: () => visible ? { width: 360, height: 200 } : { width: 0, height: 0 }
  };
  const sandbox = {
    console: { log() {} }, navigator: { onLine: true },
    localStorage: { getItem: () => null },
    document: { addEventListener() {} },
    window: { devicePixelRatio: 2 }
  };
  vm.createContext(sandbox);
  vm.runInContext(read('chart.js') + '\nglobalThis.MiniChart = MiniChart;', sandbox);
  // Expose closure internals only in this isolated test copy; never initialize the live app.
  vm.runInContext(read('app.js').replace("document.addEventListener('DOMContentLoaded', init);", `
    globalThis.analytics = {
      state, dom, updateCharts, updateCurrentAnalyticsUI, recordPowerPoint, setupTabNav,
      setChart(chart) { currentChart = chart; },
      listen(refs) { dbRefs = refs; setupFirebaseListeners(); }
    };
  `), sandbox);
  const api = sandbox.analytics;
  const chart = new sandbox.MiniChart(canvas, { label: '3-Phase Power', unit: '1=ON, 0=OFF', minY: 0, maxY: 1 });
  api.setChart(chart);
  api.dom.currentLiveVal = { style: {} };
  return { api, chart, canvas, drawing, sandbox, show: () => { visible = true; } };
}

test('opening Analytics redraws electricity data received while hidden', () => {
  const h = harness();
  h.api.state.psrOk = true;
  h.api.recordPowerPoint();
  h.api.updateCurrentAnalyticsUI();
  assert.equal(h.canvas.width, 0);
  let open;
  h.api.dom.navItems = [{ dataset: { tab: 'tab-analytics' }, classList: { toggle() {} }, addEventListener: (_, cb) => { open = cb; } }];
  h.api.dom.tabViews = [{ id: 'tab-analytics', classList: { toggle: h.show } }];
  h.api.setupTabNav();
  assert.doesNotThrow(() => open());
  assert.equal(h.canvas.width, 720);
  assert.ok(h.drawing.some(([method, text]) => method === 'fillText' && /^\d\d:\d\d$/.test(text)));
  assert.ok(h.drawing.some(([method]) => method === 'arc'));
});

test('fixed and automatic chart ranges render time labels without a ReferenceError', () => {
  const h = harness();
  h.show();
  for (const opts of [{ minY: 0, maxY: 1 }, {}]) {
    const chart = new h.sandbox.MiniChart(h.canvas, opts);
    assert.doesNotThrow(() => chart.setData([
      { time: Date.now() - 2 * 86400000, value: 0 }, { time: Date.now(), value: 1 }
    ]));
  }
  assert.ok(h.drawing.some(([method, text]) => method === 'fillText' && /^\d+\/\d+$/.test(text)));
});

test('Today and Yesterday use calendar boundaries, normalize seconds, and clear empty ranges', () => {
  const h = harness();
  h.show();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  h.api.state.currentHistory = [
    { time: today.getTime(), value: 1 },
    { time: (today.getTime() - 1000) / 1000, value: 0 },
    { time: yesterday.getTime(), value: 1 },
    { time: yesterday.getTime() - 1, value: 0 },
    { time: today.getTime(), value: NaN },
    { time: today.getTime(), value: 12.5 }
  ];
  h.api.updateCurrentAnalyticsUI();
  assert.equal(h.chart.data.length, 1);
  h.api.state.currentRange = 'yesterday';
  h.api.updateCurrentAnalyticsUI();
  assert.deepEqual(Array.from(h.chart.data, d => d.time), [yesterday.getTime(), today.getTime() - 1000]);
  h.api.state.currentHistory = [];
  h.api.updateCurrentAnalyticsUI();
  assert.equal(h.chart.data.length, 0);
  assert.ok(h.drawing.some(([method, text]) => method === 'fillText' && text === 'No data'));
});

test('PSR listener refreshes badge and chart, and database history cannot erase live data', () => {
  const h = harness();
  const callbacks = {};
  const refs = new Proxy({}, { get: (_, name) => ({
    on: (_, cb) => { callbacks[name] = cb; },
    orderByChild() { return this; }, startAt() { return this; }
  }) });
  h.api.listen(refs);
  callbacks.psrOk({ val: () => '0' });
  assert.equal(h.api.dom.currentLiveVal.textContent, '⛔ Unavailable');
  assert.equal(h.chart.data.at(-1).value, 0);
  callbacks.psrOk({ val: () => '1' });
  assert.equal(h.api.dom.currentLiveVal.textContent, '⚡ Available');
  assert.equal(h.chart.data.at(-1).value, 1);
  callbacks.currentHistory({ forEach: cb => cb({ val: () => ({ time: Date.now() - 3 * 86400000, value: 0 }) }) });
  assert.equal(h.chart.data.at(-1).value, 1);
  callbacks.currentHistory({ forEach() {} });
  assert.equal(h.chart.data.at(-1).value, 1);
});

test('unknown power creates no readings and live observations do not fabricate yesterday', () => {
  const h = harness();
  h.api.recordPowerPoint();
  h.api.updateCurrentAnalyticsUI();
  assert.equal(h.api.dom.currentLiveVal.textContent, '—');
  assert.equal(h.chart.data.length, 0);
  h.api.state.phaseAvailable = true;
  h.api.recordPowerPoint();
  h.api.updateCurrentAnalyticsUI();
  assert.equal(h.chart.data.length, 1);
  h.api.state.currentRange = 'yesterday';
  h.api.updateCurrentAnalyticsUI();
  assert.equal(h.chart.data.length, 0);
});
