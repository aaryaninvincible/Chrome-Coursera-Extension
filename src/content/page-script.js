/**
 * Main World Page Injection Script
 * Course Completion Assistant - Always Active Window Engine
 *
 * Runs directly in the target webpage execution context to neutralize
 * visibility detection, window blur, idle pauses, and throttled animation loops.
 */

(() => {
  // Communication port bridge element with isolated content script
  let bridge = document.getElementById('cca-bridge-port');
  if (!bridge) {
    bridge = document.createElement('span');
    bridge.id = 'cca-bridge-port';
    bridge.style.display = 'none';
    (document.head || document.documentElement).appendChild(bridge);
  }

  const isEnabled = () => bridge.dataset.enabled !== 'false';
  const isVisibilitySpoofing = () => isEnabled() && bridge.dataset.spoofVisibility !== 'false';
  const isBlurPrevention = () => isEnabled() && bridge.dataset.preventWindowBlur !== 'false';
  const isRenderLoopActive = () => isEnabled() && bridge.dataset.keepRenderLoop !== 'false';

  const stopEvent = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  // 1. Override document.visibilityState and document.hidden
  try {
    Object.defineProperty(document, 'visibilityState', {
      get() {
        return isVisibilitySpoofing() ? 'visible' : 'hidden';
      },
      configurable: true
    });

    Object.defineProperty(document, 'webkitVisibilityState', {
      get() {
        return isVisibilitySpoofing() ? 'visible' : 'hidden';
      },
      configurable: true
    });

    Object.defineProperty(document, 'hidden', {
      get() {
        return isVisibilitySpoofing() ? false : true;
      },
      configurable: true
    });

    Object.defineProperty(document, 'webkitHidden', {
      get() {
        return isVisibilitySpoofing() ? false : true;
      },
      configurable: true
    });
  } catch (err) {
    // Some platforms freeze these properties
  }

  // 2. Intercept and block visibility change events
  const onVisibilityChange = (e) => {
    if (isVisibilitySpoofing()) {
      stopEvent(e);
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange, true);
  document.addEventListener('webkitvisibilitychange', onVisibilityChange, true);
  window.addEventListener('pagehide', onVisibilityChange, true);
  window.addEventListener('lostpointercapture', (e) => {
    if (isVisibilitySpoofing()) stopEvent(e);
  }, true);

  // 3. Override Document.prototype.hasFocus to report persistent focus
  try {
    const origHasFocus = Document.prototype.hasFocus;
    Document.prototype.hasFocus = new Proxy(origHasFocus, {
      apply(target, thisArg, args) {
        if (isBlurPrevention()) {
          return true;
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  } catch (err) {}

  // 4. Block window and document blur / leave events
  const onBlur = (e) => {
    if (isBlurPrevention() && (e.target === document || e.target === window)) {
      stopEvent(e);
    }
  };

  window.addEventListener('blur', onBlur, true);
  document.addEventListener('blur', onBlur, true);
  window.addEventListener('mouseleave', (e) => {
    if (isBlurPrevention() && (e.target === document || e.target === window)) {
      stopEvent(e);
    }
  }, true);
  window.addEventListener('mouseout', (e) => {
    if (isBlurPrevention() && (e.target === document.documentElement || e.target === document.body)) {
      stopEvent(e);
    }
  }, true);

  // 5. Keep window.requestAnimationFrame progressing in background tabs
  let lastTime = 0;
  const originalRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = new Proxy(originalRAF, {
    apply(target, thisArg, args) {
      if (isRenderLoopActive() && document.hidden) {
        const currTime = Date.now();
        const timeToCall = Math.max(0, 16 - (currTime - lastTime));
        const id = setTimeout(() => {
          args[0](performance.now());
        }, timeToCall);
        lastTime = currTime + timeToCall;
        return id;
      }
      return Reflect.apply(target, thisArg, args);
    }
  });

  const originalCAF = window.cancelAnimationFrame;
  window.cancelAnimationFrame = new Proxy(originalCAF, {
    apply(target, thisArg, args) {
      if (isRenderLoopActive() && document.hidden) {
        clearTimeout(args[0]);
      }
      return Reflect.apply(target, thisArg, args);
    }
  });

  // 6. Neutralize common inspect & debugger anti-tamper loops
  try {
    const origFunction = window.Function;
    window.Function = new Proxy(origFunction, {
      apply(target, thisArg, args) {
        if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('debugger')) {
          return () => {};
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  } catch (err) {}
})();
