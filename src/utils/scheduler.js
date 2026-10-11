/**
 * Scheduler Utility for Interaction to Next Paint (INP) Optimization
 * Course Completion Assistant
 *
 * Prevents long tasks (>50ms) by yielding to the main thread
 * and utilizing requestIdleCallback for non-critical background jobs.
 */

export const Scheduler = {
  /**
   * Yield to the browser to allow rendering and input handling
   * Utilizes scheduler.yield() when available, falling back to MessageChannel
   */
  async yieldToMain() {
    if ('scheduler' in window && typeof window.scheduler.yield === 'function') {
      return window.scheduler.yield();
    }
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
  },

  /**
   * Execute non-critical tasks during idle periods
   */
  runWhenIdle(callback, timeout = 2000) {
    if ('requestIdleCallback' in window) {
      return window.requestIdleCallback(callback, { timeout });
    }
    return setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 100);
  },

  /**
   * Cancel an idle callback
   */
  cancelIdle(id) {
    if ('cancelIdleCallback' in window) {
      window.cancelIdleCallback(id);
    } else {
      clearTimeout(id);
    }
  },

  /**
   * Process an array in chunks without blocking the UI
   */
  async chunkedProcess(items, processItemFn, maxChunkMs = 12) {
    let start = performance.now();
    for (let i = 0; i < items.length; i++) {
      processItemFn(items[i], i);
      if (performance.now() - start > maxChunkMs) {
        await this.yieldToMain();
        start = performance.now();
      }
    }
  }
};
