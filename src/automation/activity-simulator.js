/**
 * Activity Simulator Module
 * Prevents LMS inactivity timeouts and automatically dismisses "Are you still watching?" dialogs.
 */

import { Logger } from '../utils/logger.js';

class ActivitySimulator {
  constructor() {
    this.timer = null;
    this.intervalSeconds = 60;
    this.isActive = false;
  }

  start(intervalSeconds = 60) {
    this.stop();
    this.intervalSeconds = Math.max(15, intervalSeconds);
    this.isActive = true;

    // Initial activity pulse
    this.pulse();

    this.timer = setInterval(() => {
      this.pulse();
    }, this.intervalSeconds * 1000);

    Logger.info(`Activity simulator started (interval: ${this.intervalSeconds}s)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isActive = false;
  }

  /**
   * Dispatch subtle synthetic event to reset idle timers without disrupting user
   */
  pulse() {
    if (!this.isActive) return;

    try {
      // 1. Check and dismiss LMS inactivity dialogs
      this.dismissInactivityPrompts();

      // 2. Dispatch synthetic lightweight pointer event
      const event = new MouseEvent('mousemove', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: Math.floor(Math.random() * 5) + 1,
        clientY: Math.floor(Math.random() * 5) + 1
      });
      document.dispatchEvent(event);

      // 3. Dispatch subtle key event to reset window idle clocks
      const keyEvent = new KeyboardEvent('keydown', {
        key: 'Shift',
        code: 'ShiftLeft',
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(keyEvent);

      Logger.debug('Simulated activity heartbeat dispatched.');
    } catch (err) {
      Logger.debug('Activity simulation caught non-fatal exception:', err);
    }
  }

  /**
   * Heuristics to automatically confirm "Still watching?" or "Session timeout" prompts
   */
  dismissInactivityPrompts() {
    const dialogSelectors = [
      // Coursera "Are you still watching?"
      'button[data-testid="still-watching-yes"]',
      'button:has(span:contains("Yes, I\'m still watching"))',
      // Udemy "Continue watching"
      'button[data-purpose="continue-watching-button"]',
      // Generic inactivity prompts
      'button:is([aria-label*="continue watching" i], [aria-label*="still watching" i])',
      '.inactivity-dialog button.confirm',
      '.idle-modal button.primary'
    ];

    for (const sel of dialogSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          btn.click();
          Logger.info('Automatically dismissed inactivity prompt:', sel);
          return;
        }
      } catch {
        // Ignore selector syntax discrepancies
      }
    }

    // Fallback: search open dialog buttons with affirmative text
    const dialogs = document.querySelectorAll('dialog[open], [role="dialog"], .modal.show');
    dialogs.forEach(dialog => {
      const text = (dialog.textContent || '').toLowerCase();
      if (text.includes('still watching') || text.includes('are you there') || text.includes('inactivity')) {
        const confirmBtn = dialog.querySelector('button');
        if (confirmBtn) {
          confirmBtn.click();
          Logger.info('Clicked confirm on detected idle dialog.');
        }
      }
    });
  }
}

export const activitySimulator = new ActivitySimulator();
