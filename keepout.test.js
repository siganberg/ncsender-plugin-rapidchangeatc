// Pro keepout: the tool change and $slotN carry `$keepout_off` on their G53
// moves so they can enter the ATC Zone; the move back to where the change
// started keeps its check. Run: node keepout.test.js
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const assert = require('assert');
function run(command, edition) {
  const code = fs.readFileSync(path.join(__dirname, 'commands.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
  const ctx = { console, pluginContext: { armTlsWriteback() {}, getFirmwareSetting() { return null; } } };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__api = { onBeforeCommand, buildInitialConfig };', ctx);
  const settings = ctx.__api.buildInitialConfig({ toolSetter: { x: 10, y: 20 }, pocket1: { x: 100, y: 50 }, pockets: 6 });
  const cmds = [{ command, isOriginal: true, displayCommand: null }];
  const ms = { tool: 1, toolLengthSet: true, mpos: { x: 300, y: -200, z: 0 } };
  return ctx.__api.onBeforeCommand(cmds, { machineState: ms, tools: [], safeZHeight: -5, edition }, settings).map(c => c.command.trim());
}
const g53 = (lines) => lines.filter(l => /G53/.test(l));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('Pro: every G53 move but the return carries $keepout_off', () => {
  const lines = g53(run('M6 T2', 'pro'));
  const ret = lines.filter(l => /X300 Y-200/.test(l));
  assert.strictEqual(ret.length, 1);
  assert.ok(!/keepout_off|ncs-checked/.test(ret[0]), ret[0]);
  lines.filter(l => l !== ret[0]).forEach(l => assert.ok(l.startsWith('$keepout_off G53'), l));
});
t('Pro: $slot3 and $TLS carry $keepout_off', () => {
  const slot = g53(run('$slot3', 'pro'));
  assert.ok(slot.length >= 2);
  slot.forEach(l => assert.ok(l.startsWith('$keepout_off G53'), l));
  g53(run('$TLS', 'pro')).forEach(l => assert.ok(l.startsWith('$keepout_off G53'), l));
});
t('Community: no prefix, no marker', () => {
  run('M6 T2', 'community').forEach(l => assert.ok(!/keepout_off|ncs-checked/.test(l), l));
});
console.log(`${n} passed`);
