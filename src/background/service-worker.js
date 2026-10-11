/**
 * Background Service Worker (Manifest V3)
 * Course Completion Assistant
 *
 * Coordinates extension life-cycle, alarms, tab state monitoring,
 * and badge updates across active learning windows.
 */

import { storageManager } from '../storage/storage-manager.js';
import { securityAuditor } from '../security/security-audit.js';
import { Logger } from '../utils/logger.js';

// Extension install / update lifecycle
chrome.runtime.onInstalled.addListener(async (details) => {
  Logger.info('Course Completion Assistant installed/updated:', details.reason);
  await storageManager.init();

  // Set default badge appearance
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
  chrome.action.setBadgeText({ text: 'CCA' });

  // Schedule periodic 1-hour alarm for health checks & metric syncing
  chrome.alarms.create('cca-maintenance-alarm', { periodInMinutes: 60 });
});

// Periodic alarm handler
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cca-maintenance-alarm') {
    Logger.debug('Running maintenance alarm...');
    const settings = await storageManager.getSettings();
    if (settings.activeMode?.enabled) {
      // Update session counter
      await storageManager.updateMetrics(metrics => {
        metrics.activeSessionsCount += 1;
        metrics.lastSessionDate = Date.now();
        return metrics;
      });
    }
  }
});

// Centralized message router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};

  switch (type) {
    case 'GET_STATE': {
      Promise.all([storageManager.getSettings(), storageManager.getMetrics()]).then(([settings, metrics]) => {
        sendResponse({ success: true, settings, metrics });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // Keep channel open for async response
    }

    case 'UPDATE_SETTINGS': {
      storageManager.updateSettings(payload, true).then(updated => {
        // Broadcast change to all tabs
        broadcastToTabs({ type: 'SETTINGS_CHANGED', payload: updated });
        sendResponse({ success: true, settings: updated });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'RECORD_VIDEO_COMPLETION': {
      storageManager.recordVideoCompletion(payload).then(metrics => {
        sendResponse({ success: true, metrics });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'RUN_SECURITY_AUDIT': {
      storageManager.getSettings().then(settings => {
        return securityAuditor.runAudit(settings);
      }).then(report => {
        sendResponse({ success: true, report });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'UPDATE_BADGE': {
      const { text, color } = payload || {};
      if (text !== undefined) chrome.action.setBadgeText({ text });
      if (color) chrome.action.setBadgeBackgroundColor({ color });
      sendResponse({ success: true });
      break;
    }

    default:
      sendResponse({ success: false, error: `Unknown message type: ${type}` });
  }
});

/**
 * Broadcast message to all active tabs
 */
function broadcastToTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have content script loaded
        });
      }
    });
  });
}

// Monitor tab activations to update badge dynamically
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      const settings = await storageManager.getSettings();
      const domain = new URL(tab.url).hostname.replace(/^www\./, '');
      const isWhitelisted = settings.activeMode.whitelistedDomains.some(d => domain.includes(d));

      if (settings.activeMode.enabled && (settings.activeMode.mode === 'all' || isWhitelisted)) {
        chrome.action.setBadgeText({ text: `${settings.mediaEnhancement.defaultPlaybackSpeed}x`, tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9', tabId: tab.id });
      } else {
        chrome.action.setBadgeText({ text: 'OFF', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#64748b', tabId: tab.id });
      }
    }
  } catch {
    // Ignore internal tabs
  }
});
