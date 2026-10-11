/**
 * Screen Wake Lock API Controller
 * Prevents system sleep, screen dimming, and display lock during active learning sessions.
 */

import { Logger } from '../utils/logger.js';

class WakeLockController {
  constructor() {
    this.wakeLockSentinel = null;
    this.isEnabled = false;
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
  }

  /**
   * Request screen wake lock
   */
  async requestLock() {
    if (!('wakeLock' in navigator)) {
      Logger.debug('Wake Lock API not supported in this browser environment.');
      return false;
    }

    try {
      if (this.wakeLockSentinel !== null && !this.wakeLockSentinel.released) {
        return true;
      }

      this.wakeLockSentinel = await navigator.wakeLock.request('screen');
      this.wakeLockSentinel.addEventListener('release', () => {
        Logger.debug('Screen Wake Lock was released.');
        this.wakeLockSentinel = null;
      });

      Logger.info('Screen Wake Lock acquired successfully.');
      return true;
    } catch (err) {
      Logger.warn(`Failed to acquire Screen Wake Lock: ${err.name} - ${err.message}`);
      return false;
    }
  }

  /**
   * Release active wake lock
   */
  async releaseLock() {
    if (this.wakeLockSentinel !== null) {
      try {
        await this.wakeLockSentinel.release();
      } catch (err) {
        Logger.warn('Error releasing Wake Lock:', err);
      } finally {
        this.wakeLockSentinel = null;
      }
    }
  }

  /**
   * Enable wake lock management with automatic re-acquisition
   */
  start() {
    this.isEnabled = true;
    this.requestLock();

    // Re-acquire lock when page tab becomes visible again
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  /**
   * Stop wake lock management
   */
  stop() {
    this.isEnabled = false;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.releaseLock();
  }

  async handleVisibilityChange() {
    if (this.isEnabled && document.visibilityState === 'visible') {
      await this.requestLock();
    }
  }
}

export const wakeLockController = new WakeLockController();
