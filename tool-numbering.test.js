// Tool Numbering (set in the app): the plugin resolves T through the tool list
// the app hands it. Slot numbering hands Tool N in slot N (the library's tool
// for that slot keeps T = N); Tool ID numbering hands the library as stored.
// Run: node tool-numbering.test.js
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const assert = require('assert');
function run(command, tools, tool = 0) {
  const code = fs.readFileSync(path.join(__dirname, 'commands.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
  const ctx = { console, pluginContext: { armTlsWriteback() {}, getFirmwareSetting() { return null; } } };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__api = { onBeforeCommand, buildInitialConfig };', ctx);
  const settings = ctx.__api.buildInitialConfig({ toolSetter: { x: 10, y: 20, z: -80 }, pocket1: { x: 100, y: 50, z: -60 }, pockets: 6 });
  const cmds = [{ command, isOriginal: true, displayCommand: null }];
  const ms = { tool, toolLengthSet: true, mpos: { x: 0, y: 0, z: 0 } };
  return ctx.__api.onBeforeCommand(cmds, { machineState: ms, tools, safeZHeight: -5 }, settings).map(c => c.command).join('\n');
}
const slotList = [1, 2, 3, 4, 5, 6].map((n) => ({ toolId: n, toolNumber: n }));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('Slot numbering: T2 is pocket 2', () => {
  const out = run('M6 T2', slotList);
  assert.match(out, /M61 Q2\b/);
  assert.doesNotMatch(out, /MANUAL_LOAD_TOOL_/);
});

t("Slot numbering: the Manual button's T<size + 1> is a hand load", () => {
  const out = run('M6 T7', slotList);
  assert.match(out, /MANUAL_LOAD_TOOL_7\b/);
});

t('Tool ID numbering: a tool in a pocket loads from it by its ID', () => {
  const out = run('M6 T300', [{ toolId: 300, toolNumber: 2 }, { toolId: 50, toolNumber: null }]);
  assert.match(out, /M61 Q300\b/);
  assert.doesNotMatch(out, /MANUAL_LOAD_TOOL_/);
});

t('Tool ID numbering: a tool in no pocket is a hand load', () => {
  const out = run('M6 T50', [{ toolId: 300, toolNumber: 2 }, { toolId: 50, toolNumber: null }]);
  assert.match(out, /MANUAL_LOAD_TOOL_50\b/);
});

console.log(`${n} passed`);
