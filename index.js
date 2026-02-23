/**
 * Rapid Change ATC - Node.js Lifecycle Wrapper
 * Thin wrapper for the community (Node.js) version.
 * Imports pure command processing from commands.js and bridges host APIs.
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

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { onBeforeCommand, buildInitialConfig } from './commands.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function fetchTools(ctx) {
  try {
    const pluginSettings = ctx.getSettings() || {};
    const appSettings = ctx.getAppSettings() || {};
    const port = resolveServerPort(pluginSettings, appSettings);
    const response = await fetch(`http://localhost:${port}/api/tools`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    ctx.log('Failed to fetch tools:', error);
  }
  return [];
}

function showSafetyWarningDialog(ctx, title, message, continueLabel, abortEventGcode = '') {
  const abortGcodeLines = abortEventGcode ? abortEventGcode.trim().split('\\n').filter(line => line.trim()) : [];
  const abortGcodeJson = JSON.stringify(abortGcodeLines);
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

        .rcs-action-button {
          padding: 12px 32px;
          border: none;
          border-radius: var(--radius-small);
          font-weight: 600;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s ease;
          min-width: 140px;
        }

        .rcs-action-button:hover {
          opacity: 0.9;
        }

        .rcs-action-button:disabled {
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
      </style>

      <div class="rcs-safety-container">
        <div class="rcs-safety-header">${title}</div>
        <div class="rcs-safety-dialog">
          <div class="rcs-safety-message">${message}</div>
          <div class="rcs-safety-actions">
            <button class="rcs-action-button rcs-button-abort" id="rcs-abort-btn">Abort</button>
            <button class="rcs-action-button rcs-button-continue" id="rcs-continue-btn">${continueLabel}</button>
          </div>
        </div>
      </div>

      <script>
        (function() {
          const abortBtn = document.getElementById('rcs-abort-btn');
          const continueBtn = document.getElementById('rcs-continue-btn');
          const abortGcodeLines = ${abortGcodeJson};

          abortBtn.addEventListener('click', function() {
            if (abortBtn.disabled) return;
            abortBtn.disabled = true;
            continueBtn.disabled = true;

            if (abortGcodeLines.length > 0) {
              abortGcodeLines.forEach(function(line) {
                window.postMessage({
                  type: 'send-command',
                  command: line,
                  displayCommand: line
                }, '*');
              });
            }

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
          });

          continueBtn.addEventListener('click', function() {
            if (continueBtn.disabled) return;
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
          });
        })();
      </script>
    `,
    { closable: false }
  );
}

// === Plugin Lifecycle ===

export async function onLoad(ctx) {
  ctx.log('Rapid Change ATC plugin loaded');

  const pluginSettings = ctx.getSettings() || {};
  const appSettings = ctx.getAppSettings() || {};

  const isConfigured = !!(pluginSettings.pocket1 && pluginSettings.pockets);

  const pocketCount = pluginSettings.pockets || 0;
  const addProbe = pluginSettings.addProbe ?? false;

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
          tls: isConfigured,
          probe: addProbe
        }
      })
    });

    if (response.ok) {
      ctx.log(`Tool settings synchronized: count=${pocketCount}, manual=${isConfigured}, tls=${isConfigured}, probe=${addProbe} (source: com.ncsender.rapidchangeatc)`);
    } else {
      ctx.log(`Failed to sync tool settings: ${response.status}`);
    }
  } catch (error) {
    ctx.log('Failed to sync tool settings on plugin load:', error);
  }

  const MESSAGE_MAP = {
    'PLUGIN_RAPIDCHANGEATC:FAILED_UNLOAD_TOOL': {
      title: 'Unload Failed',
      message: 'Failed to unload the bit. Please manually remove the bit, then click <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel.',
      continueLabel: 'Continue'
    },
    'PLUGIN_RAPIDCHANGEATC:FAILED_LOAD_TOOL': {
      title: 'Load Failed',
      message: 'Failed to load the bit. Please manually install the bit, then click <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel.',
      continueLabel: 'Continue'
    },
    'PLUGIN_RAPIDCHANGEATC:MANUAL_UNLOAD_TOOL': {
      title: 'Manual Unload',
      message: 'Please remove the current bit, then click <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel.',
      continueLabel: 'Continue'
    },
    'PLUGIN_RAPIDCHANGEATC:MANUAL_LOAD_TOOL': {
      title: 'Manual Load',
      message: 'Please install the new bit securely, then click <em>"Continue"</em> to proceed or <em>"Abort"</em> to cancel.',
      continueLabel: 'Continue'
    }
  };

  ctx.registerEventHandler('ws:cnc-data', async (data) => {
    if (typeof data === 'string') {
      const upperData = data.toUpperCase();
      if (upperData.includes('[MSG') && upperData.includes('PLUGIN_RAPIDCHANGEATC:')) {
        for (const [code, config] of Object.entries(MESSAGE_MAP)) {
          if (upperData.includes(code)) {
            const settings = buildInitialConfig(ctx.getSettings() || {});
            showSafetyWarningDialog(ctx, config.title, config.message, config.continueLabel, settings.abortEventGcode);
            break;
          }
        }
      }
    }
  });

  ctx.registerEventHandler('onBeforeCommand', async (commands, context) => {
    const rawSettings = ctx.getSettings() || {};

    if (!rawSettings.pocket1 || !rawSettings.pockets) {
      return commands;
    }

    const settings = buildInitialConfig(rawSettings);

    const tools = await fetchTools(ctx);
    const enrichedContext = { ...context, tools };

    return onBeforeCommand(commands, enrichedContext, settings);
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

    let html = readFileSync(join(__dirname, 'config.html'), 'utf-8');
    html = html.replace('__SERVER_PORT__', String(serverPort));
    html = html.replace('__INITIAL_CONFIG__', initialConfigJson);

    ctx.showDialog('Rapid Change ATC', html, { size: 'large' });
  }, {
    icon: 'logo.png'
  });
}

export async function onUnload(ctx) {
  ctx.log('Rapid Change ATC plugin unloading');

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
          tls: false,
          probe: false
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
