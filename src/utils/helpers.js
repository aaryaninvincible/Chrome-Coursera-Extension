/**
 * Shared Helper Utilities
 * Course Completion Assistant
 */

export const Helpers = {
  /**
   * Format seconds to human-readable string (e.g. "3 hrs 12 mins" or "45 mins")
   */
  formatDuration(totalSeconds) {
    if (!totalSeconds || isNaN(totalSeconds)) return '0 min';
    
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);

    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  },

  /**
   * Format timestamp to date string
   */
  formatDate(timestamp) {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  /**
   * Extract clean domain name from URL
   */
  extractDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  },

  /**
   * Debounce function execution
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Throttle function execution
   */
  throttle(func, limit) {
    let inThrottle;
    return function (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  },

  /**
   * Selectors for Next Button across popular learning platforms
   */
  NEXT_BUTTON_SELECTORS: [
    // Coursera
    'button[data-testid="next-item"]',
    'button[aria-label="Next Item"]',
    'button[aria-label="Next item"]',
    'button[aria-label="Next"]',
    '.c-next-button',
    'button:has(span:contains("Next Item"))',
    // Udemy
    'button[data-purpose="go-to-next-item"]',
    'button[data-purpose="next-lecture-button"]',
    // edX
    '.sequence-nav-button.next',
    'button.next-btn',
    // Canvas / Instructure
    'a.module-sequence-footer-button--next',
    // Generic LMS & video players
    '[aria-label*="next lesson" i]',
    '[aria-label*="next lecture" i]',
    '[aria-label*="next video" i]',
    '[data-testid*="next" i]',
    '.vjs-next-button',
    '.ytp-next-button'
  ],

  /**
   * Find next button on page using heuristics
   */
  findNextLessonButton() {
    for (const selector of this.NEXT_BUTTON_SELECTORS) {
      try {
        const btn = document.querySelector(selector);
        if (btn && btn.offsetParent !== null && !btn.disabled) {
          return btn;
        }
      } catch {
        // Continue if selector is unsupported in current engine
      }
    }

    // Fallback: search for buttons containing "Next"
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'));
    const nextBtn = buttons.find(b => {
      const text = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return (
        (text.includes('next') || aria.includes('next')) &&
        !text.includes('previous') &&
        b.offsetParent !== null &&
        !b.hasAttribute('disabled')
      );
    });

    return nextBtn || null;
  },

  /**
   * Query element across both regular DOM and Open Shadow Roots
   */
  deepQuerySelector(selector, root = document) {
    const el = root.querySelector(selector);
    if (el) return el;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        const nested = this.deepQuerySelector(selector, node.shadowRoot);
        if (nested) return nested;
      }
    }
    return null;
  },

  /**
   * Query all elements including inside shadow roots
   */
  deepQuerySelectorAll(selector, root = document) {
    let results = Array.from(root.querySelectorAll(selector));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        results = results.concat(this.deepQuerySelectorAll(selector, node.shadowRoot));
      }
    }
    return results;
  }
};
