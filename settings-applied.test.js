// The magazines' ATC Zones used to be published by the settings page when
// Save was pressed, so an update that changed them did nothing until the
// user saved again. ncSender now calls onSettingsApplied at startup, after an
// update, on Save and on connect. Run: node settings-applied.test.js
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const assert = require('assert');
const { test } = require('node:test');

const LIMITS = { minX: 0, maxX: 1200, minY: -800, maxY: 0 };
function load(pluginContext) {
  const code = fs.readFileSync(path.join(__dirname, 'commands.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
  const ctx = { console, pluginContext };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__api = { onSettingsApplied, keepoutZonesToPublish, buildInitialConfig };', ctx);
  return ctx.__api;
}
function host(overrides = {}) {
  const calls = [];
  return { calls, ctx: { getMachineLimits: () => LIMITS, setKeepoutZones: (z) => { calls.push(JSON.parse(JSON.stringify(z))); return true; }, ...overrides } };
}
const ONE = { pockets: 6, pocket1: { x: 100, y: -50 }, pocketDistance: 45, orientation: 'Y', direction: 'Negative', keepoutPadding: 60 };

test('one magazine is published as "ATC Zone", cut off at the travel', () => {
  const h = host(); const api = load(h.ctx);
  api.onSettingsApplied(api.buildInitialConfig(ONE));
  // slots at y -50 .. -275, padded 60: y -335 .. 10, cut at the bed's Y 0.
  assert.deepStrictEqual(h.calls, [[{ name: 'ATC Zone', minX: 40, minY: -335, maxX: 160, maxY: 0 }]]);
});

test('several magazines are numbered, in order', () => {
  const h = host(); const api = load(h.ctx);
  api.onSettingsApplied(api.buildInitialConfig({
    keepoutPadding: 50,
    magazines: [
      { slots: 4, slot1: { x: 200, y: -100 }, slotDistance: 40, orientation: 'X', direction: 'Positive' },
      { slots: 2, slot1: { x: 600, y: -300 }, slotDistance: 40, orientation: 'Y', direction: 'Negative' },
    ],
  }));
  assert.deepStrictEqual(h.calls[0], [
    { name: 'ATC Zone 1', minX: 150, minY: -150, maxX: 370, maxY: -50 },
    { name: 'ATC Zone 2', minX: 550, minY: -390, maxX: 650, maxY: -250 },
  ]);
});

test('nothing is published while the travel is unknown', () => {
  const h = host({ getMachineLimits: () => null }); const api = load(h.ctx);
  api.onSettingsApplied(api.buildInitialConfig(ONE));
  assert.deepStrictEqual(h.calls, []);
});

test('a magazine wholly off the bed is left out', () => {
  const api = load(host().ctx);
  const zones = api.keepoutZonesToPublish(api.buildInitialConfig({ ...ONE, pocket1: { x: -500, y: -50 } }), LIMITS);
  assert.strictEqual(zones.length, 0);
});

test('Community (no keepout) and an older app are left alone', () => {
  const h = host({ setKeepoutZones: undefined }); const api = load(h.ctx);
  assert.doesNotThrow(() => api.onSettingsApplied(api.buildInitialConfig(ONE)));
  assert.doesNotThrow(() => load({}).onSettingsApplied(api.buildInitialConfig(ONE)));
  assert.doesNotThrow(() => load(undefined).onSettingsApplied(api.buildInitialConfig(ONE)));
});
