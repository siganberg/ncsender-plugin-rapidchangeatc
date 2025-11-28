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

const clampAtcStartDelay = (value) => {
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

const clampRpm = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, 500), 2000);
};

const getDefaultLoadRpm = (colletSize) => {
  if (colletSize === 'ER16') return 1600;
  return 1200; // ER20 and others
};

const getDefaultUnloadRpm = (colletSize) => {
  if (colletSize === 'ER16') return 2000;
  return 1500; // ER20 and others
};

const getDefaultSpindleAtSpeed = (colletSize) => {
  if (colletSize === 'ER16') return true;
  return false; // ER20 and others
};

const getDefaultZRetreat = (colletSize) => {
  if (colletSize === 'ER16') return 17;
  return 7; // ER20 and others
};

const buildInitialConfig = (raw = {}) => {
  const colletSize = sanitizeColletSize(raw.colletSize ?? raw.model);

  // Use user-provided values if they exist, otherwise use collet-specific defaults
  const loadRpm = raw.loadRpm !== undefined && raw.loadRpm !== null
    ? toFiniteNumber(raw.loadRpm, getDefaultLoadRpm(colletSize))
    : getDefaultLoadRpm(colletSize);
  const unloadRpm = raw.unloadRpm !== undefined && raw.unloadRpm !== null
    ? toFiniteNumber(raw.unloadRpm, getDefaultUnloadRpm(colletSize))
    : getDefaultUnloadRpm(colletSize);
  const spindleAtSpeed = raw.spindleAtSpeed !== undefined && raw.spindleAtSpeed !== null
    ? !!raw.spindleAtSpeed
    : getDefaultSpindleAtSpeed(colletSize);
  const zRetreat = getDefaultZRetreat(colletSize);

  return {
    // UI Settings
    colletSize,
    pockets: clampPockets(raw.pockets),
    model: sanitizeModel(raw.model ?? raw.trip ?? raw.modelName ?? raw.machineModel),
    orientation: sanitizeOrientation(raw.orientation),
    direction: sanitizeDirection(raw.direction),
    showMacroCommand: raw.showMacroCommand ?? false,
    performTlsAfterHome: raw.performTlsAfterHome ?? false,
    spindleAtSpeed,
    atcStartDelay: clampAtcStartDelay(raw.atcStartDelay ?? raw.spindleDelay),

    // Position Settings
    pocket1: sanitizeCoords(raw.pocket1),
    toolSetter: sanitizeCoords(raw.toolSetter),
    manualTool: sanitizeCoords(raw.manualTool),
    pocketDistance: toFiniteNumber(raw.pocketDistance, 45),

    // Z-axis Settings
    zEngagement: toFiniteNumber(raw.zEngagement, -50),
    zSafe: toFiniteNumber(raw.zSafe, 0),
    zSpinOff: toFiniteNumber(raw.zSpinOff, 23),
    zRetreat,
    zProbeStart: toFiniteNumber(raw.zProbeStart, -20),
    zone1: toFiniteNumber(raw.zone1, -27.0),
    zone2: toFiniteNumber(raw.zone2, -22.0),

    // Tool Change Settings
    loadRpm,
    unloadRpm,
    engageFeedrate: toFiniteNumber(raw.engageFeedrate, 3500),

    // Tool Setter Settings
    seekDistance: toFiniteNumber(raw.seekDistance, 50),
    seekFeedrate: toFiniteNumber(raw.seekFeedrate, 800)
  };
};

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
    G38.2 G91 Z-5 F75
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
    (MSG,TOOL_CHANGE_COMPLETE)
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

function handleHomeCommand(commands, settings, ctx) {
  const homeIndex = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$H'
  );

  if (homeIndex === -1) {
    return; // No $H command found
  }

  // Only handle if performTlsAfterHome is enabled
  if (!settings.performTlsAfterHome) {
    return;
  }

  ctx.log('$H command detected with performTlsAfterHome enabled, adding conditional TLS');

  const homeCommand = commands[homeIndex];
  const tlsRoutine = createToolLengthSetRoutine(settings).join('\n');

  const gcode = `
    $H
    o100 IF [#<_tool_offset> EQ 0]
      ${tlsRoutine}
      G53 G0 Z${settings.zSafe}
      G53 G0 X0 Y0
    o100 ENDIF
  `.trim();

  const homeProgram = formatGCode(gcode);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = homeProgram.map((line, index) => {
    if (index === 0) {
      return {
        command: line,
        displayCommand: showMacroCommand ? null : homeCommand.command.trim(),
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

  commands.splice(homeIndex, 1, ...expandedCommands);
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
  const g65p6Before = settings.spindleAtSpeed ? '' : 'G65P6';
  const g65p6After = settings.spindleAtSpeed ? '' : 'G65P6';
  return `
    G53 G0 Z${settings.zEngagement + settings.zSpinOff}
    ${g65p6Before}
    M4 S${settings.unloadRpm}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    ${g65p6After}
    M5
    G53 G0 Z${zone1}
    G4 P0.2
  `.trim();
}

// Helper: Tool load routine
function createToolLoad(settings, tool) {
  const zone1 = settings.zone1;
  const zone2 = settings.zone2;
  const manualFallback = createManualToolFallback(settings);
  const g65p6Before = settings.spindleAtSpeed ? '' : 'G65P6';
  const g65p6After = settings.spindleAtSpeed ? '' : 'G65P6';

  return `
    G53 G0 Z${settings.zEngagement + settings.zSpinOff}
    ${g65p6Before}
    M3 S${settings.loadRpm}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement} F${settings.engageFeedrate}
    G53 G1 Z${settings.zEngagement + settings.zRetreat} F${settings.engageFeedrate}
    ${g65p6After}
    M5
    G53 G0 Z${zone1}
    G4 P0.2
    o300 IF [#<_probe_state> EQ 0 AND #<_toolsetter_state> EQ 0]
      (MSG, PLUGIN_RAPIDCHANGEATC:FAILED_LOAD_TOOL)
      ${manualFallback}
    o300 ELSE
       G53 G0 Z${zone2}
       G4 P0.2
       o301 IF [#<_probe_state> EQ 1 OR #<_toolsetter_state> EQ 1]
        (MSG, PLUGIN_RAPIDCHANGEATC:FAILED_LOAD_TOOL)
        ${manualFallback}
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
      (MSG, PLUGIN_RAPIDCHANGEATC:MANUAL_UNLOAD_TOOL)
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
          (MSG, PLUGIN_RAPIDCHANGEATC:FAILED_UNLOAD_TOOL)
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
      (MSG, PLUGIN_RAPIDCHANGEATC:MANUAL_LOAD_TOOL)
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
  const atcStartDelaySection = settings.atcStartDelay > 0 ? `G4 P${settings.atcStartDelay}` : '';
  const unloadSection = buildUnloadTool(settings, currentTool, sourcePos);
  const loadSection = buildLoadTool(settings, toolNumber, targetPos, tlsRoutine);

  // Assemble complete program
  const gcode = `
    (Start of RapidChangeATC Plugin Sequence)
    #<return_units> = [20 + #<_metric>]
    G21
    M5
    ${atcStartDelaySection}
    ${unloadSection}
    ${loadSection}
    G53 G0 Z${settings.zSafe}
    G[#<return_units>]
    (End of RapidChangeATC Plugin Sequence)
    (MSG,TOOL_CHANGE_COMPLETE)
  `.trim();

  // Format G-code with proper indentation
  return formatGCode(gcode);
}

// Show safety warning dialog
function showSafetyWarningDialog(ctx, title, message, continueLabel) {
  ctx.showModal(
    /* html */ `
      <style>
        .rcs-safety-container {
          background: var(--color-surface);
          border-radius: var(--radius-medium);
          padding: 32px;
          max-width: 500px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        .rcs-safety-header {
          font-size: 1.5rem;
          font-weight: 600;
          color: var(--color-text-primary);
          margin-bottom: 24px;
          text-align: center;
        }

        .rcs-safety-dialog {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .rcs-safety-message {
          font-size: 1rem;
          line-height: 1.5;
          color: var(--color-text-primary);
          background: color-mix(in srgb, var(--color-warning) 15%, transparent);
          border: 2px solid var(--color-warning);
          border-radius: var(--radius-small);
          padding: 16px;
        }

        .rcs-safety-actions {
          display: flex;
          justify-content: center;
          gap: 16px;
        }

        .rcs-long-press-button {
          position: relative;
          padding: 12px 32px;
          border: none;
          border-radius: var(--radius-small);
          font-weight: 600;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s ease;
          overflow: hidden;
          min-width: 140px;
          user-select: none;
        }

        .rcs-long-press-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .rcs-button-abort {
          background: var(--color-error, #dc2626);
          color: white;
        }

        .rcs-button-continue {
          background: var(--color-success, #16a34a);
          color: white;
        }

        .rcs-button-progress {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 4px;
          background: rgba(255, 255, 255, 0.5);
          width: 0%;
          transition: width 0.05s linear;
        }

        .rcs-button-label {
          position: relative;
          z-index: 1;
        }
      </style>

      <div class="rcs-safety-container">
        <div class="rcs-safety-header">${title}</div>
        <div class="rcs-safety-dialog">
          <div class="rcs-safety-message">${message}</div>
          <div class="rcs-safety-actions">
            <button class="rcs-long-press-button rcs-button-abort" id="rcs-abort-btn">
              <span class="rcs-button-label">Abort</span>
              <div class="rcs-button-progress"></div>
            </button>
            <button class="rcs-long-press-button rcs-button-continue" id="rcs-continue-btn">
              <span class="rcs-button-label">${continueLabel}</span>
              <div class="rcs-button-progress"></div>
            </button>
          </div>
        </div>
      </div>

      <script>
        (function() {
          const LONG_PRESS_DURATION = 1000;
          let abortTimer = null;
          let continueTimer = null;
          let abortStartTime = 0;
          let continueStartTime = 0;
          let abortAnimFrame = null;
          let continueAnimFrame = null;

          const abortBtn = document.getElementById('rcs-abort-btn');
          const continueBtn = document.getElementById('rcs-continue-btn');
          const abortProgress = abortBtn.querySelector('.rcs-button-progress');
          const continueProgress = continueBtn.querySelector('.rcs-button-progress');

          const updateProgress = (startTime, progressEl) => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min((elapsed / LONG_PRESS_DURATION) * 100, 100);
            progressEl.style.width = progress + '%';
            return progress < 100;
          };

          const startAbortPress = () => {
            if (abortBtn.disabled) return;
            abortStartTime = Date.now();

            const animate = () => {
              if (updateProgress(abortStartTime, abortProgress)) {
                abortAnimFrame = requestAnimationFrame(animate);
              }
            };
            animate();

            abortTimer = setTimeout(() => {
              abortBtn.disabled = true;
              continueBtn.disabled = true;

              window.postMessage({
                type: 'send-command',
                command: '\\x18',
                displayCommand: '\\x18 (Soft Reset)'
              }, '*');

              window.postMessage({
                type: 'send-command',
                command: '$NCSENDER_CLEAR_MSG',
                displayCommand: '$NCSENDER_CLEAR_MSG'
              }, '*');
            }, LONG_PRESS_DURATION);
          };

          const stopAbortPress = () => {
            if (abortTimer) {
              clearTimeout(abortTimer);
              abortTimer = null;
            }
            if (abortAnimFrame) {
              cancelAnimationFrame(abortAnimFrame);
              abortAnimFrame = null;
            }
            abortProgress.style.width = '0%';
          };

          const startContinuePress = () => {
            if (continueBtn.disabled) return;
            continueStartTime = Date.now();

            const animate = () => {
              if (updateProgress(continueStartTime, continueProgress)) {
                continueAnimFrame = requestAnimationFrame(animate);
              }
            };
            animate();

            continueTimer = setTimeout(() => {
              abortBtn.disabled = true;
              continueBtn.disabled = true;

              window.postMessage({
                type: 'send-command',
                command: '~',
                displayCommand: '~ (Cycle Start)'
              }, '*');

              window.postMessage({
                type: 'send-command',
                command: '$NCSENDER_CLEAR_MSG',
                displayCommand: '$NCSENDER_CLEAR_MSG'
              }, '*');
            }, LONG_PRESS_DURATION);
          };

          const stopContinuePress = () => {
            if (continueTimer) {
              clearTimeout(continueTimer);
              continueTimer = null;
            }
            if (continueAnimFrame) {
              cancelAnimationFrame(continueAnimFrame);
              continueAnimFrame = null;
            }
            continueProgress.style.width = '0%';
          };

          abortBtn.addEventListener('mousedown', startAbortPress);
          abortBtn.addEventListener('mouseup', stopAbortPress);
          abortBtn.addEventListener('mouseleave', stopAbortPress);
          abortBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startAbortPress(); });
          abortBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopAbortPress(); });
          abortBtn.addEventListener('touchcancel', stopAbortPress);

          continueBtn.addEventListener('mousedown', startContinuePress);
          continueBtn.addEventListener('mouseup', stopContinuePress);
          continueBtn.addEventListener('mouseleave', stopContinuePress);
          continueBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startContinuePress(); });
          continueBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopContinuePress(); });
          continueBtn.addEventListener('touchcancel', stopContinuePress);
        })();
      </script>
    `,
    { closable: false }
  );
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

  const MESSAGE_MAP = {
    'PLUGIN_RAPIDCHANGEATC:FAILED_UNLOAD_TOOL': {
      title: 'Unload Failed',
      message: 'Failed to unload the bit. Please manually remove the bit, then <strong>PRESS</strong> and <strong>HOLD</strong> <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel the operation.',
      continueLabel: 'Continue'
    },
    'PLUGIN_RAPIDCHANGEATC:FAILED_LOAD_TOOL': {
      title: 'Load Failed',
      message: 'Failed to load the bit. Please manually install the bit, then <strong>PRESS</strong> and <strong>HOLD</strong> <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel the operation.',
      continueLabel: 'Continue'
    },
    'PLUGIN_RAPIDCHANGEATC:MANUAL_UNLOAD_TOOL': {
      title: 'Manual Unload',
      message: 'Please remove the current bit, then <strong>press and hold</strong> <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel.',
      continueLabel: 'Continue'
    },
    'PLUGIN_RAPIDCHANGEATC:MANUAL_LOAD_TOOL': {
      title: 'Manual Load',
      message: 'Please install the new bit securely, then <strong>press and hold</strong> <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel.',
      continueLabel: 'Continue'
    }
  };

  ctx.registerEventHandler('ws:cnc-data', async (data) => {
    if (typeof data === 'string') {
      const upperData = data.toUpperCase();
      if (upperData.includes('[MSG') && upperData.includes('PLUGIN_RAPIDCHANGEATC:')) {
        for (const [code, config] of Object.entries(MESSAGE_MAP)) {
          if (upperData.includes(code)) {
            showSafetyWarningDialog(ctx, config.title, config.message, config.continueLabel);
            break;
          }
        }
      }
    }
  });

  // NEW API: onBeforeCommand receives command array
  ctx.registerEventHandler('onBeforeCommand', async (commands, context) => {
    const rawSettings = ctx.getSettings() || {};

    // Skip command handling if plugin is not configured
    if (!rawSettings.pocket1 || !rawSettings.pockets) {
      ctx.log('Plugin not configured, skipping command handling');
      return commands;
    }

    const settings = buildInitialConfig(rawSettings);

    // Handle $H (home) command with conditional TLS
    handleHomeCommand(commands, settings, ctx);

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
      const settings = buildInitialConfig(rawSettings);
      const resolvedPort = resolveServerPort(rawSettings, appSettings);

      const gcode = `
        (If the IR sensor isn’t triggered yet, move up first until it triggers. This is needed if the Z-engagement is set too low.)
        o100 IF [#<_probe_state> EQ 0 AND #<_toolsetter_state> EQ 0]
          G38.2 G91 Z50 F200
        o100 ENDIF
        G38.4 G91 Z50 F200
        $#=5063
      `;

      const AUTO_CALIBRATE_GCODE = formatGCode(gcode).join('\n');

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
          throw new Error(`Failed to send auto detect command: ${response.status} - ${errorBody}`);
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

        .rc-tabs {
          display: flex;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-surface-muted);
          padding: var(--gap-xs) var(--gap-md) 0 var(--gap-md);
          gap: 2px;
          border-left: 1px solid var(--color-border);
          border-right: 1px solid var(--color-border);
          border-top: 1px solid var(--color-border);
        }

        .rc-tab {
          all: unset;
          display: flex;
          align-items: center;
          gap: var(--gap-xs);
          padding: var(--gap-sm) var(--gap-md);
          background: transparent !important;
          border: none !important;
          border-radius: var(--radius-small) var(--radius-small) 0 0 !important;
          color: var(--color-text-secondary) !important;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 0.95rem;
          font-weight: 500;
          margin-top: var(--gap-xs);
          position: relative;
          box-sizing: border-box;
        }

        .rc-tab:hover {
          background: var(--color-surface) !important;
          color: var(--color-text-primary);
          transform: translateY(-1px);
          filter: none !important;
        }

        .rc-tab.active {
          background: var(--color-surface) !important;
          color: var(--color-text-primary) !important;
          box-shadow: var(--shadow-elevated);
          border-bottom: 2px solid var(--color-accent) !important;
          filter: none !important;
        }

        .rc-tab.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--gradient-accent);
          border-radius: 2px 2px 0 0;
        }

        .rc-tab:focus-visible {
          outline: 2px solid var(--color-accent);
          outline-offset: 2px;
        }

        .rc-tab-label {
          font-weight: 600;
        }

        .rc-tab-content {
          display: none;
        }

        .rc-tab-content.active {
          display: block;
        }

        .rc-content {
          overflow-y: auto;
          padding: 30px;
          padding-top: 20px;
          padding-bottom: 20px;
          background: var(--color-surface-muted);
          border-left: 1px solid var(--color-border);
          border-right: 1px solid var(--color-border);
          border-bottom: 1px solid var(--color-border);
          min-height: 515px;
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
          gap: 12px;
        }

        .rc-left-panel .rc-calibration-group {
          padding: 18px 20px;
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

        .rc-calibration-group nc-step-control {
          width: 100%;
          display: flex;
          justify-content: center;
          transform: scale(0.95);
        }

        .rc-right-panel nc-step-control {
          max-width: 200px;
          margin: 0 auto;
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

        .rc-button-group {
          display: inline-flex;
        }

        .rc-button-group .rc-button {
          padding: 6px 12px !important;
          margin: 0 !important;
        }

        .rc-button-group .rc-button-group-left {
          border-radius: var(--radius-small) 0 0 var(--radius-small) !important;
        }

        .rc-button-group .rc-button-group-right {
          border-radius: 0 var(--radius-small) var(--radius-small) 0 !important;
          border-left: 1px solid rgba(0, 0, 0, 0.2) !important;
          padding: 6px 10px !important;
        }

        .rc-button-grab {
          padding: 6px 16px !important;
        }

        .rc-button-group .rc-button-grab {
          padding: 6px 12px !important;
        }

        .rc-button-auto-calibrate {
          width: 200px;
          padding: 10px 16px;
          margin: 0 auto;
        }

        .rc-button-group .rc-button-auto-calibrate {
          width: auto !important;
          padding: 6px 10px !important;
          margin: 0 !important;
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

        .rc-button-saved {
          box-shadow: 0 0 20px var(--color-accent), 0 0 40px var(--color-accent);
          animation: glowPulse 0.5s ease-in-out infinite;
        }

        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 20px var(--color-accent); }
          50% { box-shadow: 0 0 30px var(--color-accent), 0 0 50px var(--color-accent); }
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

        .rc-tooltip {
          position: relative;
          display: inline-block;
        }

        .rc-tooltip .rc-tooltip-text {
          visibility: hidden;
          width: 450px;
          background-color: var(--color-surface);
          color: var(--color-text-primary);
          text-align: left;
          border-radius: var(--radius-medium);
          padding: 14px 18px;
          position: absolute;
          z-index: 1000;
          top: 125%;
          left: 50%;
          margin-left: -225px;
          opacity: 0;
          transition: opacity 0.3s;
          border: 1px solid var(--color-border);
          box-shadow: var(--shadow-elevated);
          font-size: 0.9rem;
          line-height: 1.6;
        }

        .rc-tooltip .rc-tooltip-text::after {
          content: "";
          position: absolute;
          bottom: 100%;
          left: 50%;
          margin-left: -5px;
          border-width: 5px;
          border-style: solid;
          border-color: transparent transparent var(--color-surface) transparent;
        }

        .rc-tooltip:hover .rc-tooltip-text {
          visibility: visible;
          opacity: 1;
        }
      </style>

      <div class="rc-dialog-wrapper">
        <div class="rc-tabs">
          <button class="rc-tab active" data-tab="basic">
            <span class="rc-tab-label">Basic</span>
          </button>
          <button class="rc-tab" data-tab="advanced">
            <span class="rc-tab-label">Advance</span>
          </button>
        </div>

        <div class="rc-content">
          <div class="rc-tab-content active" id="rc-tab-basic">
            <div class="rc-container">
              <!-- Left Panel: Form Controls -->
          <div class="rc-left-panel">
          <div class="rc-calibration-group">
            <div class="rc-form-row">
              <div class="rc-form-group">
                <label class="rc-form-label">Collet Size</label>
                <select class="rc-select" id="rc-collet-size">
                  <option value="ER11" disabled>ER11</option>
                  <option value="ER16">ER16</option>
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
                <div class="rc-button-group">
                  <button type="button" class="rc-button rc-button-grab rc-button-group-left" id="rc-pocket1-grab">Grab</button>
                  <div class="rc-tooltip">
                    <button type="button" class="rc-button rc-button-auto-calibrate rc-button-group-right" id="rc-auto-calibrate-btn">Auto Detect</button>
                    <span class="rc-tooltip-text">With the collet, nut, and bit installed on the spindle, position the spindle over Pocket 1 of the magazine. Use the Jog controls to lower and fine-tune the position until the nut is just inside Pocket 1. Manually rotate the spindle to ensure nothing is rubbing. Once everything is centered, continue lowering until the nut begins to touch the pocket's ball bearing, then click Auto Detect.</span>
                  </div>
                </div>
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

        </div>

            <!-- Right Panel: Jog Controls -->
            <div class="rc-right-panel">
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

              <div class="rc-calibration-group">
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

                <nc-step-control></nc-step-control>
                <nc-jog-control></nc-jog-control>
              </div>

            </div>
          </div>
          </div>

          <div class="rc-tab-content" id="rc-tab-advanced">
            <div class="rc-container">
              <div class="rc-left-panel">
                <div class="rc-calibration-group">
                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label">Z-Retreat (mm)</label>
                    <input type="number" class="rc-input" id="rc-z-retreat" value="7" min="0" max="200" step="0.1">
                  </div>

                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label">Tool Sensor/IR Port</label>
                    <select class="rc-select" id="rc-tool-sensor">
                      <option value="Probe Port">Probe Port</option>
                      <option value="TLS Port" selected>TLS Port</option>
                    </select>
                  </div>

                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label">Delay before ATC start</label>
                    <input type="number" class="rc-input" id="rc-atc-start-delay" value="0" min="0" max="10" step="1">
                  </div>

                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label">Load RPM</label>
                    <input type="number" class="rc-input" id="rc-load-rpm" value="1200" min="500" max="2000" step="1">
                  </div>

                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label">Unload RPM</label>
                    <input type="number" class="rc-input" id="rc-unload-rpm" value="1500" min="500" max="2000" step="1">
                  </div>

                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label">Show Command</label>
                    <label class="toggle-switch">
                      <input type="checkbox" id="rc-show-macro-command">
                      <span class="toggle-slider"></span>
                    </label>
                  </div>

                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label">Perform TLS after first HOME</label>
                    <label class="toggle-switch">
                      <input type="checkbox" id="rc-perform-tls-after-home">
                      <span class="toggle-slider"></span>
                    </label>
                  </div>

                  <div class="rc-form-group-horizontal">
                    <label class="rc-form-label" title="Wait for spindle to reach its speed before unloading/loading bits">Spindle At-Speed</label>
                    <label class="toggle-switch">
                      <input type="checkbox" id="rc-spindle-at-speed">
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
              </div>
              <div class="rc-right-panel">
              </div>
            </div>
          </div>
        </div>

        <div class="rc-footer">
          <button type="button" class="rc-button rc-button-secondary" id="rc-close-btn">Close</button>
          <button type="button" class="rc-button" id="rc-save-btn">Save</button>
        </div>
      </div>
      <script>
        (function() {
          const POCKET_PREFIX = 'pocket1';
          const TOOL_SETTER_PREFIX = 'toolsetter';
          const MANUAL_TOOL_PREFIX = 'manualtool';
          const FALLBACK_PORT = ${serverPort};
          const initialConfig = ${initialConfigJson};

          // Tab switching logic
          const tabs = document.querySelectorAll('.rc-tab');
          const tabContents = document.querySelectorAll('.rc-tab-content');

          tabs.forEach(tab => {
            tab.addEventListener('click', () => {
              const targetTab = tab.getAttribute('data-tab');

              // Remove active class from all tabs and contents
              tabs.forEach(t => t.classList.remove('active'));
              tabContents.forEach(c => c.classList.remove('active'));

              // Add active class to clicked tab and corresponding content
              tab.classList.add('active');
              document.getElementById('rc-tab-' + targetTab).classList.add('active');
            });
          });

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

            const atcStartDelayInput = getInput('rc-atc-start-delay');
            if (atcStartDelayInput) {
              atcStartDelayInput.value = String(initialConfig.atcStartDelay ?? 0);
            }

            const loadRpmInput = getInput('rc-load-rpm');
            if (loadRpmInput) {
              loadRpmInput.value = String(initialConfig.loadRpm ?? 1200);
            }

            const unloadRpmInput = getInput('rc-unload-rpm');
            if (unloadRpmInput) {
              unloadRpmInput.value = String(initialConfig.unloadRpm ?? 1500);
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

            const performTlsAfterHomeCheck = getInput('rc-perform-tls-after-home');
            if (performTlsAfterHomeCheck) {
              performTlsAfterHomeCheck.checked = !!initialConfig.performTlsAfterHome;
            }

            const spindleAtSpeedCheck = getInput('rc-spindle-at-speed');
            if (spindleAtSpeedCheck) {
              spindleAtSpeedCheck.checked = !!initialConfig.spindleAtSpeed;
            }
          };

          const notifyError = (message) => {
            console.warn('[RapidChangeATC] ' + message);
            window.alert(message);
          };

          const notifySuccess = (message) => {
            // Success notifications handled by UI feedback
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
            const atcStartDelayInput = getInput('rc-atc-start-delay');
            const loadRpmInput = getInput('rc-load-rpm');
            const unloadRpmInput = getInput('rc-unload-rpm');
            const zEngagementInput = getInput('rc-zengagement');
            const zone1Input = getInput('rc-zone1');
            const zone2Input = getInput('rc-zone2');
            const showMacroCommandCheck = getInput('rc-show-macro-command');
            const performTlsAfterHomeCheck = getInput('rc-perform-tls-after-home');
            const spindleAtSpeedCheck = getInput('rc-spindle-at-speed');

            return {
              colletSize: colletSelect ? colletSelect.value : null,
              pockets: pocketsSelect ? getParseInt(pocketsSelect.value) : null,
              model: modelSelect ? modelSelect.value : null,
              orientation: getSliderValue('rc-orientation-toggle'),
              direction: getSliderValue('rc-direction-toggle'),
              showMacroCommand: showMacroCommandCheck ? showMacroCommandCheck.checked : false,
              performTlsAfterHome: performTlsAfterHomeCheck ? performTlsAfterHomeCheck.checked : false,
              spindleAtSpeed: spindleAtSpeedCheck ? spindleAtSpeedCheck.checked : false,
              atcStartDelay: atcStartDelayInput ? getParseInt(atcStartDelayInput.value) : 0,
              loadRpm: loadRpmInput ? getParseInt(loadRpmInput.value) : 1200,
              unloadRpm: unloadRpmInput ? getParseInt(unloadRpmInput.value) : 1500,
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

                // Show saved state with glow effect
                saveButton.textContent = 'Saved';
                saveButton.classList.add('rc-button-saved');
                saveButton.classList.remove('rc-button-busy');
                saveButton.disabled = false;

                // Revert back to "Save" after 2 seconds
                setTimeout(function() {
                  saveButton.textContent = 'Save';
                  saveButton.classList.remove('rc-button-saved');
                }, 2000);
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

              window.postMessage(message, '*');

              notifySuccess('Auto detect started - waiting for probe result...');

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

            // Check for PARAM:5063 which signals probe completed
            if (typeof cncData === 'string' && cncData.includes('PARAM:5063')) {

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

          // Add event listener for collet size changes
          const colletSelect = getInput('rc-collet-size');
          if (colletSelect) {
            colletSelect.addEventListener('change', function() {
              const newColletSize = colletSelect.value;
              const loadRpmInput = getInput('rc-load-rpm');
              const unloadRpmInput = getInput('rc-unload-rpm');
              const spindleAtSpeedCheck = getInput('rc-spindle-at-speed');
              const zRetreatInput = getInput('rc-z-retreat');

              if (!loadRpmInput || !unloadRpmInput) return;

              // Always update to new collet size defaults
              const newLoadDefault = newColletSize === 'ER16' ? 1600 : 1200;
              const newUnloadDefault = newColletSize === 'ER16' ? 2000 : 1500;
              const newSpindleAtSpeedDefault = newColletSize === 'ER16' ? true : false;
              const newZRetreatDefault = newColletSize === 'ER16' ? 17 : 7;

              loadRpmInput.value = String(newLoadDefault);
              unloadRpmInput.value = String(newUnloadDefault);
              if (spindleAtSpeedCheck) {
                spindleAtSpeedCheck.checked = newSpindleAtSpeedDefault;
              }
              if (zRetreatInput) {
                zRetreatInput.value = String(newZRetreatDefault);
              }
            });
          }
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
