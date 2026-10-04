// M51 (hold the spindle override at 100% during the change) is grblHAL-only.
// FluidNC rejects it, and a rejected line stops the tool change, so the
// plugin leaves it out when the app says the controller has no override
// control. Run: node override-control.test.js
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const assert = require('assert');
function run(command, controller) {
  const code = fs.readFileSync(path.join(__dirname, 'commands.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
  const ctx = { console, pluginContext: { armTlsWriteback() {}, getFirmwareSetting() { return null; } } };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__api = { onBeforeCommand, buildInitialConfig };', ctx);
  const settings = ctx.__api.buildInitialConfig({ toolSetter: { x: 10, y: 20, z: -80 }, pocket1: { x: 100, y: 50, z: -60 }, parking: { x: 100, y: 50, z: 0 }, pockets: 6 });
  const context = { machineState: { tool: 1, toolLengthSet: true, mpos: { x: 0, y: 0, z: 0 } }, tools: [1, 2, 3].map(n => ({ toolId: n, toolNumber: n })), safeZHeight: -5 };
  if (controller !== undefined) context.controller = controller;
  return ctx.__api.onBeforeCommand([{ command, isOriginal: true, displayCommand: null }], context, settings).map(c => c.command).join('\n');
}
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('FluidNC (no override control): no M51 and no _speed_override', () => {
  const out = run('M6 T2', { overrideControl: false });
  assert.doesNotMatch(out, /M51/);
  assert.doesNotMatch(out, /_speed_override/);
  assert.match(out, /M61 Q2\b/, 'the tool change itself is still there');
});

t('FluidNC: loading the probe (T99) has no M51 either', () => {
  assert.doesNotMatch(run('M6 T99', { overrideControl: false }), /M51/);
});

t('grblHAL: the override is held at 100% and restored', () => {
  const out = run('M6 T2', { overrideControl: true });
  assert.match(out, /M51 P0/);
  assert.match(out, /M51 P\[#<return_spov>\]/);
});

t('an older app that does not report it: treated as grblHAL', () => {
  assert.match(run('M6 T2', undefined), /M51 P0/);
});

console.log(`${n} passed`);
