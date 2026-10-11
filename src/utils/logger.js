/**
 * Structured Logger
 * Course Completion Assistant
 */

const PREFIX = '[CCA]';

export const Logger = {
  debug(...args) {
    if (typeof CCA_DEBUG !== 'undefined' && CCA_DEBUG) {
      console.debug(PREFIX, ...args);
    }
  },

  info(...args) {
    console.info(PREFIX, ...args);
  },

  warn(...args) {
    console.warn(PREFIX, ...args);
  },

  error(...args) {
    console.error(PREFIX, ...args);
  }
};
