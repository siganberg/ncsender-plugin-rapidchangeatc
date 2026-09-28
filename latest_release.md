## What's Changed

### ✨ New Features
- If you set Z0 before any tool length reference exists, that Z0 is now kept. Running $TLS or an M6 tool change adjusts the work offset for the measured tool length, so your cuts stay at the right depth.
- During a tool change where Z0 was set before any reference, the outgoing tool is measured first and the new tool is measured after the swap. This carries your Z0 over to the new tool.
- An M6 T0 unload now measures the outgoing tool to set the tool length reference before it is unloaded.

### 🔧 Improvements
- After a tool change, the spindle now goes back to where the change started before the job continues, so it no longer spins up above the tool setter.
- The "Perform TLS after first $H" option has been removed. Keeping Z0 automatically now covers what that setting was for.
