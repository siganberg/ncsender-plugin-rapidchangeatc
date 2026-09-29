// Z0 set before a Tool Length Reference (the gSender habit) must survive every
// tool setter path. Run: node zero-keep.test.js
const fs = require('fs'); const vm = require('vm'); const path = require('path');
function run(_plugin, command, ms, settingsRaw = {}, tools = []) {
  const code = fs.readFileSync(path.join(__dirname, 'commands.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
  const ctx = { console, pluginContext: { armTlsWriteback() {}, getFirmwareSetting() { return null; } } };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__api = { onBeforeCommand, buildInitialConfig };', ctx);
  const settings = ctx.__api.buildInitialConfig(settingsRaw);
  const cmds = [{ command, isOriginal: true, displayCommand: null }];
  return { lines: ctx.__api.onBeforeCommand(cmds, { machineState: ms, tools, safeZHeight: -5 }, settings).map(c => c.command) };
}
const assert = require('assert');
const cfg = { toolSetter: { x: 10, y: 20, z: -80 }, pocket1: { x: 100, y: 50, z: -60 } };
const base = { tool: 1, toolLengthSet: false, zeroSetWithoutTlr: false, zeroTool: 0, mpos: { x: 250, y: 300, z: -20 } };
const at = (l, re) => l.findIndex(x => re.test(x));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
t('M6 with a pending Z0: reference measure first, Z0 kept after the new tool', () => {
  const { lines } = run('rapidchangeatc', 'M6 T2', { ...base, zeroSetWithoutTlr: true, zeroTool: 1 }, cfg);
  const ref = at(lines, /#<_nc_ref_tlo> = #<_nc_last_tlo>/);
  const g10 = at(lines, /G10 L2 P\[#5220\] Z\[#<_cur_wcs_z_ofs> - #<_nc_ref_tlo>\]/);
  const firstNotify = lines.indexOf('$#=_tool_offset');
  assert(ref >= 0 && firstNotify > ref && g10 > firstNotify);
  assert(at(lines, /M61 Q0|M61 Q2/) > ref, 'measure happens before the swap');
});
t('M6 without a pending Z0 is unchanged', () => {
  const { lines } = run('rapidchangeatc', 'M6 T2', base, cfg);
  assert.equal(at(lines, /G10 L2|_nc_ref_tlo/), -1);
});
t('M6 T0 with a pending Z0 fixes the reference with the current tool', () => {
  const { lines } = run('rapidchangeatc', 'M6 T0', { ...base, zeroSetWithoutTlr: true, zeroTool: 1 }, cfg);
  assert(at(lines, /G10 L2 P\[#5220\] Z\[#<_cur_wcs_z_ofs> - #<_nc_last_tlo>\]/) >= 0);
});
t('M6 returns to the pre-change XY at safe Z', () => {
  const { lines } = run('rapidchangeatc', 'M6 T2', base, cfg);
  const back = at(lines, /^G53 G0 X250 Y300$/);
  assert(back > 0 && /G53 G0 Z/.test(lines[back - 1]));
});
t('the extra measure is wrapped in ZERO_KEEP markers for the UI banner', () => {
  const { lines } = run('rapidchangeatc', 'M6 T2', { ...base, zeroSetWithoutTlr: true, zeroTool: 1 }, cfg);
  const a = lines.indexOf('(MSG, ZERO_KEEP_START T1)'), b = lines.indexOf('(MSG, ZERO_KEEP_END)');
  assert(a >= 0 && b > a, 'markers present and ordered');
  assert(lines.slice(a, b).some(l => /G38\.2/.test(l)), 'the touch-off is inside the markers');
  assert.equal(run('rapidchangeatc', 'M6 T2', base, cfg).lines.indexOf('(MSG, ZERO_KEEP_START T1)'), -1, 'no markers without a pending Z0');
});
t('$TLS keeps a pending Z0', () => {
  const { lines } = run('rapidchangeatc', '$TLS', { ...base, zeroSetWithoutTlr: true, zeroTool: 1 }, cfg);
  assert(lines.findIndex(l => /G10 L2 P\[#5220\] Z\[#<_cur_wcs_z_ofs> - #<_nc_last_tlo>\]/.test(l)) > lines.indexOf('$#=_tool_offset'));
});
t('$H passes through untouched: no tool setter run after homing', () => {
  assert.deepEqual(run('rapidchangeatc', '$H', { ...base, zeroSetWithoutTlr: true, zeroTool: 1 }, { ...cfg, performTlsAfterHome: true }).lines, ['$H']);
});
const idx2 = (l, re) => l.findIndex(x => re.test(x));
t('Post Tool Change runs after the new tool is in, before the return to the pre-change XY', () => {
  const { lines } = run('rapidchangeatc', 'M6 T2', base, { ...cfg, postToolChangeGcode: '(POST TC)\nG53 G0 X500 Y500' });
  const post = lines.indexOf('(POST TC)');
  const back = idx2(lines, /^G53 G0 X250 Y300$/);
  const load = idx2(lines, /M61 Q2/);
  assert(load >= 0 && post > load, 'event after the new tool is loaded');
  assert(back > post, 'event before the return');
  const between = lines.slice(post, back);
  assert(between.includes('G21'), 'back to mm for the return');
  assert(between.some(l => /^G53 G0 Z/.test(l)), 'safe Z before the return');
  assert.equal(lines.filter(l => /^G53 G0 X250 Y300$/.test(l)).length, 1, 'one return');
});
t('without a Post Tool Change event the return is the last move', () => {
  const { lines } = run('rapidchangeatc', 'M6 T2', base, cfg);
  assert.equal(lines.indexOf('(POST TC)'), -1);
  assert.equal(lines.filter(l => /^G21$/.test(l)).length, 1, 'no extra units switch');
});
console.log(n, 'passed');
