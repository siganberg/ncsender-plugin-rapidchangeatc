# Rapid Change ATC

> **IMPORTANT DISCLAIMER:** This plugin is part of my personal ncSender project. If you choose to use it, you do so entirely at your own risk. I am not responsible for any damage, malfunction, or personal injury that may result from the use or misuse of this plugin. Use it with caution and at your own discretion.

Automatic tool changer support for RapidChange ATC systems.

## Installation

Install this plugin in ncSender through the Plugins interface.

## Features

### Automatic Tool Change
- Automated M6 tool change sequences for multi-pocket ATC systems
- Support for 1-8 tool pockets
- Configurable pocket orientation (X or Y axis) and direction
- Automatic pocket position calculation based on pocket distance
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
| `M6 Tx` | Perform automatic tool change to pocket x |
| `$TLS` | Run tool length setter routine |
| `$POCKET1` | Move to pocket 1 position |
| `$H` | Home machine (with optional automatic TLS if tool loaded) |

## Configuration Options

### ATC Settings
- **Collet Size** - ER11, ER16, ER20, ER25, ER32
- **Model** - Basic, Pro, Premium
- **Number of Pockets** - 1 to 8
- **Orientation** - X or Y axis
- **Direction** - Positive or Negative
- **Pocket Distance** - Distance between pockets (mm)

### Position Settings
- **Pocket 1** - X/Y location of first pocket
- **Tool Setter** - X/Y location of tool length setter
- **Manual Tool** - X/Y location for manual tool operations

### Tool Change Settings
- **Load RPM** - Spindle speed for loading tools
- **Unload RPM** - Spindle speed for unloading tools
- **Engage Feedrate** - Feed rate for pocket engagement
- **Spindle At Speed** - Wait for spindle to reach speed
- **ATC Start Delay** - Delay before starting ATC sequence (0-10 seconds)

### Tool Setter Settings
- **Seek Distance** - Probe travel distance (mm)
- **Seek Feedrate** - Probe feed rate (mm/min)
- **Tool Sensor** - Probe/TLS or Aux port selection

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
3. Configure the number of **Pockets**, **Orientation**, and **Direction**
4. Set **Pocket 1** location using the "Grab" button
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

; Move to pocket 1
$POCKET1

; Home with automatic TLS (if enabled)
$H
```

## Development

This plugin is part of the ncSender ecosystem: https://github.com/siganberg/ncSender

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

Copyright (C) 2024 Francis Marasigan
