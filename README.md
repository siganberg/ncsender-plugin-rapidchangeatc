# Rapid Change ATC

> **IMPORTANT DISCLAIMER:** This plugin is part of my personal ncSender project. If you choose to use it, you do so entirely at your own risk. I am not responsible for any damage, malfunction, or personal injury that may result from the use or misuse of this plugin. Use it with caution and at your own discretion.

Automated tool changer workflow helper for multi-pocket RapidChange ATC systems.

## Installation

Install this plugin in ncSender through the Plugins interface.

## Features

### Multi-Pocket Tool Management
- Support for 1-8 tool pockets
- Automatic tool loading and unloading with spindle engagement
- Orientation-based pocket positioning (X or Y axis)
- Direction control (Positive or Negative)
- Configurable pocket spacing
- $POCKET1 macro command for manual pocket positioning

### Collet Size Support
- ER11, ER16, ER20, ER25, ER32 collet sizes
- Model variants: Basic, Pro, Premium

### Tool Change Automation
- Automated M6 tool change sequence with dual-zone verification
- Probe-based tool detection for load/unload confirmation
- Automatic fallback to manual mode on failed tool changes
- Same-tool change detection and skipping
- Manual tool pocket support for tools outside the ATC

### Tool Length Setter Integration
- Automated tool length probing with $TLS command
- Configurable probe parameters (seek distance, feedrate)
- Automatic tool offset management (G43.1)

### Safety Features
- Dual-zone probe verification during loading
- Modal dialogs for manual recovery on failed operations
- 1-second long-press requirement to prevent accidental triggers
- Visual progress indicators on buttons
- Non-closable safety dialogs during critical operations
- Clear instructions with emphasized safety warnings

### Configuration
- First pocket location (X/Y coordinates)
- Tool setter location (X/Y coordinates)
- Manual tool pocket location (X/Y coordinates)
- Number of pockets (1-8)
- Pocket spacing distance
- Orientation (X or Y axis)
- Direction (Positive or Negative)
- Advanced JSON-configurable parameters:
  - Z-axis positions (engagement, safe, zones, probe start)
  - RPM settings (load/unload)
  - Engagement feedrate
  - Tool length setter parameters
  - Spindle delay

### Automatic Settings Management
- Sets tool count based on configured pockets
- Enables manual tool change mode when configured
- Enables TLS integration when configured
- Resets settings on plugin disable

### Auto-Calibrate Feature
- Automatic Z-axis calibration for tool engagement height
- Uses G38.5 probe cycle to detect collet height
- Updates Z engagement position automatically

## Usage

1. Configure the first pocket location using the "Grab" button while positioned at pocket 1
2. Configure the tool setter location using the "Grab" button while positioned at the tool setter
3. Configure the manual tool pocket location (optional)
4. Set the number of pockets, orientation, and direction
5. Set pocket spacing distance
6. Save configuration
7. Use M6 Tn commands in your G-code for automated tool changes
8. Use $TLS command for tool length measurement
9. Use $POCKET1 command for manual pocket positioning

## Manual Recovery

If automatic tool loading or unloading fails, the plugin will display a recovery dialog:
- **Load Failed**: Manually install the bit, then press and hold "Continue"
- **Unload Failed**: Manually remove the bit, then press and hold "Continue"
- **Abort**: Press and hold to cancel the operation (sends soft reset)

## Development

This plugin is part of the ncSender ecosystem: https://github.com/siganberg/ncSender

## License

See main ncSender repository for license information.
