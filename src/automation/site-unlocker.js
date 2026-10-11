/**
 * Site Unlocker Module
 * Restores user control, accessibility, text selection, copy/paste, and developer shortcuts.
 */

import { Logger } from '../utils/logger.js';

class SiteUnlocker {
  constructor() {
    this.styleElement = null;
    this.isUnlocked = false;
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleCopy = this.handleCopy.bind(this);
    this.handleSelectStart = this.handleSelectStart.bind(this);
  }

  /**
   * Apply unlocking based on current settings
   */
  apply(options = {}) {
    this.cleanUp();
    this.isUnlocked = true;

    // 1. Inject CSS to override user-select and cursor restrictions
    if (options.enableTextSelection !== false) {
      this.injectUnlockStyles();
    }

    // 2. Intercept and bypass event listeners
    if (options.enableRightClick !== false) {
      window.addEventListener('contextmenu', this.handleContextMenu, true);
    }

    if (options.enableCopy !== false) {
      window.addEventListener('copy', this.handleCopy, true);
      window.addEventListener('cut', this.handleCopy, true);
      window.addEventListener('selectstart', this.handleSelectStart, true);
    }

    if (options.enableShortcuts !== false || options.enableDevAccess !== false) {
      window.addEventListener('keydown', this.handleKeydown, true);
    }

    Logger.info('Site Unlocker applied accessibility rules.');
  }

  /**
   * Inject overriding CSS rule
   */
  injectUnlockStyles() {
    if (this.styleElement) return;

    this.styleElement = document.createElement('style');
    this.styleElement.id = 'cca-unlock-styles';
    this.styleElement.textContent = `
      *, *::before, *::after {
        -webkit-user-select: auto !important;
        -moz-user-select: auto !important;
        -ms-user-select: auto !important;
        user-select: auto !important;
        -webkit-touch-callout: default !important;
      }
      [unselectable="on"], [onselectstart] {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
    `;

    try {
      (document.head || document.documentElement).appendChild(this.styleElement);
    } catch (e) {
      // Document might still be loading
      document.addEventListener('DOMContentLoaded', () => {
        (document.head || document.documentElement).appendChild(this.styleElement);
      });
    }
  }

  /**
   * Stop event interception on contextmenu
   */
  handleContextMenu(e) {
    e.stopPropagation();
    // Allow default browser context menu
    return true;
  }

  /**
   * Stop event blocking on copy/cut/select
   */
  handleCopy(e) {
    e.stopPropagation();
    return true;
  }

  handleSelectStart(e) {
    e.stopPropagation();
    return true;
  }

  /**
   * Restore shortcuts like Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+F, F12, Ctrl+Shift+I
   */
  handleKeydown(e) {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const key = (e.key || '').toLowerCase();

    // Standard clipboard & search shortcuts
    if (isCtrlOrCmd && ['c', 'v', 'x', 'a', 'f'].includes(key)) {
      e.stopImmediatePropagation();
      return true;
    }

    // Developer access: F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
    if (e.key === 'F12' || (isCtrlOrCmd && e.shiftKey && ['i', 'j', 'c'].includes(key)) || (isCtrlOrCmd && key === 'u')) {
      e.stopImmediatePropagation();
      return true;
    }
  }

  cleanUp() {
    this.isUnlocked = false;
    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
      this.styleElement = null;
    }

    window.removeEventListener('contextmenu', this.handleContextMenu, true);
    window.removeEventListener('copy', this.handleCopy, true);
    window.removeEventListener('cut', this.handleCopy, true);
    window.removeEventListener('selectstart', this.handleSelectStart, true);
    window.removeEventListener('keydown', this.handleKeydown, true);
  }
}

export const siteUnlocker = new SiteUnlocker();
