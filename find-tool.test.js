// A T number finds its tool by Tool ID only. With Tool ID numbering a slot is
// another tool: T3 with no Tool ID 3 must not take the slot-3 tool's offsets.
// Run: node find-tool.test.js
const fs = require('fs'); const vm = require('vm'); const path = require('path');
const assert = require('assert');
const code = fs.readFileSync(path.join(__dirname, 'commands.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
const ctx = { console, pluginContext: { armTlsWriteback() {}, getFirmwareSetting() { return null; } } };
vm.createContext(ctx);
vm.runInContext(code + '\n;this.__findTool = findTool;', ctx);
const tools = [{ toolId: 68, toolNumber: 3, offsets: { x: 1, y: 2, z: -40, tlsZ: 5 } }, { toolId: 3, toolNumber: null, offsets: { x: 0, y: 0, z: -12, tlsZ: 0 } }];
assert.equal(ctx.__findTool(3, tools), tools[1], 'T3 is Tool ID 3');
assert.equal(ctx.__findTool(68, tools), tools[0], 'T68 is the tool in slot 3');
assert.equal(ctx.__findTool(3, [tools[0]]), undefined, 'no Tool ID 3: not the slot-3 tool');
console.log('3 passed');
