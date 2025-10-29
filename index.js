/**
 * Rapid Change ATC plugin
 * Provides quick access tooling workflow controls.
 */

const ALLOWED_COLLET_SIZES = ['ER11', 'ER16', 'ER20', 'ER25', 'ER32'];
const ALLOWED_MODELS = ['Basic', 'Pro', 'Premium'];
const ORIENTATIONS = ['X', 'Y'];
const DIRECTIONS = ['Positive', 'Negative'];

const clampPockets = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(Math.max(parsed, 1), 8);
};

const clampSpindleDelay = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 10);
};

const toFiniteNumber = (value, fallback = 0) => {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
};

const sanitizeColletSize = (value) => (ALLOWED_COLLET_SIZES.includes(value) ? value : 'ER20');
const sanitizeModel = (value) => (ALLOWED_MODELS.includes(value) ? value : 'Pro');
const sanitizeOrientation = (value) => (ORIENTATIONS.includes(value) ? value : 'Y');
const sanitizeDirection = (value) => (DIRECTIONS.includes(value) ? value : 'Negative');
const sanitizeCoords = (coords = {}) => ({
  x: toFiniteNumber(coords.x),
  y: toFiniteNumber(coords.y)
});

const buildInitialConfig = (raw = {}) => ({
  // UI Settings
  colletSize: sanitizeColletSize(raw.colletSize ?? raw.model),
  pockets: clampPockets(raw.pockets),
  model: sanitizeModel(raw.model ?? raw.trip ?? raw.modelName ?? raw.machineModel),
  orientation: sanitizeOrientation(raw.orientation),
  direction: sanitizeDirection(raw.direction),
  showMacroCommand: raw.showMacroCommand ?? false,
  spindleDelay: clampSpindleDelay(raw.spindleDelay),

  // Position Settings
  pocket1: sanitizeCoords(raw.pocket1),
  toolSetter: sanitizeCoords(raw.toolSetter),
  manualTool: sanitizeCoords(raw.manualTool),
  pocketDistance: toFiniteNumber(raw.pocketDistance, 45),

  // Z-axis Settings
  zEngagement: toFiniteNumber(raw.zEngagement, -50),
  zSafe: toFiniteNumber(raw.zSafe, 0),
  zSpinOff: toFiniteNumber(raw.zSpinOff, 23),
  zRetreat: toFiniteNumber(raw.zRetreat, 7),
  zProbeStart: toFiniteNumber(raw.zProbeStart, -20),
  zone1: toFiniteNumber(raw.zone1, -27.0),
  zone2: toFiniteNumber(raw.zone2, -22.0),

  // Tool Change Settings
  unloadRpm: toFiniteNumber(raw.unloadRpm, 1500),
  loadRpm: toFiniteNumber(raw.loadRpm, 1200),
  engageFeedrate: toFiniteNumber(raw.engageFeedrate, 3500),

  // Tool Setter Settings
  seekDistance: toFiniteNumber(raw.seekDistance, 50),
  seekFeedrate: toFiniteNumber(raw.seekFeedrate, 800)
});

const resolveServerPort = (pluginSettings = {}, appSettings = {}) => {
  const appPort = Number.parseInt(appSettings?.senderPort, 10);
  if (Number.isFinite(appPort)) {
    return appPort;
  }

  const pluginPort = Number.parseInt(pluginSettings?.port, 10);
  if (Number.isFinite(pluginPort)) {
    return pluginPort;
  }

  return 8090;
};

// === Helper Functions ===

// Helper: Format G-code with proper indentation based on O-code control structures
function formatGCode(gcode) {
  const lines = gcode.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');

  const formatted = [];
  let indentLevel = 0;

  for (const line of lines) {
    const upperLine = line.toUpperCase();
    const isOCode = upperLine.startsWith('O');

    // Decrease indent for closing/else keywords
    if (isOCode && (
      upperLine.includes('ENDIF') ||
      upperLine.includes('ENDWHILE') ||
      upperLine.includes('ENDREPEAT') ||
      upperLine.includes('ENDSUB') ||
      upperLine.includes('ELSE')
    )) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    // Add line with current indentation
    const indent = '  '.repeat(indentLevel);
    formatted.push(indent + line);

    // Increase indent for opening keywords
    if (isOCode && (
      upperLine.includes(' IF ') ||
      upperLine.includes(' WHILE ') ||
      upperLine.includes(' DO ') ||
      upperLine.includes('REPEAT') ||
      upperLine.includes(' SUB')
    )) {
      indentLevel++;
    }

    // Special case: ELSE also increases indent after being printed
    if (isOCode && upperLine.includes('ELSE') && !upperLine.includes('ELSEIF')) {
      indentLevel++;
    }
  }

  return formatted;
}

// Shared TLS routine generator
function createToolLengthSetRoutine(settings) {
  const gcode = `
    G53 G0 Z${settings.zSafe}
    G53 G0 X${settings.toolSetter.x} Y${settings.toolSetter.y}
    G53 G0 Z${settings.zProbeStart}
    G43.1 Z0
    G38.2 G91 Z-${settings.seekDistance} F${settings.seekFeedrate}
    G0 G91 Z5
    G38.2 G91 Z-5 F250
    G91 G0 Z5
    G90
    #<_ofs_idx> = [#5220 * 20 + 5203]
    #<_cur_wcs_z_ofs> = #[#<_ofs_idx>]
    #<_rc_trigger_mach_z> = [#5063 + #<_cur_wcs_z_ofs>]
    G43.1 Z[#<_rc_trigger_mach_z>]
    (Notify ncSender that toolLengthSet is now set)
    $#=_tool_offset
  `.trim();
  return gcode.split('\n');
}

function createToolLengthSetProgram(settings) {
  const tlsRoutine = createToolLengthSetRoutine(settings).join('\n');
  const gcode = `
    (Start of Tool Length Setter)
    #<return_units> = [20 + #<_metric>]
    G21
    ${tlsRoutine}
    G53 G0 Z${settings.zSafe}
    G[#<return_units>]
    (End of Tool Length Setter)
    (MSG, TOOL CHANGE COMPLETE)
  `.trim();
  return gcode.split('\n');
}

function handleTLSCommand(commands, settings, ctx) {
  const tlsIndex = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$TLS'
  );

  if (tlsIndex === -1) {
    return; // No $TLS command found
  }

  ctx.log('$TLS command detected, replacing with tool length setter routine');

  const tlsCommand = commands[tlsIndex];
  const toolLengthSetProgram = createToolLengthSetProgram(settings);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = toolLengthSetProgram.map((line, index) => {
    if (index === 0) {
      // First command - show $TLS if hiding macro, otherwise show actual command
      return {
        command: line,
        displayCommand: showMacroCommand ? null : tlsCommand.command.trim(),
        isOriginal: false
      };
    } else {
      // Rest of commands - hide if not showing macro
      return {
        command: line,
        displayCommand: null,
        isOriginal: false,
        meta: showMacroCommand ? {} : { silent: true }
      };
    }
  });

  commands.splice(tlsIndex, 1, ...expandedCommands);
}

function handlePocket1Command(commands, settings, ctx) {
  const pocket1Index = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$POCKET1'
  );

  if (pocket1Index === -1) {
    return; // No $POCKET1 command found
  }

  ctx.log('$POCKET1 command detected, moving to pocket 1 position');

  const pocket1Command = commands[pocket1Index];
  const gcode = `
    G53 G21 G90 G0 Z${settings.zSafe}
    G53 G21 G90 G0 X${settings.pocket1.x} Y${settings.pocket1.y}
  `.trim();

  const pocket1Program = formatGCode(gcode);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = pocket1Program.map((line, index) => {
    if (index === 0) {
      return {
        command: line,
        displayCommand: showMacroCommand ? null : pocket1Command.command.trim(),
        isOriginal: false
      };
    } else {
      return {
        command: line,
        displayCommand: null,
        isOriginal: false,
        meta: showMacroCommand ? {} : { silent: true }
      };
    }
  });

  commands.splice(pocket1Index, 1, ...expandedCommands);
}

function handleM6Command(commands, context, settings, ctx) {
  // Find original M6 command
  const m6Index = commands.findIndex(cmd => {
    if (!cmd.isOriginal) return false;
    const parsed = ctx.utils.parseM6Command(cmd.command);
    return parsed?.matched && parsed.toolNumber !== null;
  });

  if (m6Index === -1) {
    return; // No M6 found
  }

  const m6Command = commands[m6Index];
  const parsed = ctx.utils.parseM6Command(m6Command.command);

  if (!parsed?.matched || parsed.toolNumber === null) {
    return;
  }

  const toolNumber = parsed.toolNumber;
  const location = context.lineNumber !== undefined ? `at line ${context.lineNumber}` : `from ${context.sourceId}`;
  const currentTool = context.machineState?.tool ?? 0;

  ctx.log(`M6 detected with tool T${toolNumber} ${location}, current tool: T${currentTool}, executing tool change program`);

  const toolChangeProgram = buildToolChangeProgram(settings, currentTool, toolNumber);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = toolChangeProgram.map((line, index) => {
    if (index === 0) {
      // First command - show M6 if hiding macro, otherwise show actual command
      return {
        command: line,
        displayCommand: showMacroCommand ? null : m6Command.command.trim(),
        isOriginal: false
      };
    } else {
      // Rest of commands - hide if not showing macro
      return {
        command: line,
        displayCommand: null,
        isOriginal: false,
        meta: showMacroCommand ? {} : { silent: true }
      };
    }
  });

  commands.splice(m6Index, 1, ...expandedCommands);
}

// Helper: Calculate pocket position based on tool number
function calculatePocketPosition(settings, toolNum) {
  if (toolNum <= 0) {
    return { x: settings.pocket1.x, y: settings.pocket1.y };
  }
  const direction = settings.direction === 'Negative' ? -1 : 1;
  const offset = (toolNum - 1) * settings.pocketDistance * direction;
  if (settings.orientation === 'Y') {
    return { x: settings.pocket1.x, y: settings.pocket1.y + offset };
  } else {
    return { x: settings.pocket1.x + offset, y: settings.pocket1.y };
  }
}

// Helper: Manual tool change fallback routine
function createManualToolFallback(settings) {
  return `
    G53 G0 Z${settings.zSafe}
    G53 G0 X${settings.manualTool.x} Y${settings.manualTool.y}
    M0
  `.trim();
}

// Helper: Tool unload routine
function createToolUnload(settings) {
  const zone1 = settings.zone1;
  return `
    G53 G0 Z${settings.zEngagement + settings.zSpinOff}
    G65P6
    M4 S${settings.unloadRpm}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G65P6
    M5
    G53 G0 Z${zone1}
    G4 P0.2
  `.trim();
}

// Helper: Tool load routine
function createToolLoad(settings, tool) {
  const zone1 = settings.zone1;
  const zone2 = settings.zone2;
  const manualFallback1 = createManualToolFallback(settings);
  const manualFallback2 = createManualToolFallback(settings);

  return `
    G53 G0 Z${settings.zEngagement + settings.zSpinOff}
    G65P6
    M3 S${settings.loadRpm}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G65P6
    M5
    G53 G0 Z${zone1}
    G4 P0.2
    o300 IF [#<_probe_state> EQ 0 AND #<_toolsetter_state> EQ 0]
    ${manualFallback1}
    o300 ELSE
       G53 G0 Z${zone2}
       G4 P0.2
       o301 IF [#<_probe_state> EQ 1 OR #<_toolsetter_state> EQ 1]
    ${manualFallback2}
       o301 ENDIF
    o300 ENDIF
    M61 Q${tool}
  `.trim();
}

// Build unload tool section
function buildUnloadTool(settings, currentTool, sourcePos) {
  if (currentTool === 0) {
    return '';
  }
  if (currentTool > settings.pockets) {
    return `
      G53 G0 Z${settings.zSafe}
      ${createManualToolFallback(settings)}
      M61 Q0
    `.trim();
  } else {
    return `
      G53 G0 Z${settings.zSafe}
      G53 G0 X${sourcePos.x} Y${sourcePos.y}
      ${createToolUnload(settings)}
      o100 IF [#<_probe_state> EQ 1 OR #<_toolsetter_state> EQ 1]
        ${createToolUnload(settings)}
        o101 IF [#<_probe_state> EQ 1 OR #<_toolsetter_state> EQ 1]
          ${createManualToolFallback(settings)}
        o101 ENDIF
      o100 ENDIF
      M61 Q0
    `.trim();
  }
}

// Build load tool section
function buildLoadTool(settings, toolNumber, targetPos, tlsRoutine) {
  if (toolNumber === 0) {
    return '';
  }

  if (toolNumber <= settings.pockets) {
    return `
      G53 G0 Z${settings.zSafe}
      G53 G0 X${targetPos.x} Y${targetPos.y}
      ${createToolLoad(settings, toolNumber)}
      ${tlsRoutine}
    `.trim();
  } else {
    return `
      G53 G0 Z${settings.zSafe}
      ${createManualToolFallback(settings)}
      M61 Q${toolNumber}
      ${tlsRoutine}
    `.trim();
  }
}

function buildToolChangeProgram(settings, currentTool, toolNumber) {
  // Calculate positions and prepare components
  const sourcePos = calculatePocketPosition(settings, currentTool);
  const targetPos = calculatePocketPosition(settings, toolNumber);
  const tlsRoutine = createToolLengthSetRoutine(settings).join('\n');

  // Build sections
  const spindleDelaySection = settings.spindleDelay > 0 ? `G4 P${settings.spindleDelay}` : '';
  const unloadSection = buildUnloadTool(settings, currentTool, sourcePos);
  const loadSection = buildLoadTool(settings, toolNumber, targetPos, tlsRoutine);

  // Assemble complete program
  const gcode = `
    (Start of RapidChangeATC Plugin Sequence)
    #<return_units> = [20 + #<_metric>]
    G21
    M5
    ${spindleDelaySection}
    ${unloadSection}
    ${loadSection}
    G53 G0 Z${settings.zSafe}
    G[#<return_units>]
    (End of RapidChangeATC Plugin Sequence)
    (MSG, TOOL CHANGE COMPLETE: T${toolNumber})
  `.trim();

  // Format G-code with proper indentation
  return formatGCode(gcode);
}

// === Plugin Lifecycle ===

export async function onLoad(ctx) {
  ctx.log('Rapid Change ATC plugin loaded');

  // Get current plugin settings and app settings
  const pluginSettings = ctx.getSettings() || {};
  const appSettings = ctx.getAppSettings() || {};

  // Check if plugin has been configured (has required settings)
  const isConfigured = !!(pluginSettings.pocket1 && pluginSettings.pockets);

  // Sync tool count from plugin config to app settings
  const pocketCount = pluginSettings.pockets || 0;
  const currentToolSettings = appSettings.tool || {};

  // Set tool.source to indicate this plugin controls the tool count
  // and sync the count from the plugin's pocket configuration
  // Only enable manual and TLS tools if plugin is configured
  // Add small delay to avoid race condition with onUnload during hot reload
  await new Promise(resolve => setTimeout(resolve, 100));

  try {
    const response = await fetch(`http://localhost:${resolveServerPort(pluginSettings, appSettings)}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: {
          count: pocketCount,
          source: 'com.ncsender.rapidchangeatc',
          manual: isConfigured,
          tls: isConfigured
        }
      })
    });

    if (response.ok) {
      ctx.log(`Tool settings synchronized: count=${pocketCount}, manual=${isConfigured}, tls=${isConfigured} (source: com.ncsender.rapidchangeatc)`);
    } else {
      ctx.log(`Failed to sync tool settings: ${response.status}`);
    }
  } catch (error) {
    ctx.log('Failed to sync tool settings on plugin load:', error);
  }

  // NEW API: onBeforeCommand receives command array
  ctx.registerEventHandler('onBeforeCommand', async (commands, context) => {
    const rawSettings = ctx.getSettings() || {};

    // Skip command handling if plugin is not configured
    if (!rawSettings.pocket1 || !rawSettings.pockets) {
      ctx.log('Plugin not configured, skipping command handling');
      return commands;
    }

    const settings = buildInitialConfig(rawSettings);

    // Handle $TLS command
    handleTLSCommand(commands, settings, ctx);

    // Handle $POCKET1 command
    handlePocket1Command(commands, settings, ctx);

    // Handle M6 tool change command
    handleM6Command(commands, context, settings, ctx);

    return commands;
  });

  ctx.registerEventHandler('message', async (data) => {
    if (!data) {
      return;
    }

    if (data.event === 'auto-calibrate') {
      ctx.log('Auto-calibrate triggered');

      const rawSettings = ctx.getSettings() || {};
      const appSettings = ctx.getAppSettings() || {};

      if (!rawSettings.pocket1 || !rawSettings.pockets) {
        ctx.log('Plugin not configured, cannot run auto-calibrate');
        return { success: false, error: 'Plugin not configured' };
      }

      const settings = buildInitialConfig(rawSettings);
      const resolvedPort = resolveServerPort(rawSettings, appSettings);

      const AUTO_CALIBRATE_GCODE = `
          G38.5 G91 Z50 F200
          $#=5063
      `.trim();

      try {
        const response = await fetch(`http://localhost:${resolvedPort}/api/send-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: AUTO_CALIBRATE_GCODE,
            meta: {
              source: 'rapidchangeatc-autocalibrate'
            }
          })
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Failed to send auto calibrate command: ${response.status} - ${errorBody}`);
        }

        ctx.log('Auto-calibrate command sent successfully');
        return { success: true };
      } catch (error) {
        ctx.log('Auto-calibrate failed:', error);
        return { success: false, error: error.message };
      }
    }


    if (data.action === 'save') {
      const payload = data.payload || {};
      const sanitized = buildInitialConfig(payload);
      const existing = ctx.getSettings() || {};
      const appSettings = ctx.getAppSettings() || {};
      const resolvedPort = resolveServerPort(existing, appSettings);

      ctx.setSettings({
        ...existing,
        ...sanitized,
        port: resolvedPort
      });

      ctx.log('Rapid Change ATC settings saved');
    }
  });

  ctx.registerToolMenu('RapidChangeATC', async () => {
    ctx.log('RapidChangeATC tool opened');

    const storedSettings = ctx.getSettings() || {};
    const appSettings = ctx.getAppSettings() || {};
    const serverPort = resolveServerPort(storedSettings, appSettings);
    const initialConfig = buildInitialConfig(storedSettings);
    const initialConfigJson = JSON.stringify(initialConfig)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');

    ctx.showDialog(
      'Rapid Change ATC',
      /* html */ `
      <style>
        .rc-dialog-wrapper {
          display: grid;
          grid-template-rows: auto 1fr auto;
          overflow: hidden;
          width: 850px;
        }

        .rc-header {
          padding: 10px 30px;
        }

        .rc-content {
          overflow-y: auto;
          padding: 30px;
          padding-top: 0;
        }

        .rc-container {
          display: grid;
          grid-template-columns: 400px 1fr;
          gap: 12px;
        }

        .rc-left-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .rc-right-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .rc-axis-card,
        .rc-calibration-group {
          background: var(--color-surface-muted);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-small);
          padding: 12px 16px;
        }

        .rc-calibration-group {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .rc-axis-title {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--color-text-secondary);
          margin-bottom: 8px;
          text-align: center;
        }

        .rc-axis-values {
          display: flex;
          justify-content: space-around;
          gap: 16px;
        }

        .rc-axis-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .rc-axis-label {
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--color-text-secondary);
          text-transform: uppercase;
        }

        .rc-axis-value {
          font-family: 'JetBrains Mono', monospace;
          font-size: 1rem;
          font-weight: 600;
          color: var(--color-accent);
        }

        .rc-form-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
        }

        .rc-form-row-wide {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }

        .rc-form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .rc-form-group-horizontal {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .rc-form-group-horizontal .rc-form-label {
          white-space: nowrap;
          min-width: fit-content;
        }

        .rc-form-group-horizontal .rc-input {
          width: 100px;
        }

        .rc-form-label {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .rc-select,
        .rc-input {
          padding: 8px 12px;
          border: 1px solid var(--color-border);
          border-radius: var(--radius-small);
          background: var(--color-surface);
          color: var(--color-text-primary);
          font-size: 0.9rem;
          text-align: right;
        }

        .rc-select:focus,
        .rc-input:focus {
          outline: none;
          border-color: var(--color-accent);
        }

        .rc-select {
          text-align-last: right;
        }

        .rc-radio-group {
          display: flex;
          gap: 16px;
        }

        .rc-right-panel > nc-step-control {
          align-self: center;
        }

        .rc-radio-label {
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-size: 0.9rem;
          color: var(--color-text-primary);
        }

        .rc-toggle-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 16px;
        }

        .rc-toggle-label {
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        .toggle-switch {
          position: relative;
          width: 50px;
          height: 28px;
        }

        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }

        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #ccc;
          transition: .4s;
          border-radius: 28px;
        }

        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 4px;
          bottom: 4px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }

        input:checked + .toggle-slider {
          background-color: var(--color-accent, #4a90e2);
        }

        input:checked + .toggle-slider:before {
          transform: translateX(22px);
        }

        .help-text {
          font-size: 0.85rem;
          color: var(--color-text-secondary);
          margin-top: 6px;
          line-height: 1.4;
        }

        .rc-slider-toggle {
          position: relative;
          display: inline-flex;
          align-items: center;
          background: var(--color-surface-muted);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          padding: 4px;
          cursor: pointer;
          user-select: none;
        }

        .rc-slider-option {
          position: relative;
          padding: 6px 16px;
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--color-text-secondary);
          transition: color 0.2s ease;
          z-index: 1;
        }

        .rc-slider-option.active {
          color: var(--color-text-primary);
        }

        .rc-slider-indicator {
          position: absolute;
          top: 4px;
          bottom: 4px;
          background: var(--color-accent);
          border-radius: 16px;
          transition: all 0.3s ease;
          z-index: 0;
        }

        .rc-coordinate-group {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
          gap: 8px;
          align-items: center;
        }

        .rc-coordinate-group .rc-input {
          min-width: 0;
          width: 100%;
        }

        .rc-coord-input-wrapper {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .rc-coord-input-wrapper .rc-coord-label-inline {
          flex-shrink: 0;
        }

        .rc-coord-input-wrapper .rc-input {
          flex: 1;
          min-width: 0;
        }

        .rc-coord-label-inline {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--color-text-secondary);
        }

        .rc-button {
          border-radius: var(--radius-small);
          border: 1px solid var(--color-accent);
          background: var(--color-accent);
          color: var(--color-surface);
          font-size: 0.9rem;
          font-weight: 600;
          cursor: pointer;
          transition: filter 0.15s ease;
        }

        .rc-button-grab {
          padding: 6px 16px !important;
        }

        .rc-button-auto-calibrate {
          width: 200px;
          padding: 10px 16px;
          margin: 0 auto;
        }

        .rc-button:hover {
          filter: brightness(0.95);
        }

        .rc-button:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }

        .rc-button.rc-button-busy,
        .rc-button:disabled {
          filter: none;
          opacity: 0.7;
          cursor: progress;
        }

        .rc-instructions {
          margin: 0;
          color: var(--color-text-secondary);
          font-size: 0.9rem;
          line-height: 1.4;
          margin-bottom: 5px !important;
          margin-top: 5px !important;
        }

        .rc-footer {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          padding: 16px 30px;
          border-top: 1px solid var(--color-border);
          background: var(--color-surface);
          position: relative;
        }

        .rc-save-indicator {
          position: absolute;
          right: 30px;
          background: linear-gradient(135deg, #1abc9c, rgba(26, 188, 156, 0.8));
          color: white;
          padding: 8px 16px;
          border-radius: var(--radius-small);
          font-size: 0.9rem;
          font-weight: 500;
          box-shadow: 0 2px 8px rgba(26, 188, 156, 0.3);
          animation: rc-fade-in 0.3s ease;
        }

        @keyframes rc-fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .rc-button-secondary {
          background: var(--color-surface-muted);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }

        .rc-button-secondary:hover {
          background: var(--color-surface);
          filter: none;
        }
      </style>

      <div class="rc-dialog-wrapper">
        <div class="rc-header">
          <p class="rc-instructions">
            With the collet, nut, and bit installed on the spindle, position the spindle over Pocket 1 of the magazine. Use the Jog controls to lower and fine-tune the position until the nut is just inside Pocket 1. Manually rotate the spindle to ensure nothing is rubbing. Once everything is centered, continue lowering until the nut begins to touch the pocket’s ball bearing, then click Auto Calibrate (Coming soon).
          </p>
        </div>

        <div class="rc-content">
          <div class="rc-container">
            <!-- Left Panel: Form Controls -->
        <div class="rc-left-panel">
          <div class="rc-calibration-group">
            <div class="rc-form-row">
              <div class="rc-form-group">
                <label class="rc-form-label">Collet Size</label>
                <select class="rc-select" id="rc-collet-size">
                  <option value="ER11" disabled>ER11</option>
                  <option value="ER16" disabled>ER16</option>
                  <option value="ER20" selected>ER20</option>
                  <option value="ER25" disabled>ER25</option>
                  <option value="ER32" disabled>ER32</option>
                </select>
              </div>

              <div class="rc-form-group">
                <label class="rc-form-label">Pocket Size</label>
                <select class="rc-select" id="rc-pockets">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5</option>
                  <option value="6" selected>6</option>
                  <option value="7">7</option>
                  <option value="8">8</option>
                </select>
              </div>

              <div class="rc-form-group">
                <label class="rc-form-label">Model</label>
                <select class="rc-select" id="rc-model-select">
                  <option value="Basic" disabled>Basic</option>
                  <option value="Pro" selected>Pro</option>
                  <option value="Premium" disabled>Premium</option>
                </select>
              </div>
            </div>

            <div class="rc-form-row-wide">
              <div class="rc-form-group-horizontal">
                <label class="rc-form-label">Orientation</label>
                <div class="rc-slider-toggle" id="rc-orientation-toggle">
                  <span class="rc-slider-option active" data-value="Y">Y</span>
                  <span class="rc-slider-option" data-value="X">X</span>
                  <div class="rc-slider-indicator"></div>
                </div>
              </div>

              <div class="rc-form-group-horizontal">
                <label class="rc-form-label" title="Pocket 1 → 2">Direction</label>
                <div class="rc-slider-toggle" id="rc-direction-toggle">
                  <span class="rc-slider-option active" data-value="Negative">-</span>
                  <span class="rc-slider-option" data-value="Positive">+</span>
                  <div class="rc-slider-indicator"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="rc-calibration-group">
            <div class="rc-form-group">
              <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
                <label class="rc-form-label" style="margin: 0;">Pocket 1 Coordinates</label>
                <button type="button" class="rc-button rc-button-grab" id="rc-pocket1-grab">Grab</button>
              </div>
              <div class="rc-coordinate-group">
                <div class="rc-coord-input-wrapper">
                  <label class="rc-coord-label-inline" for="rc-pocket1-x">X</label>
                  <input type="number" class="rc-input" id="rc-pocket1-x" value="0" step="0.001">
                </div>
                <div class="rc-coord-input-wrapper">
                  <label class="rc-coord-label-inline" for="rc-pocket1-y">Y</label>
                  <input type="number" class="rc-input" id="rc-pocket1-y" value="0" step="0.001">
                </div>
                <div class="rc-coord-input-wrapper">
                  <label class="rc-coord-label-inline" for="rc-zengagement">Z</label>
                  <input type="number" class="rc-input" id="rc-zengagement" value="-100" step="0.001">
                </div>
              </div>
            </div>

            <div class="rc-form-row-wide">
              <div class="rc-form-group-horizontal">
                <label class="rc-form-label">Zone 1</label>
                <input type="number" class="rc-input" id="rc-zone1" value="-27" step="0.001">
              </div>

              <div class="rc-form-group-horizontal">
                <label class="rc-form-label">Zone 2</label>
                <input type="number" class="rc-input" id="rc-zone2" value="-22" step="0.001">
              </div>
            </div>
          </div>

          <div class="rc-calibration-group">
            <div class="rc-form-group">
              <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
                <label class="rc-form-label" style="margin: 0;">Tool Setter Coordinates</label>
                <button type="button" class="rc-button rc-button-grab" id="rc-toolsetter-grab">Grab</button>
              </div>
              <div class="rc-coordinate-group">
                <div class="rc-coord-input-wrapper">
                  <label class="rc-coord-label-inline" for="rc-toolsetter-x">X</label>
                  <input type="number" class="rc-input" id="rc-toolsetter-x" value="0" step="0.001">
                </div>
                <div class="rc-coord-input-wrapper">
                  <label class="rc-coord-label-inline" for="rc-toolsetter-y">Y</label>
                  <input type="number" class="rc-input" id="rc-toolsetter-y" value="0" step="0.001">
                </div>
              </div>
            </div>
          </div>

          <div class="rc-calibration-group">
            <div class="rc-form-group">
              <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 8px;">
                <label class="rc-form-label" style="margin: 0;">Manual Tool Coordinates</label>
                <button type="button" class="rc-button rc-button-grab" id="rc-manualtool-grab">Grab</button>
              </div>
              <div class="rc-coordinate-group">
                <div class="rc-coord-input-wrapper">
                  <label class="rc-coord-label-inline" for="rc-manualtool-x">X</label>
                  <input type="number" class="rc-input" id="rc-manualtool-x" value="0" step="0.001">
                </div>
                <div class="rc-coord-input-wrapper">
                  <label class="rc-coord-label-inline" for="rc-manualtool-y">Y</label>
                  <input type="number" class="rc-input" id="rc-manualtool-y" value="0" step="0.001">
                </div>
              </div>
            </div>
          </div>

        </div>

            <!-- Right Panel: Jog Controls -->
            <div class="rc-right-panel">
              <!-- Machine Coordinates Display -->
              <div class="rc-axis-card">
                <div class="rc-axis-title">Machine Coordinates</div>
                <div class="rc-axis-values">
                  <div class="rc-axis-item">
                    <span class="rc-axis-label">X</span>
                    <span class="rc-axis-value" id="rc-axis-x">0.000</span>
                  </div>
                  <div class="rc-axis-item">
                    <span class="rc-axis-label">Y</span>
                    <span class="rc-axis-value" id="rc-axis-y">0.000</span>
                  </div>
                  <div class="rc-axis-item">
                    <span class="rc-axis-label">Z</span>
                    <span class="rc-axis-value" id="rc-axis-z">0.000</span>
                  </div>
                </div>
              </div>

              <div class="rc-calibration-group">
                <nc-step-control></nc-step-control>
                <nc-jog-control></nc-jog-control>
              </div>

              <button type="button" class="rc-button rc-button-auto-calibrate" id="rc-auto-calibrate-btn">Auto Calibrate</button>

              <div class="rc-calibration-group">
                <div class="rc-form-group-horizontal">
                  <label class="rc-form-label">Spindle Delay</label>
                  <input type="number" class="rc-input" id="rc-spindle-delay" value="0" min="0" max="10" step="1">
                </div>

                <div class="rc-form-group-horizontal">
                  <label class="rc-form-label">Show Command</label>
                  <label class="toggle-switch">
                    <input type="checkbox" id="rc-show-macro-command">
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="rc-footer">
          <button type="button" class="rc-button rc-button-secondary" id="rc-close-btn">Close</button>
          <button type="button" class="rc-button" id="rc-save-btn">Save</button>
          <div id="rc-save-indicator" class="rc-save-indicator" style="display: none;">Settings saved successfully!</div>
        </div>
      </div>
      <script>
        (function() {
          const POCKET_PREFIX = 'pocket1';
          const TOOL_SETTER_PREFIX = 'toolsetter';
          const MANUAL_TOOL_PREFIX = 'manualtool';
          const FALLBACK_PORT = ${serverPort};
          const initialConfig = ${initialConfigJson};

          const resolveApiBaseUrl = () => {
            if (window.ncSender && typeof window.ncSender.getApiBaseUrl === 'function') {
              return window.ncSender.getApiBaseUrl(FALLBACK_PORT);
            }
            // Use relative path in development so Vite proxy handles it
            return '';
          };

          const BASE_URL = resolveApiBaseUrl();

          const getInput = (id) => document.getElementById(id);

          const formatCoordinate = (value) => (
            Number.isFinite(value) ? value.toFixed(3) : ''
          );

          const parseCoordinateString = (raw) => {
            if (typeof raw === 'string' && raw.length > 0) {
              const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
              if (parts.length >= 2 && parts.every(Number.isFinite)) {
                return { x: parts[0], y: parts[1], z: parts[2] };
              }
            }
            if (Array.isArray(raw) && raw.length >= 2) {
              const [x, y, z] = raw;
              if ([x, y].every(Number.isFinite)) {
                return { x, y, z };
              }
            }
            if (raw && typeof raw === 'object') {
              const { x, y, z } = raw;
              if ([x, y].every(Number.isFinite)) {
                return { x, y, z };
              }
            }
            return null;
          };

          const extractCoordinatesFromPayload = (payload) => {
            if (!payload || typeof payload !== 'object') {
              return null;
            }

            const nestedKeys = ['machineState', 'lastStatus', 'statusReport'];
            for (let i = 0; i < nestedKeys.length; i += 1) {
              const key = nestedKeys[i];
              if (payload[key] && typeof payload[key] === 'object') {
                const nestedCoords = extractCoordinatesFromPayload(payload[key]);
                if (nestedCoords) {
                  return nestedCoords;
                }
              }
            }

            const candidates = [
              payload.machineCoords,
              payload.MPos,
              payload.MPOS,
              payload.mpos,
              payload.machinePosition
            ];

            for (let i = 0; i < candidates.length; i += 1) {
              const coords = parseCoordinateString(candidates[i]);
              if (coords) {
                return coords;
              }
            }

            return null;
          };


          const setCoordinateInputs = (prefix, coords) => {
            if (!coords) return;
            const xInput = getInput('rc-' + prefix + '-x');
            const yInput = getInput('rc-' + prefix + '-y');

            if (xInput) {
              xInput.value = formatCoordinate(coords.x ?? Number.NaN);
            }
            if (yInput) {
              yInput.value = formatCoordinate(coords.y ?? Number.NaN);
            }
          };

          const setRadioValue = (name, value) => {
            const radios = document.querySelectorAll('input[name="' + name + '"]');
            radios.forEach(function(radio) {
              radio.checked = radio.value === value;
            });
          };

          const getRadioValue = (name) => {
            const selected = document.querySelector('input[name="' + name + '"]:checked');
            return selected ? selected.value : null;
          };

          const applyInitialSettings = () => {
            const colletSelect = getInput('rc-collet-size');
            if (colletSelect && initialConfig.colletSize) {
              colletSelect.value = initialConfig.colletSize;
            }

            const pocketsSelect = getInput('rc-pockets');
            if (pocketsSelect && initialConfig.pockets) {
              pocketsSelect.value = String(initialConfig.pockets);
            }

            const modelSelect = getInput('rc-model-select');
            if (modelSelect && initialConfig.model) {
              modelSelect.value = initialConfig.model;
            }

            setSliderValue('rc-orientation-toggle', initialConfig.orientation);
            setSliderValue('rc-direction-toggle', initialConfig.direction);
            setCoordinateInputs(POCKET_PREFIX, initialConfig.pocket1);
            setCoordinateInputs(TOOL_SETTER_PREFIX, initialConfig.toolSetter);
            setCoordinateInputs(MANUAL_TOOL_PREFIX, initialConfig.manualTool);

            const spindleDelayInput = getInput('rc-spindle-delay');
            if (spindleDelayInput) {
              spindleDelayInput.value = String(initialConfig.spindleDelay ?? 0);
            }

            const zEngagementInput = getInput('rc-zengagement');
            if (zEngagementInput) {
              zEngagementInput.value = formatCoordinate(initialConfig.zEngagement ?? -50);
            }

            const zone1Input = getInput('rc-zone1');
            if (zone1Input) {
              zone1Input.value = formatCoordinate(initialConfig.zone1 ?? -27);
            }

            const zone2Input = getInput('rc-zone2');
            if (zone2Input) {
              zone2Input.value = formatCoordinate(initialConfig.zone2 ?? -22);
            }

            const showMacroCommandCheck = getInput('rc-show-macro-command');
            if (showMacroCommandCheck) {
              showMacroCommandCheck.checked = !!initialConfig.showMacroCommand;
            }
          };

          const notifyError = (message) => {
            console.warn('[RapidChangeATC] ' + message);
            window.alert(message);
          };

          const notifySuccess = (message) => {
            console.log('[RapidChangeATC] ' + message);
          };

          const grabCoordinates = async (prefix) => {
            // Get coordinates from real-time axis display
            const axisX = document.getElementById('rc-axis-x');
            const axisY = document.getElementById('rc-axis-y');
            const axisZ = document.getElementById('rc-axis-z');

            if (!axisX || !axisY || !axisZ) {
              notifyError('Unable to read machine coordinates from display.');
              return;
            }

            const coords = {
              x: parseFloat(axisX.textContent),
              y: parseFloat(axisY.textContent),
              z: parseFloat(axisZ.textContent)
            };

            if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y) || !Number.isFinite(coords.z)) {
              notifyError('Invalid machine coordinates. Ensure the machine is connected.');
              return;
            }

            setCoordinateInputs(prefix, coords);

            // If grabbing pocket1, also populate Z engagement with -5 offset
            if (prefix === POCKET_PREFIX) {
              const zEngagementInput = getInput('rc-zengagement');
              if (zEngagementInput) {
                zEngagementInput.value = formatCoordinate(coords.z - 5);
              }
            }
          };


          const registerButton = (prefix, buttonId) => {
            const button = getInput(buttonId);
            if (!button) return;

            button.addEventListener('click', () => {
              if (button.disabled) {
                return;
              }

              button.disabled = true;
              button.classList.add('rc-button-busy');

              grabCoordinates(prefix).finally(() => {
                button.disabled = false;
                button.classList.remove('rc-button-busy');
              });
            });
          };

          const initSliderToggle = (toggleId) => {
            const toggle = document.getElementById(toggleId);
            if (!toggle) return;

            const options = toggle.querySelectorAll('.rc-slider-option');
            const indicator = toggle.querySelector('.rc-slider-indicator');

            const updateIndicator = (activeOption) => {
              const rect = activeOption.getBoundingClientRect();
              const toggleRect = toggle.getBoundingClientRect();
              indicator.style.left = (activeOption.offsetLeft) + 'px';
              indicator.style.width = rect.width + 'px';
            };

            options.forEach((option) => {
              option.addEventListener('click', () => {
                options.forEach((opt) => opt.classList.remove('active'));
                option.classList.add('active');
                updateIndicator(option);
              });
            });

            const activeOption = toggle.querySelector('.rc-slider-option.active');
            if (activeOption) {
              setTimeout(() => updateIndicator(activeOption), 0);
            }
          };

          const getParseFloat = (value) => {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : null;
          };

          const getParseInt = (value) => {
            const parsed = Number.parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : null;
          };

          const getSliderValue = (toggleId) => {
            const toggle = document.getElementById(toggleId);
            if (!toggle) return null;
            const activeOption = toggle.querySelector('.rc-slider-option.active');
            return activeOption ? activeOption.getAttribute('data-value') : null;
          };

          const setSliderValue = (toggleId, value) => {
            const toggle = document.getElementById(toggleId);
            if (!toggle || !value) return;

            const options = toggle.querySelectorAll('.rc-slider-option');
            const indicator = toggle.querySelector('.rc-slider-indicator');

            options.forEach((option) => {
              if (option.getAttribute('data-value') === value) {
                options.forEach((opt) => opt.classList.remove('active'));
                option.classList.add('active');

                setTimeout(() => {
                  indicator.style.left = (option.offsetLeft) + 'px';
                  indicator.style.width = option.getBoundingClientRect().width + 'px';
                }, 0);
              }
            });
          };

          const gatherFormData = () => {
            const colletSelect = getInput('rc-collet-size');
            const pocketsSelect = getInput('rc-pockets');
            const modelSelect = getInput('rc-model-select');
            const pocket1X = getInput('rc-pocket1-x');
            const pocket1Y = getInput('rc-pocket1-y');
            const toolSetterX = getInput('rc-toolsetter-x');
            const toolSetterY = getInput('rc-toolsetter-y');
            const manualToolX = getInput('rc-manualtool-x');
            const manualToolY = getInput('rc-manualtool-y');
            const spindleDelayInput = getInput('rc-spindle-delay');
            const zEngagementInput = getInput('rc-zengagement');
            const zone1Input = getInput('rc-zone1');
            const zone2Input = getInput('rc-zone2');
            const showMacroCommandCheck = getInput('rc-show-macro-command');

            return {
              colletSize: colletSelect ? colletSelect.value : null,
              pockets: pocketsSelect ? getParseInt(pocketsSelect.value) : null,
              model: modelSelect ? modelSelect.value : null,
              orientation: getSliderValue('rc-orientation-toggle'),
              direction: getSliderValue('rc-direction-toggle'),
              showMacroCommand: showMacroCommandCheck ? showMacroCommandCheck.checked : false,
              spindleDelay: spindleDelayInput ? getParseInt(spindleDelayInput.value) : 0,
              zEngagement: zEngagementInput ? getParseFloat(zEngagementInput.value) : -50,
              zone1: zone1Input ? getParseFloat(zone1Input.value) : -27,
              zone2: zone2Input ? getParseFloat(zone2Input.value) : -22,
              pocket1: {
                x: pocket1X ? getParseFloat(pocket1X.value) : null,
                y: pocket1Y ? getParseFloat(pocket1Y.value) : null
              },
              toolSetter: {
                x: toolSetterX ? getParseFloat(toolSetterX.value) : null,
                y: toolSetterY ? getParseFloat(toolSetterY.value) : null
              },
              manualTool: {
                x: manualToolX ? getParseFloat(manualToolX.value) : null,
                y: manualToolY ? getParseFloat(manualToolY.value) : null
              }
            };
          };

          const closeButton = getInput('rc-close-btn');
          if (closeButton) {
            closeButton.addEventListener('click', function() {
              window.postMessage({ type: 'close-plugin-dialog' }, '*');
            });
          }

          const saveButton = getInput('rc-save-btn');
          const saveIndicator = document.getElementById('rc-save-indicator');
          if (saveButton) {
            saveButton.addEventListener('click', async function() {
              if (saveButton.disabled) {
                return;
              }

              saveButton.disabled = true;
              saveButton.classList.add('rc-button-busy');

              const payload = gatherFormData();

              try {
                const pluginResponse = await fetch(BASE_URL + '/api/plugins/com.ncsender.rapidchangeatc/settings', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });

                if (!pluginResponse.ok) {
                  throw new Error('Failed to save plugin settings: ' + pluginResponse.status);
                }

                const toolCount = payload.pockets || 0;
                const settingsResponse = await fetch(BASE_URL + '/api/settings', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tool: {
                      count: toolCount,
                      source: 'com.ncsender.rapidchangeatc',
                      manual: true,
                      tls: true
                    }
                  })
                });

                if (!settingsResponse.ok) {
                  throw new Error('Failed to update tool.count setting: ' + settingsResponse.status);
                }

                // Show save indicator
                if (saveIndicator) {
                  saveIndicator.style.display = 'block';
                  setTimeout(function() {
                    saveIndicator.style.display = 'none';
                  }, 5000);
                }

                // Re-enable save button after successful save
                saveButton.disabled = false;
                saveButton.classList.remove('rc-button-busy');
              } catch (error) {
                console.error('[RapidChangeATC] Failed to save settings:', error);
                notifyError('Failed to save settings. Please try again.');
                saveButton.disabled = false;
                saveButton.classList.remove('rc-button-busy');
              }
            });
          }

          const autoCalibrateButton = getInput('rc-auto-calibrate-btn');
          if (autoCalibrateButton) {
            autoCalibrateButton.addEventListener('click', async function() {
              if (autoCalibrateButton.disabled) {
                return;
              }

              autoCalibrateButton.disabled = true;
              autoCalibrateButton.classList.add('rc-button-busy');

              // First, grab coordinates (populates Pocket 1 X, Y and Z engagement in UI)
              await grabCoordinates(POCKET_PREFIX);

              // Then send auto-calibrate command to server
              const message = {
                type: 'plugin-message',
                data: {
                  event: 'auto-calibrate',
                  payload: {}
                }
              };

              console.log('[RapidChangeATC] Sending auto-calibrate command');
              window.postMessage(message, '*');

              notifySuccess('Auto calibrate started - waiting for probe result...');

              setTimeout(function() {
                autoCalibrateButton.disabled = false;
                autoCalibrateButton.classList.remove('rc-button-busy');
              }, 2000);
            });
          }

          // Listen for cnc-data messages
          const handleCNCData = (event) => {
            if (!event.data || event.data.type !== 'cnc-data') return;

            const cncData = event.data.data;
            console.log('[RapidChangeATC] Received cnc-data:', cncData);

            // Check for PARAM:5063 which signals probe completed
            if (typeof cncData === 'string' && cncData.includes('PARAM:5063')) {
              console.log('[RapidChangeATC] Probe completed - grabbing machine Z for zone calculation');

              // Get machine Z from axis display
              const axisZ = document.getElementById('rc-axis-z');
              if (!axisZ) {
                console.error('[RapidChangeATC] Cannot find axis Z display');
                return;
              }

              const machineZ = parseFloat(axisZ.textContent);
              if (!Number.isFinite(machineZ)) {
                console.error('[RapidChangeATC] Invalid machine Z value:', axisZ.textContent);
                return;
              }

              // Calculate zones: zone1 = Z - 3, zone2 = Z + 2
              const zone1 = machineZ - 3;
              const zone2 = machineZ + 2;

              console.log('[RapidChangeATC] Machine Z:', machineZ, 'Zone1:', zone1, 'Zone2:', zone2);

              // Update the input fields
              const zone1Input = getInput('rc-zone1');
              const zone2Input = getInput('rc-zone2');

              if (zone1Input) {
                zone1Input.value = zone1.toFixed(3);
              }
              if (zone2Input) {
                zone2Input.value = zone2.toFixed(3);
              }

              notifySuccess('Zones calculated: Zone1=' + zone1.toFixed(3) + ', Zone2=' + zone2.toFixed(3));
            }
          };

          window.addEventListener('message', handleCNCData);

          // Update axis display from coordinates
          const updateAxisDisplay = (coords) => {
            if (!coords) return;

            const axisX = document.getElementById('rc-axis-x');
            const axisY = document.getElementById('rc-axis-y');
            const axisZ = document.getElementById('rc-axis-z');

            if (axisX && coords.x !== undefined) axisX.textContent = formatCoordinate(coords.x);
            if (axisY && coords.y !== undefined) axisY.textContent = formatCoordinate(coords.y);
            if (axisZ && coords.z !== undefined) axisZ.textContent = formatCoordinate(coords.z);
          };

          // Subscribe to server state updates via postMessage
          const handleServerStateUpdate = (event) => {
            if (!event.data || event.data.type !== 'server-state-update') return;

            const coords = extractCoordinatesFromPayload(event.data.state);
            if (coords) {
              updateAxisDisplay(coords);
            }
          };

          window.addEventListener('message', handleServerStateUpdate);

          applyInitialSettings();
          registerButton(POCKET_PREFIX, 'rc-pocket1-grab');
          registerButton(TOOL_SETTER_PREFIX, 'rc-toolsetter-grab');
          registerButton(MANUAL_TOOL_PREFIX, 'rc-manualtool-grab');

          initSliderToggle('rc-orientation-toggle');
          initSliderToggle('rc-direction-toggle');
        })();
      </script>
    `,
      { size: 'large' }
    );
  }, {
    icon: 'logo.png'
  });
}

export async function onUnload(ctx) {
  ctx.log('Rapid Change ATC plugin unloading');

  // Reset tool.source and tool.count to give control back to Settings > General
  const pluginSettings = ctx.getSettings() || {};
  const appSettings = ctx.getAppSettings() || {};

  try {
    const response = await fetch(`http://localhost:${resolveServerPort(pluginSettings, appSettings)}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: {
          source: null,
          count: 0,
          manual: false,
          tls: false
        }
      })
    });

    if (response.ok) {
      ctx.log('Tool settings reset: count=0, manual=false, tls=false, source=null');
    } else {
      ctx.log(`Failed to reset tool settings: ${response.status}`);
    }
  } catch (error) {
    ctx.log('Failed to reset tool settings on plugin unload:', error);
  }
}
