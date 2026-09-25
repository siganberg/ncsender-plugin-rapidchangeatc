## What's Changed

### 🐛 Bug Fixes
- A G20, G21, G90, or G91 written in your Pre or Post Tool Change g-code no longer leaks into the rest of the job. Units and distance mode are now restored after each snippet runs, so a G21 added "to be safe" on an inch program can no longer silently switch the remaining program to millimetres, and a G91 can no longer send the rest of the run incremental.

### 🔧 Improvements
- The Pre and Post Tool Change help text now explains that these snippets run in the program's active units rather than always in millimetres, and recommends adding an explicit G20 or G21 when the snippet contains coordinates.
