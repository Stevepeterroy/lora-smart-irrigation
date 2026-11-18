const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function harness() {
  const callbacks = {};
  const sandbox = { console: {log() {}}, navigator: {onLine: true}, localStorage: {getItem() {return null;}}, document: {addEventListener() {}}, window: {} };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8').replace("document.addEventListener('DOMContentLoaded', init);", `
    updateHeartbeatUI = updateMotorUI = updateCurrentAnalyticsUI = updateUsageUI = syncMotorRuntime = () => {};
    globalThis.api = {state, connectionState, listen(refs) {dbRefs=refs;setupFirebaseListeners();}};
  `);
  vm.runInContext(source, sandbox);
  sandbox.api.listen(new Proxy({}, {get: (_, k) => ({on(_, cb) {callbacks[k]=cb;}, orderByChild() {return this;}, startAt() {return this;}})}));
  return {api: sandbox.api, callbacks, emit(k, value) {callbacks[k]({val: () => value});}};
}
test('replayed old heartbeats stay stale after reconnect; fresh server timestamps restore reachability', () => {
  const h=harness(); const now=Date.now();
  h.emit('serverTimeOffset', 0);h.emit('firebaseConnected', true);
  h.emit('homeLastSeen', (now-120000)/1000);h.emit('fieldLastSeen',(now-120000)/1000);
  h.emit('homeLastSeen', (now-90000)/1000);h.emit('fieldLastSeen',(now-90000)/1000);
  assert.equal(h.api.connectionState().loraAlive,false);
  h.emit('homeLastSeen',now/1000);h.emit('fieldLastSeen',now/1000);
  assert.equal(h.api.connectionState().loraAlive,true);
  h.emit('firebaseConnected',false);
  assert.equal(h.api.connectionState().loraAlive,false);
  h.emit('homeLastSeen',null);h.emit('fieldLastSeen',null);
  assert.equal(h.api.state.lastFieldUpdate,0);
});
test('missing or malformed amps remain unknown and zero is a valid measurement', () => {
  const h=harness();
  for(const v of [null,{},'bad',-1,NaN]) {h.emit('currentAmps',v);assert.equal(h.api.state.motorCurrent,null);}
  for(const v of [0,5.23]) {h.emit('currentAmps',v);assert.equal(h.api.state.motorCurrent,v);}
});
