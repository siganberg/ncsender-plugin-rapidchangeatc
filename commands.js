/**
 * Rapid Change ATC - Command Processor
 * Pure command processing logic for automatic tool changer support.
 * Runs on Node.js natively OR on .NET via Jint.
 * No import/require/fetch/ctx — pure input→output.
 *
 * Copyright (C) 2024 Francis Marasigan
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

const ALLOWED_COLLET_SIZES = ['ER11', 'ER16', 'ER20', 'ER25', 'ER32'];
const ALLOWED_MODELS = ['Basic', 'Pro', 'Premium'];
const ORIENTATIONS = ['X', 'Y'];
const DIRECTIONS = ['Positive', 'Negative'];
const PROBE_TOOL_NUMBER = 99;

// === M6 Pattern Matching (inlined from gcode-patterns.js) ===

const M6_PATTERN = /(?:^|[^A-Z])M0*6(?:\s*T0*(\d+)|(?=[^0-9T])|$)|(?:^|[^A-Z])T0*(\d+)\s*M0*6(?:[^0-9]|$)/i;

function isGcodeComment(command) {
  const trimmed = command.trim();
  const withoutLineNumber = trimmed.replace(/^N\d+\s*/i, '');
  if (withoutLineNumber.startsWith(';')) {
    return true;
  }
  if (withoutLineNumber.startsWith('(') && withoutLineNumber.endsWith(')')) {
    return true;
  }
  return false;
}

function parseM6Command(command) {
  if (!command || typeof command !== 'string') {
    return null;
  }
  if (isGcodeComment(command)) {
    return null;
  }
  const normalizedCommand = command.trim().toUpperCase();
  const match = normalizedCommand.match(M6_PATTERN);
  if (!match) {
    return null;
  }
  const toolNumberStr = match[1] || match[2];
  const toolNumber = toolNumberStr ? parseInt(toolNumberStr, 10) : null;
  return {
    toolNumber: Number.isFinite(toolNumber) ? toolNumber : null,
    matched: true
  };
}

// === Sanitization / Validation Helpers ===

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
  return 1200;
};

const getDefaultUnloadRpm = (colletSize) => {
  if (colletSize === 'ER16') return 2000;
  return 1500;
};

const getDefaultSpindleAtSpeed = (colletSize) => {
  return true;
};

const getDefaultZRetreat = (colletSize) => {
  if (colletSize === 'ER16') return 17;
  return 7;
};

const buildInitialConfig = (raw = {}) => {
  const colletSize = sanitizeColletSize(raw.colletSize ?? raw.model);

  const loadRpm = raw.loadRpm !== undefined && raw.loadRpm !== null
    ? toFiniteNumber(raw.loadRpm, getDefaultLoadRpm(colletSize))
    : getDefaultLoadRpm(colletSize);
  const unloadRpm = raw.unloadRpm !== undefined && raw.unloadRpm !== null
    ? toFiniteNumber(raw.unloadRpm, getDefaultUnloadRpm(colletSize))
    : getDefaultUnloadRpm(colletSize);
  const spindleAtSpeed = raw.spindleAtSpeed !== undefined && raw.spindleAtSpeed !== null
    ? !!raw.spindleAtSpeed
    : getDefaultSpindleAtSpeed(colletSize);
  const zRetreat = raw.zRetreat !== undefined && raw.zRetreat !== null
    ? toFiniteNumber(raw.zRetreat, getDefaultZRetreat(colletSize))
    : getDefaultZRetreat(colletSize);

  return {
    colletSize,
    pockets: clampPockets(raw.pockets),
    model: sanitizeModel(raw.model ?? raw.trip ?? raw.modelName ?? raw.machineModel),
    orientation: sanitizeOrientation(raw.orientation),
    direction: sanitizeDirection(raw.direction),
    showMacroCommand: raw.showMacroCommand ?? false,
    performTlsAfterHome: raw.performTlsAfterHome ?? false,
    spindleAtSpeed,
    addProbe: raw.addProbe ?? false,
    atcStartDelay: clampAtcStartDelay(raw.atcStartDelay ?? raw.spindleDelay),

    pocket1: sanitizeCoords(raw.pocket1),
    toolSetter: sanitizeCoords(raw.toolSetter),
    manualTool: sanitizeCoords(raw.manualTool),
    pocketDistance: toFiniteNumber(raw.pocketDistance, 45),

    zEngagement: toFiniteNumber(raw.zEngagement, -50),
    zSafe: toFiniteNumber(raw.zSafe, 0),
    zSpinOff: toFiniteNumber(raw.zSpinOff, 23),
    zRetreat,
    zProbeStart: toFiniteNumber(raw.zProbeStart, -20),
    zone1: toFiniteNumber(raw.zone1, -27.0),
    zone2: toFiniteNumber(raw.zone2, -22.0),

    loadRpm,
    unloadRpm,
    engageFeedrate: toFiniteNumber(raw.engageFeedrate, 3500),

    seekDistance: toFiniteNumber(raw.seekDistance, 50),
    seekFeedrate: toFiniteNumber(raw.seekFeedrate, 500),
    toolSensor: raw.toolSensor ?? 'Probe/TLS',

    probeLoadGcode: raw.probeLoadGcode ?? '',
    probeUnloadGcode: raw.probeUnloadGcode ?? '',

    preToolChangeGcode: raw.preToolChangeGcode ?? '',
    postToolChangeGcode: raw.postToolChangeGcode ?? '',
    abortEventGcode: raw.abortEventGcode ?? '',

    tlsAuxOutput: raw.tlsAuxOutput === 'M7' || raw.tlsAuxOutput === 'M8'
      ? raw.tlsAuxOutput
      : toFiniteNumber(raw.tlsAuxOutput, -1)
  };
};

// === Tool Offset Lookup (pure, from pre-fetched array) ===

function getToolOffsets(toolNumber, tools) {
  if (!toolNumber || toolNumber <= 0 || !Array.isArray(tools)) {
    return { x: 0, y: 0, z: 0 };
  }
  const tool = tools.find(t => t.toolNumber === toolNumber);
  if (tool && tool.offsets) {
    return { x: tool.offsets.x || 0, y: tool.offsets.y || 0, z: tool.offsets.z || 0 };
  }
  return { x: 0, y: 0, z: 0 };
}

// === G-code Generation Helpers ===

function getSensorCheckCondition(toolSensor, checkValue, oNumber) {
  const auxMatch = toolSensor.match(/Aux P(\d+)/i);

  if (auxMatch) {
    const portNumber = auxMatch[1];
    if (checkValue === 0) {
      return `M66 P${portNumber} L3 Q0.2\n o${oNumber} IF [#5399 EQ -1]`;
    } else {
      return `M66 P${portNumber} L3 Q0.2\n o${oNumber} IF [#5399 NE -1]`;
    }
  } else if (toolSensor === 'Probe/TLS') {
    if (checkValue === 0) {
      return `o${oNumber} IF [#<_probe_state> EQ 0 AND #<_toolsetter_state> EQ 0]`;
    } else {
      return `o${oNumber} IF [#<_probe_state> EQ 1 OR #<_toolsetter_state> EQ 1]`;
    }
  } else {
    return `o${oNumber} IF [#<${toolSensor}> EQ ${checkValue}]`;
  }
}

function getSensorCheckClose(oNumber) {
  return `o${oNumber} ENDIF`;
}

function formatGCode(gcode) {
  const lines = gcode.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');

  const formatted = [];
  let indentLevel = 0;

  for (const line of lines) {
    const upperLine = line.toUpperCase();
    const isOCode = upperLine.startsWith('O');

    if (isOCode && (
      upperLine.includes('ENDIF') ||
      upperLine.includes('ENDWHILE') ||
      upperLine.includes('ENDREPEAT') ||
      upperLine.includes('ENDSUB') ||
      upperLine.includes('ELSE')
    )) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    const indent = '  '.repeat(indentLevel);
    formatted.push(indent + line);

    if (isOCode && (
      upperLine.includes(' IF ') ||
      upperLine.includes(' WHILE ') ||
      upperLine.includes(' DO ') ||
      upperLine.includes('REPEAT') ||
      upperLine.includes(' SUB')
    )) {
      indentLevel++;
    }

    if (isOCode && upperLine.includes('ELSE') && !upperLine.includes('ELSEIF')) {
      indentLevel++;
    }
  }

  return formatted;
}

// === Routine Generators ===

function createToolLengthSetRoutine(settings, toolOffsets = { x: 0, y: 0, z: 0 }) {
  const tlsX = settings.toolSetter.x + (toolOffsets.x || 0);
  const tlsY = settings.toolSetter.y + (toolOffsets.y || 0);
  const tlsZ = toolOffsets.z || 0;

  const extraZMove = tlsZ !== 0 ? `G91 G0 Z${tlsZ}\n    G90` : '';

  const auxOutput = settings.tlsAuxOutput;
  let auxOn = '';
  let auxOff = '';
  if (auxOutput === 'M7' || auxOutput === 'M8') {
    auxOn = `G4 P0\n    ${auxOutput}\n    G4 P0`;
    auxOff = `G4 P0\n    M9\n    G4 P0`;
  } else if (typeof auxOutput === 'number' && auxOutput >= 0) {
    auxOn = `G4 P0\n    M64 P${auxOutput}\n    G4 P0`;
    auxOff = `G4 P0\n    M65 P${auxOutput}\n    G4 P0`;
  }

  const gcode = `
    G53 G0 Z${settings.zSafe}
    G53 G0 X${tlsX} Y${tlsY}
    G53 G0 Z${settings.zProbeStart}
    ${extraZMove}
    ${auxOn}
    G43.1 Z0
    G38.2 G91 Z-${settings.seekDistance} F${settings.seekFeedrate}
    G4 P0.2
    G38.4 G91 Z5 F75
    G91 G0 Z5
    G90
    ${auxOff}
    #<_ofs_idx> = [#5220 * 20 + 5203]
    #<_cur_wcs_z_ofs> = #[#<_ofs_idx>]
    #<_nc_last_tlo> = [#5063 + #<_cur_wcs_z_ofs>]
    G43.1 Z[#<_nc_last_tlo>]
    (Notify ncSender that toolLengthSet is now set)
    $#=_tool_offset
  `.trim();
  return gcode.split('\n');
}

function createToolLengthSetProgram(settings, toolOffsets = { x: 0, y: 0, z: 0 }) {
  const tlsRoutine = createToolLengthSetRoutine(settings, toolOffsets).join('\n');

  const preToolChangeCmd = settings.preToolChangeGcode?.trim() || '';
  const postToolChangeCmd = settings.postToolChangeGcode?.trim() || '';

  const gcode = `
    (Start of Tool Length Setter)
    ${preToolChangeCmd}
    #<return_units> = [20 + #<_metric>]
    G21
    ${tlsRoutine}
    G53 G0 Z${settings.zSafe}
    G4 P0
    G[#<return_units>]
    ${postToolChangeCmd}
    (End of Tool Length Setter)
  `.trim();

  return formatGCode(gcode);
}

// === Pocket Position Calculation ===

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

// === Tool Change Sub-Routines ===

function createManualToolFallback(settings) {
  return `
    G53 G0 Z${settings.zSafe}
    G53 G0 X${settings.manualTool.x} Y${settings.manualTool.y}
    M0
  `.trim();
}

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

function createToolLoad(settings, tool) {
  const zone1 = settings.zone1;
  const zone2 = settings.zone2;
  const manualFallback = createManualToolFallback(settings);
  const g65p6Before = settings.spindleAtSpeed ? '' : 'G65P6';
  const g65p6After = settings.spindleAtSpeed ? '' : 'G65P6';

  const sensorCheckNotTriggered = getSensorCheckCondition(settings.toolSensor, 0, 300);
  const sensorCheckTriggered = getSensorCheckCondition(settings.toolSensor, 1, 301);
  const sensorCheckClose300 = getSensorCheckClose(300);
  const sensorCheckClose301 = getSensorCheckClose(301);

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
    ${sensorCheckNotTriggered}
      G4 P0
      (MSG, PLUGIN_RAPIDCHANGEATC:FAILED_LOAD_TOOL)
      ${manualFallback}
    o300 ELSE
      G53 G0 Z${zone2}
      G4 P0.2
      ${sensorCheckTriggered}
        G4 P0
        (MSG, PLUGIN_RAPIDCHANGEATC:FAILED_LOAD_TOOL)
        ${manualFallback}
      ${sensorCheckClose301}
    ${sensorCheckClose300}
    M61 Q${tool}
  `.trim();
}

function buildUnloadTool(settings, currentTool, sourcePos) {
  if (currentTool === 0) {
    return '';
  }

  if (currentTool === PROBE_TOOL_NUMBER) {
    const probeUnloadGcode = settings.probeUnloadGcode?.trim() || '';
    if (probeUnloadGcode) {
      return `
        (Unload Probe Tool T${PROBE_TOOL_NUMBER})
        G53 G0 Z${settings.zSafe}
        ${probeUnloadGcode}
        M61 Q0
      `.trim();
    } else {
      return `
        G53 G0 Z${settings.zSafe}
        G4 P0
        (MSG, PLUGIN_RAPIDCHANGEATC:MANUAL_UNLOAD_PROBE)
        ${createManualToolFallback(settings)}
        M61 Q0
      `.trim();
    }
  }

  if (currentTool > settings.pockets) {
    return `
      G53 G0 Z${settings.zSafe}
      G4 P0
      (MSG, PLUGIN_RAPIDCHANGEATC:MANUAL_UNLOAD_TOOL)
      ${createManualToolFallback(settings)}
      M61 Q0
    `.trim();
  } else {
    const sensorCheckTriggered100 = getSensorCheckCondition(settings.toolSensor, 1, 100);
    const sensorCheckTriggered101 = getSensorCheckCondition(settings.toolSensor, 1, 101);
    const sensorCheckClose100 = getSensorCheckClose(100);
    const sensorCheckClose101 = getSensorCheckClose(101);

    return `
      G53 G0 Z${settings.zSafe}
      G53 G0 X${sourcePos.x} Y${sourcePos.y}
      ${createToolUnload(settings)}
      ${sensorCheckTriggered100}
        ${createToolUnload(settings)}
        ${sensorCheckTriggered101}
          G4 P0
          (MSG, PLUGIN_RAPIDCHANGEATC:FAILED_UNLOAD_TOOL)
          ${createManualToolFallback(settings)}
        ${sensorCheckClose101}
      ${sensorCheckClose100}
      M61 Q0
    `.trim();
  }
}

function buildLoadTool(settings, toolNumber, targetPos, tlsRoutine) {
  if (toolNumber === 0) {
    return '';
  }

  if (toolNumber === PROBE_TOOL_NUMBER) {
    const probeLoadGcode = settings.probeLoadGcode?.trim() || '';
    if (probeLoadGcode) {
      return `
        (Load Probe Tool T${PROBE_TOOL_NUMBER})
        G53 G0 Z${settings.zSafe}
        M61 Q${PROBE_TOOL_NUMBER}
        ${probeLoadGcode}
        ${tlsRoutine}
      `.trim();
    } else {
      return `
        G53 G0 Z${settings.zSafe}
        G4 P0
        (MSG, PLUGIN_RAPIDCHANGEATC:MANUAL_LOAD_PROBE)
        ${createManualToolFallback(settings)}
        M61 Q${PROBE_TOOL_NUMBER}
        ${tlsRoutine}
      `.trim();
    }
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
      G4 P0
      (MSG, PLUGIN_RAPIDCHANGEATC:MANUAL_LOAD_TOOL)
      ${createManualToolFallback(settings)}
      M61 Q${toolNumber}
      ${tlsRoutine}
    `.trim();
  }
}

function buildToolChangeProgram(settings, currentTool, toolNumber, toolOffsets = { x: 0, y: 0 }) {
  const sourcePos = calculatePocketPosition(settings, currentTool);
  const targetPos = calculatePocketPosition(settings, toolNumber);
  const tlsRoutine = createToolLengthSetRoutine(settings, toolOffsets).join('\n');

  const atcStartDelaySection = settings.atcStartDelay > 0 ? `G4 P${settings.atcStartDelay}` : '';
  const unloadSection = buildUnloadTool(settings, currentTool, sourcePos);
  const loadSection = buildLoadTool(settings, toolNumber, targetPos, tlsRoutine);

  const preToolChangeCmd = settings.preToolChangeGcode?.trim() || '';
  const postToolChangeCmd = settings.postToolChangeGcode?.trim() || '';

  const gcode = `
    (Start of RapidChangeATC Plugin Sequence)
    ${preToolChangeCmd}
    #<return_units> = [20 + #<_metric>]
    G21
    M5
    ${atcStartDelaySection}
    ${unloadSection}
    ${loadSection}
    G53 G0 Z${settings.zSafe}
    G4 P0
    G[#<return_units>]
    ${postToolChangeCmd}
    (End of RapidChangeATC Plugin Sequence)
  `.trim();

  return formatGCode(gcode);
}

// === Command Handlers (synchronous, no host dependency) ===

function handleTLSCommand(commands, context, settings) {
  const tlsIndex = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$TLS'
  );

  if (tlsIndex === -1) {
    return;
  }

  const currentTool = context.machineState?.tool ?? 0;
  const toolOffsets = getToolOffsets(currentTool, context.tools);

  const tlsCommand = commands[tlsIndex];
  const toolLengthSetProgram = createToolLengthSetProgram(settings, toolOffsets);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = toolLengthSetProgram.map((line, index) => {
    if (index === 0) {
      return {
        command: line,
        displayCommand: showMacroCommand ? null : tlsCommand.command.trim(),
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

  commands.splice(tlsIndex, 1, ...expandedCommands);
}

function handleHomeCommand(commands, context, settings) {
  const homeIndex = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$H'
  );

  if (homeIndex === -1) {
    return;
  }

  if (!settings.performTlsAfterHome) {
    return;
  }

  const currentTool = context.machineState?.tool ?? 0;
  const toolOffsets = getToolOffsets(currentTool, context.tools);

  const homeCommand = commands[homeIndex];
  const tlsRoutine = createToolLengthSetRoutine(settings, toolOffsets).join('\n');

  const preToolChangeCmd = settings.preToolChangeGcode?.trim() || '';
  const postToolChangeCmd = settings.postToolChangeGcode?.trim() || '';

  const gcode = `
    $H
    #<return_units> = [20 + #<_metric>]
    o100 IF [[#<_tool_offset> EQ 0] AND [#<_current_tool> NE 0]]
      ${preToolChangeCmd}
      G21
      ${tlsRoutine}
      G53 G0 Z${settings.zSafe}
      G4 P0
      G53 G0 X0 Y0
      ${postToolChangeCmd}
    o100 ENDIF
    G[#<return_units>]
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

function handlePocket1Command(commands, settings) {
  const pocket1Index = commands.findIndex(cmd =>
    cmd.isOriginal && cmd.command.trim().toUpperCase() === '$POCKET1'
  );

  if (pocket1Index === -1) {
    return;
  }

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

function handleM6Command(commands, context, settings) {
  const m6Index = commands.findIndex(cmd => {
    if (!cmd.isOriginal) return false;
    const parsed = parseM6Command(cmd.command);
    return parsed?.matched && parsed.toolNumber !== null;
  });

  if (m6Index === -1) {
    return;
  }

  const m6Command = commands[m6Index];
  const parsed = parseM6Command(m6Command.command);

  if (!parsed?.matched || parsed.toolNumber === null) {
    return;
  }

  const toolNumber = parsed.toolNumber;
  const currentTool = context.machineState?.tool ?? 0;
  const toolOffsets = getToolOffsets(toolNumber, context.tools);

  const toolChangeProgram = buildToolChangeProgram(settings, currentTool, toolNumber, toolOffsets);
  const showMacroCommand = settings.showMacroCommand ?? false;

  const expandedCommands = toolChangeProgram.map((line, index) => {
    if (index === 0) {
      return {
        command: line,
        displayCommand: showMacroCommand ? null : m6Command.command.trim(),
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

  commands.splice(m6Index, 1, ...expandedCommands);
}

// === Main Entry Point ===

function onBeforeCommand(commands, context, settings) {
  handleHomeCommand(commands, context, settings);
  handleTLSCommand(commands, context, settings);
  handlePocket1Command(commands, settings);
  handleM6Command(commands, context, settings);
  return commands;
}

export { onBeforeCommand, buildInitialConfig };
