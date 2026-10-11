/**
 * Storage Manager Module
 * Manages persistent extension settings and usage metrics via chrome.storage.local
 */

import { DEFAULT_SETTINGS, DEFAULT_METRICS } from './state-schema.js';

class StorageManager {
  constructor() {
    this.cache = null;
    this.saveTimeout = null;
    this.listeners = new Set();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          this.handleStorageChange(changes);
        }
      });
    }
  }

  /**
   * Initializes storage with defaults if not present
   */
  async init() {
    if (this.cache) return this.cache;

    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get(['settings', 'metrics'], (result) => {
          const settings = this.deepMerge(DEFAULT_SETTINGS, result.settings || {});
          const metrics = this.deepMerge(DEFAULT_METRICS, result.metrics || {});
          this.cache = { settings, metrics };

          // Save back merged defaults if any new keys were added
          chrome.storage.local.set(this.cache, () => {
            resolve(this.cache);
          });
        });
      } else {
        // Fallback for standalone preview / testing
        let localSettings = null;
        let localMetrics = null;
        try {
          localSettings = JSON.parse(localStorage.getItem('cca_settings') || 'null');
          localMetrics = JSON.parse(localStorage.getItem('cca_metrics') || 'null');
        } catch {}
        const settings = this.deepMerge(DEFAULT_SETTINGS, localSettings || {});
        const metrics = this.deepMerge(DEFAULT_METRICS, localMetrics || {});
        this.cache = { settings, metrics };
        resolve(this.cache);
      }
    });
  }

  /**
   * Deeply merges source object into target defaults
   */
  deepMerge(target, source) {
    const output = { ...target };
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key]) && key in target) {
          output[key] = this.deepMerge(target[key], source[key]);
        } else {
          output[key] = source[key];
        }
      });
    }
    return output;
  }

  isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }

  /**
   * Get all settings or a sub-section
   */
  async getSettings(section = null) {
    await this.init();
    if (section && this.cache.settings[section]) {
      return JSON.parse(JSON.stringify(this.cache.settings[section]));
    }
    return JSON.parse(JSON.stringify(this.cache.settings));
  }

  /**
   * Update settings with debounced write
   */
  async updateSettings(newSettings, immediate = false) {
    await this.init();
    this.cache.settings = this.deepMerge(this.cache.settings, newSettings);

    return new Promise((resolve) => {
      const commit = () => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.set({ settings: this.cache.settings }, () => {
            this.notifyListeners('settings', this.cache.settings);
            resolve(this.cache.settings);
          });
        } else {
          try { localStorage.setItem('cca_settings', JSON.stringify(this.cache.settings)); } catch {}
          this.notifyListeners('settings', this.cache.settings);
          resolve(this.cache.settings);
        }
      };

      if (immediate) {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        commit();
      } else {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(commit, 200);
      }
    });
  }

  /**
   * Get usage metrics
   */
  async getMetrics() {
    await this.init();
    return JSON.parse(JSON.stringify(this.cache.metrics));
  }

  /**
   * Update metrics (e.g. videos completed, time saved)
   */
  async updateMetrics(modifierFn) {
    await this.init();
    const current = JSON.parse(JSON.stringify(this.cache.metrics));
    const updated = modifierFn(current) || current;
    this.cache.metrics = updated;

    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.set({ metrics: this.cache.metrics }, () => {
          this.notifyListeners('metrics', this.cache.metrics);
          resolve(this.cache.metrics);
        });
      } else {
        try { localStorage.setItem('cca_metrics', JSON.stringify(this.cache.metrics)); } catch {}
        this.notifyListeners('metrics', this.cache.metrics);
        resolve(this.cache.metrics);
      }
    });
  }

  /**
   * Record video completion and computed time saved
   */
  async recordVideoCompletion({ durationSeconds = 0, speed = 1, courseTitle = '', videoTitle = '', domain = '' }) {
    return this.updateMetrics(metrics => {
      metrics.watchedVideosCount += 1;
      
      // Calculate saved time if playback was faster than 1x
      if (speed > 1 && durationSeconds > 0) {
        const standardTime = durationSeconds;
        const actualTime = durationSeconds / speed;
        const timeSaved = Math.max(0, standardTime - actualTime);
        metrics.totalTimeSavedSeconds += Math.round(timeSaved);
      }

      // Add to recent activity log
      if (courseTitle || videoTitle) {
        const existingIdx = metrics.recentCourses.findIndex(c => c.title === courseTitle);
        const item = {
          id: `${domain}_${Date.now()}`,
          title: courseTitle || videoTitle || 'Learning Session',
          domain: domain || 'web',
          lastSeen: Date.now(),
          playbackSpeed: speed
        };

        if (existingIdx >= 0) {
          metrics.recentCourses[existingIdx] = { ...metrics.recentCourses[existingIdx], ...item };
        } else {
          metrics.recentCourses.unshift(item);
          if (metrics.recentCourses.length > 20) {
            metrics.recentCourses.pop();
          }
        }
      }

      return metrics;
    });
  }

  /**
   * Listen for changes to local storage
   */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notifyListeners(key, data) {
    this.listeners.forEach(fn => {
      try {
        fn(key, data);
      } catch (err) {
        console.error('[StorageManager] Listener error:', err);
      }
    });
  }

  handleStorageChange(changes) {
    if (changes.settings) {
      if (this.cache) this.cache.settings = changes.settings.newValue;
      this.notifyListeners('settings', changes.settings.newValue);
    }
    if (changes.metrics) {
      if (this.cache) this.cache.metrics = changes.metrics.newValue;
      this.notifyListeners('metrics', changes.metrics.newValue);
    }
  }
}

export const storageManager = new StorageManager();
