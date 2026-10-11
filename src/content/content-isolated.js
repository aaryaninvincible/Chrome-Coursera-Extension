/**
 * Isolated Content Script (Manifest V3)
 * Course Completion Assistant
 *
 * Injects Main World script, manages lifecycle of automation controllers,
 * and handles bi-directional messaging with the extension service worker.
 */

import { wakeLockController } from '../automation/wake-lock.js';
import { activitySimulator } from '../automation/activity-simulator.js';
import { mediaController } from '../automation/media-controller.js';
import { siteUnlocker } from '../automation/site-unlocker.js';
import { courseFlow } from '../automation/course-flow.js';
import { quizAssistant } from '../automation/quiz-assistant.js';
import { Helpers } from '../utils/helpers.js';
import { Logger } from '../utils/logger.js';

class ContentOrchestrator {
  constructor() {
    this.settings = null;
    this.currentDomain = window.location.hostname.replace(/^www\./, '');
  }

  async init() {
    // 1. Inject Main World page script as early as possible
    this.injectMainWorldScript();

    // 2. Fetch current settings from service worker
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        Logger.debug('Failed to get initial state, using local defaults.');
        return;
      }

      this.settings = response.settings;
      this.applySettings();
    });

    // 3. Listen for live settings updates from popup / dashboard
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'SETTINGS_CHANGED' && message.payload) {
        this.settings = message.payload;
        this.applySettings();
      }
    });
  }

  /**
   * Inject page-script.js into the webpage's MAIN world
   */
  injectMainWorldScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('src/content/page-script.js');
      script.async = false;
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
    } catch (err) {
      Logger.debug('Script injection caught error:', err);
    }
  }

  /**
   * Check if current domain is active according to whitelist and mode
   */
  isDomainActive() {
    if (!this.settings?.activeMode?.enabled) return false;
    if (this.settings.activeMode.mode === 'all') return true;

    const whitelist = this.settings.activeMode.whitelistedDomains || [];
    return whitelist.some(d => this.currentDomain.includes(d));
  }

  /**
   * Apply all modules according to current configuration
   */
  applySettings() {
    if (!this.settings) return;

    const isActive = this.isDomainActive();
    this.updateBridge(isActive);

    // 1. Window Persistence & Wake Lock
    if (isActive && this.settings.activeMode.screenWakeLock) {
      wakeLockController.start();
    } else {
      wakeLockController.stop();
    }

    // 2. Activity Simulation (Inactivity / Idle bypass)
    if (isActive) {
      activitySimulator.start(this.settings.activeMode.intervalSeconds || 60);
    } else {
      activitySimulator.stop();
    }

    // 3. Media Enhancements (Playback speed, auto-play, auto-next)
    if (this.settings.mediaEnhancement?.enabled) {
      mediaController.start(this.settings.mediaEnhancement, (completionData) => {
        // Report completion to background for metrics logging
        chrome.runtime.sendMessage({
          type: 'RECORD_VIDEO_COMPLETION',
          payload: completionData
        });
      });
    } else {
      mediaController.destroy();
    }

    // 4. Site Unlocker (Right-click, copy, text selection)
    if (this.settings.siteUnlocker?.enabled) {
      siteUnlocker.apply(this.settings.siteUnlocker);
    } else {
      siteUnlocker.cleanUp();
    }

    // 5. Course Flow Automation (Start button overlay, reading auto-completion, video autoplay)
    if (this.settings.courseFlow?.enabled !== false && isActive) {
      courseFlow.start(this.settings.courseFlow);
    } else {
      courseFlow.stop();
    }

    // 6. Quiz Assistant (Floating side answers & auto-selection)
    if (this.settings.quizAssistant?.enabled !== false && isActive) {
      quizAssistant.start(this.settings.quizAssistant);
    } else {
      quizAssistant.stop();
    }

    Logger.info(`CCA applied settings for ${this.currentDomain} (active: ${isActive})`);
  }

  /**
   * Update bridge communication element for main world script
   */
  updateBridge(isActive) {
    let bridge = document.getElementById('cca-bridge-port');
    if (!bridge) {
      bridge = document.createElement('span');
      bridge.id = 'cca-bridge-port';
      bridge.style.display = 'none';
      (document.head || document.documentElement).appendChild(bridge);
    }

    const am = this.settings?.activeMode || {};
    bridge.dataset.enabled = isActive ? 'true' : 'false';
    bridge.dataset.spoofVisibility = am.spoofVisibility !== false ? 'true' : 'false';
    bridge.dataset.preventWindowBlur = am.preventWindowBlur !== false ? 'true' : 'false';
    bridge.dataset.keepRenderLoop = am.keepRenderLoopActive !== false ? 'true' : 'false';
  }
}

const orchestrator = new ContentOrchestrator();
orchestrator.init();
