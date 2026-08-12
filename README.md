# Rapid Change ATC

> **IMPORTANT DISCLAIMER:** This plugin is part of my personal ncSender project. If you choose to use it, you do so entirely at your own risk. I am not responsible for any damage, malfunction, or personal injury that may result from the use or misuse of this plugin. Use it with caution and at your own discretion.

Automatic tool changer support for RapidChange ATC systems.

## Installation

Install this plugin in ncSender through the Plugins interface.

## Features

### Automatic Tool Change
- Automated M6 tool change sequences for multi-slot ATC systems
- Support for 1-8 tool slots
- Configurable slot orientation (X or Y axis) and direction
- Automatic slot position calculation based on slot distance
- Smart tool change optimization (skip if same tool)

### Tool Length Setter Integration
- Automated tool length probing with `$TLS` command
- Configurable tool setter location (X/Y coordinates)
- Configurable probe parameters (seek distance, feedrate)
- Automatic tool offset management via G43.1
- Per-tool TLS offsets from Tool Library
- Optional automatic TLS after first `$H` (home) command
- Multiple sensor options (Probe/TLS or Aux ports)

### RapidChange ATC Models
- **Basic** - Standard ATC functionality
- **Pro** - Enhanced features with spindle-at-speed support
- **Premium** - Full features including dust cover commands

### Collet Size Support
- ER11, ER16, ER20, ER25, ER32
- Automatic RPM and Z retreat defaults based on collet size

### Probe Tool Support (Tool 99)
- Optional probe tool with custom load/unload G-code
- Dedicated probe tool handling separate from regular tools

### Safety Features
- Modal dialogs for tool change confirmation
- Non-closable safety dialogs during critical operations
- Clear instructions with Abort/Continue options
- Spindle-at-speed verification option
- Configurable ATC start delay

### Supported Commands

| Command | Description |
|---------|-------------|
| `M6 Tx` | Perform automatic tool change to slot x |
| `$TLS` | Run tool length setter routine |
| `$SLOT1` … `$SLOT8` | Move to the given slot position (up to the configured slot count) |
| `$H` | Home machine (with optional automatic TLS if tool loaded) |

## Configuration Options

### ATC Settings
- **Collet Size** - ER11, ER16, ER20, ER25, ER32
- **Model** - Basic, Pro, Premium
- **Number of Slots** - 1 to 8
- **Orientation** - X or Y axis
- **Direction** - Positive or Negative
- **Slot Distance** - Distance between slots (mm)

### Position Settings
- **Slot 1** - X/Y location of first slot
- **Tool Setter** - X/Y location of tool length setter
- **Manual Tool** - X/Y location for manual tool operations

### Tool Change Settings
- **Load RPM** - Spindle speed for loading tools
- **Unload RPM** - Spindle speed for unloading tools
- **Engage Feedrate** - Feed rate for slot engagement
- **Spindle At Speed** - Wait for spindle to reach speed
- **ATC Start Delay** - Delay before starting ATC sequence (0-10 seconds)

### Tool Setter Settings
- **Starting Z-Probe** - Absolute machine Z where the seek begins
- **Seek Distance** - Probe travel distance (mm)
- **Seek Feedrate** - Probe feed rate (mm/min)
- **Tool Sensor** - Probe/TLS or Aux port selection

### Auto Detect
Finds the IR release point and fills in Z, Zone 1 and Zone 2. The search depends
on the selected Tool Sensor:
- **Probe/TLS** - uses `G38.2` / `G38.4`, since the controller's probe cycle
  reacts to those inputs
- **Aux Pn** - `G38` cannot see an aux input, so the plugin steps the Z axis and
  reads the pin with `M66 P<n> L0` after each step

The IR lamp in the dialog follows the same source: the status report for
Probe/TLS, and a throttled `M66` read (idle-only, silent) for an Aux port. If
the controller never answers the read, the lamp greys out instead of showing a
misleading state.

### Events
G-code blocks injected into the generated macros:
- **Pre Tool Change** - Before each tool change (M6)
- **Post Tool Change** - After each tool change completes
- **Pre TLS** - Right before the probe cycle, with the spindle parked over the
  tool setter (e.g. `M64 P1` to power a wired tool setter)
- **Post TLS** - Right after the probe retracts, before the offset is applied
  (e.g. `M65 P1`)
- **Abort** - When a tool change is aborted

> Pre/Post TLS replace the old **Switch Aux during TLS** dropdown. Existing
> configs are migrated automatically to the equivalent `M64`/`M65` (or
> `M7`/`M8`/`M9`) g-code the first time they load.

### Premium Features
- **Cover Open Command** - G-code to open dust cover
- **Cover Close Command** - G-code to close dust cover

### Probe Tool (Tool 99)
- **Add Probe** - Enable probe tool support
- **Probe Load G-code** - Custom G-code for loading probe
- **Probe Unload G-code** - Custom G-code for unloading probe

### Advanced Settings
- **Show Macro Commands** - Display expanded G-code in terminal
- **Perform TLS after HOME** - Automatic TLS after first homing

### Advanced Settings (JSON only)

These settings can be modified directly in the plugin settings JSON:

```json
{
  "zEngagement": -50,
  "zSafe": 0,
  "zSpinOff": 23,
  "zRetreat": 7,
  "zProbeStart": -20,
  "zone1": -27.0,
  "zone2": -22.0
}
```

## Usage

1. Open the RapidChangeATC dialog from the Tools menu
2. Select your **Collet Size** and **Model**
3. Configure the number of **Slots**, **Orientation**, and **Direction**
4. Set **Slot 1** location using the "Grab" button
5. Set **Tool Setter** location using the "Grab" button
6. Optionally configure **Manual Tool** location
7. Adjust RPM and other settings as needed
8. Save configuration

### G-code Commands

```gcode
; Automatic tool change to tool 3
M6 T3

; Manual tool length measurement
$TLS

; Move to slot 1
$SLOT1

; Move to slot 3
$SLOT3

; Home with automatic TLS (if enabled)
$H
```

## Development

This plugin is part of the ncSender ecosystem: https://github.com/siganberg/ncSender

## License

This plugin is available under a **dual license** (GPL-3.0 + Commercial).

See the [LICENSE](LICENSE) file for details, or contact support@franciscreation.com for commercial licensing.

Copyright (C) 2024 Francis Marasigan
