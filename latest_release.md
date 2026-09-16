## What's Changed

### 🐛 Bug Fixes
- Tools kept outside the magazine now use their own tool length offsets. Before, a tool change to a tool that wasn't in a slot, like M6 T87, used no offsets unless you gave the tool a slot. The plugin now checks for a tool in that slot first, then for a tool with that Tool ID. This needs ncSender Pro 2.0.224 or Community 2.0.152 or later.
