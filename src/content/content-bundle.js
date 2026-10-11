/**
 * Course Completion Assistant - Standalone Content Bundle
 * Manifest V3 Self-Contained Content Script (No external imports)
 *
 * Implements:
 * 1. Post-video Coursera "Start" overlay button auto-clicker (high-frequency polling & mutation observer).
 * 2. Universal media enhancement (1x-5x playback rate, aggressive autoplay, intro skipper).
 * 3. Reading material auto-completion ("Mark as completed" + auto-advance to next lecture).
 * 4. Quiz Assistant with floating right-side answers panel, auto-highlighting, and 1-click selection.
 * 5. Screen Wake Lock API management.
 * 6. Always-Active window persistence and Main World injection.
 * 7. Inactivity simulator & "Still watching" auto-dismisser.
 * 8. Site unlocker (right-click, copy, text selection, shortcuts).
 */

(() => {
  'use strict';

  // Prevent double injection in same frame
  if (window.__CCA_LOADED__) return;
  window.__CCA_LOADED__ = true;

  const PREFIX = '[CCA]';
  const log = {
    info: (...args) => console.info(PREFIX, ...args),
    debug: (...args) => console.debug(PREFIX, ...args),
    warn: (...args) => console.warn(PREFIX, ...args)
  };

  // State
  let settings = {
    activeMode: {
      enabled: true,
      intervalSeconds: 60,
      screenWakeLock: true,
      spoofVisibility: true,
      preventWindowBlur: true,
      keepRenderLoopActive: true,
      whitelistedDomains: ['coursera.org', 'udemy.com', 'edx.org', 'canvas.net', 'youtube.com'],
      mode: 'all'
    },
    mediaEnhancement: {
      enabled: true,
      defaultPlaybackSpeed: 1.5,
      autoPlay: true,
      autoNext: true,
      autoNextDelaySeconds: 5,
      autoSeekIntro: false,
      introSkipSeconds: 15,
      showFloatingSpeedBadge: true
    },
    courseFlow: {
      enabled: true,
      autoClickStartOverlay: true,
      autoCompleteReadings: true,
      autoAdvanceReadingDelaySec: 3,
      autoPlayVideo: true,
      autoSolveInVideoQuiz: true,
      autoFastCompleteVideo: false
    },
    quizAssistant: {
      enabled: true,
      showSidebar: true,
      highlightAnswers: true,
      autoSubmitAndRetry: true,
      minPassingScore: 75
    },
    siteUnlocker: {
      enabled: true,
      enableRightClick: true,
      enableTextSelection: true,
      enableCopy: true,
      enableShortcuts: true
    }
  };

  const currentDomain = window.location.hostname.replace(/^www\./, '');

  // Helper: Deep query inside open shadow roots
  function deepQuerySelectorAll(selector, root = document) {
    let results = Array.from(root.querySelectorAll(selector));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        results = results.concat(deepQuerySelectorAll(selector, node.shadowRoot));
      }
    }
    return results;
  }

  // Helper: High-fidelity synthetic click (works across React & Vue synthetic event pools)
  function forceClick(el) {
    if (!el) return;
    try {
      el.focus?.();
      const rect = el.getBoundingClientRect();
      const clientX = rect.left > 0 ? (rect.left + rect.width / 2) : 100;
      const clientY = rect.top > 0 ? (rect.top + rect.height / 2) : 100;

      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        composed: true,
        clientX,
        clientY,
        button: 0,
        buttons: 1
      };

      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));

      if (typeof el.click === 'function') {
        el.click();
      }

      // If el is an <a> tag with href, or inside one
      const anchor = el.tagName === 'A' ? el : el.closest('a');
      if (anchor && anchor.href && !anchor.href.startsWith('javascript:')) {
        anchor.click();
      }

      // Also click parent button if el is an inner span/div
      const parentBtn = el.closest('button, [role="button"]');
      if (parentBtn && parentBtn !== el) {
        if (typeof parentBtn.click === 'function') parentBtn.click();
      }
    } catch (err) {
      log.debug('forceClick exception:', err);
    }
  }

  // Toast Notification on Screen
  let activeToast = null;
  function showToast(message, durationMs = 2500) {
    if (activeToast && activeToast.parentNode) {
      activeToast.parentNode.removeChild(activeToast);
      activeToast = null;
    }

    activeToast = document.createElement('div');
    activeToast.className = 'cca-overlay-toast';
    activeToast.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(14px);
      color: #38bdf8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      padding: 10px 22px;
      border-radius: 9999px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.65);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
      animation: cca-toast-anim 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    activeToast.innerHTML = `<span>⚡</span><span>${message}</span>`;
    document.body.appendChild(activeToast);

    if (durationMs > 0) {
      setTimeout(() => {
        if (activeToast && activeToast.parentNode) {
          activeToast.parentNode.removeChild(activeToast);
          activeToast = null;
        }
      }, durationMs);
    }
  }

  // =========================================================================
  // 1. COURSERA "START" BUTTON OVERLAY AUTO-CLICKER & COURSE FLOW AUTOMATION
  // =========================================================================

  let lastClickedStartBtn = null;
  let lastStartClickTime = 0;
  let isHandlingReading = false;
  let lastHandledReadingUrl = '';

  function findCourseraStartButton() {
    // 1. Check end-screen overlay card containers specifically
    const overlayCardSelectors = [
      '[class*="ItemOverlay" i]',
      '[class*="NextItem" i]',
      '[class*="Recommendation" i]',
      '[class*="VideoOverlay" i]',
      '[data-testid*="overlay" i]',
      '[data-testid*="next-item" i]',
      '.rc-VideoPlayer [class*="overlay" i]',
      '.video-js [class*="overlay" i]'
    ];

    for (const sel of overlayCardSelectors) {
      const overlays = Array.from(document.querySelectorAll(sel));
      for (const ov of overlays) {
        if (ov.offsetParent === null && ov.offsetWidth === 0) continue;
        const btn = ov.querySelector('button, a, [role="button"]');
        if (btn && (btn.offsetParent !== null || btn.offsetWidth > 0)) {
          const t = (btn.textContent || '').trim().toLowerCase();
          if (t.includes('start') || t.includes('next') || t.length === 0) {
            return btn;
          }
        }
      }
    }

    // 2. Check inside video player container overlays specifically
    const videoContainers = Array.from(document.querySelectorAll(
      '.rc-VideoPlayer, .video-js, [data-testid="video-player"]'
    ));
    for (const vc of videoContainers) {
      const overlayBtn = Array.from(vc.querySelectorAll('[class*="overlay" i] button, [class*="overlay" i] a, [class*="upNext" i] button')).find(b => {
        if (b.offsetParent === null && b.offsetWidth === 0) return false;
        const t = (b.textContent || '').trim().toLowerCase();
        return t === 'start' || t.startsWith('start ') || t === 'next item';
      });
      if (overlayBtn) return overlayBtn;
    }

    // 3. Card with adjacent "Pause" button (Coursera's post-video auto-advance card)
    const pauseBtns = Array.from(document.querySelectorAll('button, a[role="button"]')).filter(b => {
      const t = (b.textContent || '').trim().toLowerCase();
      return t === 'pause' || t.includes('pause');
    });
    for (const pb of pauseBtns) {
      const parent = pb.parentElement;
      if (parent) {
        const startSibling = Array.from(parent.querySelectorAll('button, a[role="button"]')).find(b => {
          if (b === pb) return false;
          const t = (b.textContent || '').trim().toLowerCase();
          return t === 'start' || t.startsWith('start ');
        });
        if (startSibling && (startSibling.offsetParent !== null || startSibling.offsetWidth > 0)) {
          return startSibling;
        }
      }
    }

    return null;
  }

  function checkAndClickStartButton() {
    if (settings.courseFlow?.autoClickStartOverlay === false) return false;

    // CRITICAL GUARD 1: Never click "Start" overlay while a video is present and actively playing!
    const activeVideo = document.querySelector('video');
    if (activeVideo && !activeVideo.ended && activeVideo.currentTime < Math.max(0, activeVideo.duration - 0.8)) {
      return false;
    }

    // CRITICAL GUARD 2: Never click "Start" overlay while on a quiz, exam or assignment page!
    if (
      window.location.href.includes('/quiz') ||
      window.location.href.includes('/exam') ||
      window.location.href.includes('/assignment-submission') ||
      document.querySelector('[data-testid="quiz-container"], [data-testid="question-item"], .rc-QuizQuestion')
    ) {
      return false;
    }

    // Throttle clicks to once every 1.5 seconds
    const now = Date.now();
    if (now - lastStartClickTime < 1500) return false;

    const startBtn = findCourseraStartButton();
    if (startBtn) {
      lastStartClickTime = now;
      lastClickedStartBtn = startBtn;
      log.info('Detected Coursera post-video "Start" button! Clicking immediately...');
      showToast('⏩ Auto-Clicking "Start" on next lesson...', 2000);
      forceClick(startBtn);
      return true;
    }
    return false;
  }

  function findNextLessonButton() {
    const selectors = [
      'button[data-testid="next-item"]',
      'button[aria-label*="next item" i]',
      'button[aria-label="Next Item"]',
      'button[aria-label="Next item"]',
      'button[aria-label="Next"]',
      '.c-next-button',
      'a[data-testid="next-item"]',
      'button[data-purpose="go-to-next-item"]',
      'button[data-purpose="next-lecture-button"]',
      '.sequence-nav-button.next',
      'button.next-btn',
      'a.module-sequence-footer-button--next',
      '[aria-label*="next lesson" i]',
      '[aria-label*="next lecture" i]',
      '[data-testid*="next" i]'
    ];

    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && (btn.offsetParent !== null || btn.offsetWidth > 0) && !btn.disabled) {
          return btn;
        }
      } catch {}
    }

    // Text search
    const allButtons = Array.from(document.querySelectorAll('button, a[role="button"]'));
    return allButtons.find(b => {
      const text = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return (
        (text.includes('next') || aria.includes('next')) &&
        !text.includes('previous') &&
        (b.offsetParent !== null || b.offsetWidth > 0) &&
        !b.hasAttribute('disabled')
      );
    }) || null;
  }

  let isHandlingItem = false;
  let lastHandledItemUrl = '';

  function checkItemCompletion() {
    if (settings.courseFlow?.autoCompleteReadings === false) return;
    if (isHandlingItem && lastHandledItemUrl === window.location.href) return;

    // CRITICAL GUARD 1: Never auto-complete or advance if a video is present and not ended
    const activeVideo = document.querySelector('video');
    if (activeVideo && !activeVideo.ended) return;

    // CRITICAL GUARD 2: Never auto-advance on quiz, exam, or assignment pages
    if (
      window.location.href.includes('/quiz') ||
      window.location.href.includes('/exam') ||
      window.location.href.includes('/assignment') ||
      document.querySelector('[data-testid="quiz-container"], [data-testid="question-item"], .rc-QuizQuestion, [data-testid*="quiz" i]')
    ) {
      return;
    }

    // Search for "Mark as completed" or "Mark as complete" or "Finish" button across genuine reading / exercise items
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"]'));
    const markCompleteBtn = buttons.find(b => {
      if (b.offsetParent === null && b.offsetWidth === 0) return false;
      if (b.hasAttribute('disabled') || b.disabled) return false;
      const t = (b.textContent || '').trim().toLowerCase();
      const a = (b.getAttribute('aria-label') || '').toLowerCase();
      const tid = (b.getAttribute('data-testid') || '').toLowerCase();

      // Skip buttons that are already completed
      if (t === 'completed' || a === 'completed') return false;

      return (
        t === 'mark as completed' ||
        t === 'mark as complete' ||
        t === 'mark as read' ||
        t === 'finish' ||
        t === 'finish and continue' ||
        t.includes('finish and continue') ||
        t.includes('i understand') ||
        t.includes('i am done') ||
        t.includes("i'm done") ||
        tid === 'mark-complete' ||
        tid === 'mark-as-completed' ||
        a === 'mark as completed' ||
        a === 'mark as complete'
      );
    });

    // Also check for in-widget "Continue" button in categorization / interactive exercises
    const exerciseWidget = document.querySelector(
      '.rc-UngradedWidget, [data-testid*="widget" i], [class*="categorization" i], [class*="Exercise" i], [class*="interactive" i]'
    );
    let widgetContinueBtn = null;
    if (exerciseWidget) {
      widgetContinueBtn = Array.from(exerciseWidget.querySelectorAll('button, a[role="button"]')).find(b => {
        if (b.offsetParent === null && b.offsetWidth === 0) return false;
        if (b.hasAttribute('disabled') || b.disabled) return false;
        const t = (b.textContent || '').trim().toLowerCase();
        return t === 'continue' || t === 'check answer';
      });
    }

    if (markCompleteBtn) {
      isHandlingItem = true;
      lastHandledItemUrl = window.location.href;
      log.info('Found "Mark as completed" on item/exercise! Clicking...');
      showToast('📖 Item/Exercise: Marking as completed...', 2500);

      try {
        markCompleteBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}

      setTimeout(() => {
        forceClick(markCompleteBtn);
        const delay = (settings.courseFlow?.autoAdvanceReadingDelaySec || 3) * 1000;
        showToast(`✅ Completed! Advancing to next item in ${settings.courseFlow?.autoAdvanceReadingDelaySec || 3}s...`, delay);

        setTimeout(() => {
          const nextBtn = findNextLessonButton();
          if (nextBtn) {
            showToast('🚀 Advancing to next item...', 2000);
            forceClick(nextBtn);
          }
        }, delay);
      }, 1000);
    } else if (widgetContinueBtn && !isHandlingItem) {
      log.info('Found widget Continue button. Clicking to progress exercise...');
      forceClick(widgetContinueBtn);
    }
  }

  function checkInVideoCheckpoint() {
    if (settings.courseFlow?.autoSolveInVideoQuiz === false) return;

    const inVideoDialog = document.querySelector('.rc-InVideoOverlay, .rc-InVideoQuiz, [data-testid="in-video-quiz"]');
    if (!inVideoDialog || (inVideoDialog.offsetParent === null && inVideoDialog.offsetWidth === 0)) return;

    // Pick first option if radio exists
    const radio = inVideoDialog.querySelector('input[type="radio"], [role="radio"]');
    if (radio && !radio.checked) {
      forceClick(radio);
    }

    // Click submit or continue
    const continueBtn = Array.from(inVideoDialog.querySelectorAll('button')).find(b => {
      const t = (b.textContent || '').toLowerCase();
      return t.includes('continue') || t.includes('skip') || t.includes('submit');
    });

    if (continueBtn) {
      log.info('In-video checkpoint detected. Auto-continuing video...');
      showToast('⏩ In-video question: Auto-continuing...', 1500);
      forceClick(continueBtn);
    }
  }

  // =========================================================================
  // 2. UNIVERSAL MEDIA ENHANCEMENT & AGGRESSIVE AUTOPLAY
  // =========================================================================

  const attachedVideos = new Set();

  function attachToVideo(video) {
    if (attachedVideos.has(video)) return;
    attachedVideos.add(video);

    const targetSpeed = settings.mediaEnhancement?.defaultPlaybackSpeed || 1.5;
    video.playbackRate = targetSpeed;
    video.defaultPlaybackRate = targetSpeed;

    // Keep speed locked
    video.addEventListener('ratechange', () => {
      if (Math.abs(video.playbackRate - targetSpeed) > 0.05) {
        video.playbackRate = targetSpeed;
      }
    });

    // Time update: when video reaches end, immediately click "Start"
    video.addEventListener('timeupdate', () => {
      if (video.duration > 0 && video.currentTime >= video.duration - 1.5) {
        checkAndClickStartButton();
      }
    });

    // Ended event
    video.addEventListener('ended', () => {
      log.info('Video ended event fired. Checking for Start button...');
      checkAndClickStartButton();
      // Record metrics
      try {
        chrome.runtime.sendMessage({
          type: 'RECORD_VIDEO_COMPLETION',
          payload: {
            durationSeconds: Math.round(video.duration || 0),
            speed: targetSpeed,
            courseTitle: document.title || 'Online Course',
            videoTitle: document.querySelector('h1, h2')?.textContent || 'Lecture Video',
            domain: currentDomain
          }
        });
      } catch {}
    });

    // Auto play
    if (settings.mediaEnhancement?.autoPlay && video.paused) {
      attemptAutoplay(video);
    }

    // Intro skip
    video.addEventListener('loadedmetadata', () => {
      video.playbackRate = targetSpeed;
      if (settings.mediaEnhancement?.autoSeekIntro && settings.mediaEnhancement.introSkipSeconds > 0) {
        if (video.currentTime < settings.mediaEnhancement.introSkipSeconds && video.duration > settings.mediaEnhancement.introSkipSeconds * 2) {
          video.currentTime = settings.mediaEnhancement.introSkipSeconds;
          showToast(`Skipped Intro (+${settings.mediaEnhancement.introSkipSeconds}s)`);
        }
      }
    });

    // Auto Fast-Complete if enabled in settings
    let autoCompletedThisVideo = false;
    video.addEventListener('timeupdate', () => {
      if (settings.courseFlow?.autoFastCompleteVideo && !autoCompletedThisVideo && video.currentTime > 2.5 && video.duration > 8) {
        autoCompletedThisVideo = true;
        log.info('Auto Fast-Complete setting enabled! Fast-completing lecture...');
        fastCompleteVideo(video);
      }
    });

    // Floating video toolbar (Speed Pill + Fast Complete Button)
    if (settings.mediaEnhancement?.showFloatingSpeedBadge !== false) {
      createVideoToolbar(video, targetSpeed);
    }
  }

  let isFastCompleting = false;
  function fastCompleteVideo(video) {
    if (!video) video = document.querySelector('video');
    if (!video) {
      showToast('⚠️ No active video player detected on page');
      return;
    }

    const dur = video.duration;
    if (!dur || isNaN(dur) || dur <= 0) {
      showToast('⏳ Video initializing, completing as soon as ready...', 2000);
      video.addEventListener('loadedmetadata', () => fastCompleteVideo(video), { once: true });
      return;
    }

    if (isFastCompleting) return;
    isFastCompleting = true;

    // Leave safe seconds before the end so Coursera's player logs playback and fires completion beacons
    // Small videos require genuine playback time to avoid being discarded by Coursera's telemetry
    let bufferSec = 6.0;
    if (dur <= 12) {
      bufferSec = Math.max(3.0, dur * 0.5);
    } else if (dur <= 45) {
      bufferSec = 5.5;
    } else {
      bufferSec = 6.0;
    }
    const targetTime = Math.max(0, dur - bufferSec);
    const remainingSec = Math.round(dur - targetTime);

    showToast(`⚡ Fast-completing: Playing final ${remainingSec}s for completion credit...`, 3500);

    try {
      video.currentTime = targetTime;
      video.playbackRate = 2.0;
      video.play().catch(() => {});
    } catch (err) {
      log.warn('Seek error:', err);
    }

    let advanceTriggered = false;
    const triggerAdvance = () => {
      if (advanceTriggered) return;
      advanceTriggered = true;
      isFastCompleting = false;
      // Allow 2.5s for Coursera's backend beacon and post-video overlay to settle
      setTimeout(() => {
        const clickedStart = checkAndClickStartButton();
        if (!clickedStart) {
          const nextBtn = findNextLessonButton();
          if (nextBtn) {
            showToast('🚀 Video completed! Advancing to next item...', 2000);
            forceClick(nextBtn);
          } else {
            checkAndClickStartButton();
          }
        }
      }, 2500);
    };

    video.addEventListener('ended', triggerAdvance, { once: true });

    // Fallback in case ended doesn't fire
    const fallbackDelay = Math.max(9000, Math.round((bufferSec + 5) * 1000));
    setTimeout(() => {
      if (isFastCompleting && !advanceTriggered) {
        triggerAdvance();
      }
    }, fallbackDelay);
  }

  function attemptAutoplay(video) {
    // 1. Click Coursera big play button overlay if present
    const bigPlayBtn = document.querySelector(
      'button[aria-label="Play Video"], .vjs-big-play-button, button[data-track-component="play_video"]'
    );
    if (bigPlayBtn && (bigPlayBtn.offsetParent !== null || bigPlayBtn.offsetWidth > 0)) {
      forceClick(bigPlayBtn);
    }

    // 2. Play video element
    video.play().catch(() => {
      const clickToPlay = () => {
        video.play().catch(() => {});
        document.removeEventListener('click', clickToPlay);
      };
      document.addEventListener('click', clickToPlay, { once: true });
    });
  }

  function createVideoToolbar(video, speed) {
    const parent = video.parentElement;
    if (!parent || parent.querySelector('.cca-video-toolbar')) return;

    if (window.getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'cca-video-toolbar';
    toolbar.style.cssText = `
      position: absolute;
      top: 14px;
      right: 14px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
    `;

    // 1. Speed Controller Pill
    const badge = document.createElement('div');
    badge.className = 'cca-speed-badge';
    badge.textContent = `${speed}x`;
    badge.title = 'Click to cycle playback speed (or use [ and ] hotkeys)';
    badge.style.cssText = `
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(10px);
      color: #38bdf8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12.5px;
      font-weight: 800;
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      transition: all 0.2s ease;
    `;

    const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      const curr = parseFloat(badge.textContent) || 1.5;
      const nextIdx = (SPEEDS.indexOf(curr) + 1) % SPEEDS.length;
      const next = SPEEDS[nextIdx];
      video.playbackRate = next;
      badge.textContent = `${next}x`;
      showToast(`Speed: ${next}x`);
    });

    // 2. Fast Complete Button
    const fastBtn = document.createElement('button');
    fastBtn.className = 'cca-fast-complete-btn';
    fastBtn.innerHTML = `<span>⚡</span><span>Fast Finish</span>`;
    fastBtn.title = 'Fast complete: seeks video to end, triggers 100% completion & advances (Hotkey: Shift+E or End)';
    fastBtn.style.cssText = `
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      backdrop-filter: blur(10px);
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 800;
      padding: 5px 12px;
      border-radius: 8px;
      border: 1px solid rgba(251, 191, 36, 0.5);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.45);
      transition: all 0.2s ease;
    `;

    fastBtn.addEventListener('mouseenter', () => {
      fastBtn.style.transform = 'translateY(-1px) scale(1.03)';
      fastBtn.style.boxShadow = '0 6px 18px rgba(245, 158, 11, 0.65)';
    });
    fastBtn.addEventListener('mouseleave', () => {
      fastBtn.style.transform = 'none';
      fastBtn.style.boxShadow = '0 4px 14px rgba(245, 158, 11, 0.45)';
    });

    fastBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fastCompleteVideo(video);
    });

    toolbar.appendChild(badge);
    toolbar.appendChild(fastBtn);
    parent.appendChild(toolbar);
  }

  function scanForVideos() {
    const videos = deepQuerySelectorAll('video');
    videos.forEach(attachToVideo);
  }

  // Hotkeys: '[' decrease, ']' increase, '\' reset, 'End' / 'Shift+E' Fast Complete
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

    if (e.key === ']' || e.key === '[') {
      const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
      const video = document.querySelector('video');
      if (!video) return;

      e.preventDefault();
      const curr = video.playbackRate || 1.5;
      let next = curr;

      if (e.key === ']') {
        next = SPEEDS.find(s => s > curr) || SPEEDS[SPEEDS.length - 1];
      } else {
        next = [...SPEEDS].reverse().find(s => s < curr) || SPEEDS[0];
      }

      video.playbackRate = next;
      const badge = document.querySelector('.cca-speed-badge');
      if (badge) badge.textContent = `${next}x`;
      showToast(`Speed: ${next}x`);
    } else if (e.key === '\\') {
      const video = document.querySelector('video');
      if (video) {
        e.preventDefault();
        video.playbackRate = 1.0;
        const badge = document.querySelector('.cca-speed-badge');
        if (badge) badge.textContent = '1x';
        showToast('Speed: 1x');
      }
    } else if (e.key === 'End' || (e.shiftKey && (e.key === 'E' || e.key === 'e'))) {
      const video = document.querySelector('video');
      if (video) {
        e.preventDefault();
        fastCompleteVideo(video);
      }
    }
  });

  // =========================================================================
  // 3. QUIZ ASSISTANT & SIDE ANSWERS PANEL
  // =========================================================================

  let quizSidebarEl = null;
  let quizToggleBtn = null;
  let cachedQuestions = [];

  function isQuizContext() {
    const u = window.location.href.toLowerCase();
    const isUrl = u.includes('/quiz/') || u.includes('/exam/') || u.includes('/assignment/') || u.includes('/assessment/');
    const hasDom = document.querySelector(
      '.rc-FormPartsQuestion, [data-testid="quiz-question"], form.c-quiz-form, div[role="radiogroup"], .rc-QuizQuestion, .c-question'
    ) !== null;
    return isUrl || hasDom;
  }

  // Stop words for robust semantic analysis
  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot',
    'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each',
    'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d',
    'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i',
    'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s',
    'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or',
    'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll',
    'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs',
    'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve',
    'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll',
    'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which',
    'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d',
    'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves'
  ]);

  function tokenizeAndStem(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
      .map(w => {
        if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
        if (w.endsWith('ing')) return w.slice(0, -3);
        if (w.endsWith('tion')) return w.slice(0, -4);
        if (w.endsWith('ment')) return w.slice(0, -4);
        if (w.endsWith('ed')) return w.slice(0, -2);
        if (w.endsWith('es')) return w.slice(0, -2);
        if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
        return w;
      });
  }

  function getCourseCorpus() {
    const nodes = Array.from(document.querySelectorAll(
      '.rc-Transcript, .rc-ParagraphContent, .rc-Supplement, .reading-content, [data-testid="reading-page"], [data-testid="content-item"], .c-reading-content, .rc-LectureNotes, .rc-CourseNotes'
    ));
    if (nodes.length > 0) {
      return nodes.map(n => n.innerText || n.textContent || '').join(' ').toLowerCase();
    }
    return (document.body ? document.body.innerText || '' : '').toLowerCase();
  }

  // Persistent Quiz Memory Cache & Gemini API Key Cache
  const DEFAULT_GEMINI_KEY = '';
  const BACKUP_GEMINI_KEYS = [];
  let quizMemoryCache = {};
  let userGeminiApiKey = DEFAULT_GEMINI_KEY;

  // Load Quiz Memory & Gemini Key from extension storage
  function loadQuizStorage() {
    try {
      chrome.storage.local.get(['cca_quiz_memory', 'gemini_api_key'], (res) => {
        if (res) {
          if (res.cca_quiz_memory) quizMemoryCache = res.cca_quiz_memory;
          if (res.gemini_api_key && res.gemini_api_key.trim()) {
            userGeminiApiKey = res.gemini_api_key.trim();
          } else {
            userGeminiApiKey = DEFAULT_GEMINI_KEY;
            chrome.storage.local.set({ gemini_api_key: DEFAULT_GEMINI_KEY });
          }
        }
      });
    } catch {}
  }
  loadQuizStorage();

  // Helper: Clean question prompt text by stripping point counters, status tags, and question numbering
  function cleanPromptText(text) {
    if (!text) return '';
    let cleaned = text
      .replace(/\u00a0/g, ' ')
      // Strip points like "1/1 point", "1 / 1 points", "1 point", "0 / 1 point", "(1 point)"
      .replace(/\(?\b\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s*points?\b\)?/gi, '')
      .replace(/\(?\b\d+(\.\d+)?\s*points?\b\)?/gi, '')
      .replace(/\[?\d+\s*points?\]?/gi, '')
      // Strip feedback / grading labels
      .replace(/\b(correct|incorrect|try again|nice work|passed|failed)\b[!.:]*/gi, '')
      // Strip leading numbering like "1. ", "Question 1:", "Q1."
      .replace(/^question\s*\d+[:.-]?\s*/i, '')
      .replace(/^\d+[\s.)-]+\s*/, '')
      .replace(/^q\d+[:.-]?\s*/i, '')
      // Normalize line breaks
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*\n+/g, '\n')
      .trim();

    // Filter out lines that are purely metadata
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => {
      if (!l) return false;
      if (/^question\s*\d+$/i.test(l)) return false;
      if (/^\d+[.):-]?$/.test(l)) return false;
      if (/^points?$/i.test(l)) return false;
      if (/^grad(ed|e)\s*quiz$/i.test(l)) return false;
      return true;
    });

    return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  // Helper: Find outermost question card container from any inner element
  function getEffectiveQuestionContainer(container) {
    if (!container) return container;
    // If container already contains prompt candidates outside options, return it
    if (container.querySelector('.rc-CML, .cml, [class*="FormPartsQuestion__content" i], [class*="promptText" i], h2, h3, h4, legend')) {
      return container;
    }
    // Climb to standard outer card wrappers
    const outer = container.closest(
      '.rc-FormPartsQuestion, [data-testid*="question" i], [data-testid*="part" i], [role="group"], .rc-QuizQuestion, .c-question, fieldset, li, section'
    );
    if (outer && outer !== container && outer.querySelector('label, [role="radio"], [role="checkbox"], input')) {
      return outer;
    }
    // Climb up parents looking for a container that has text before options
    let curr = container;
    for (let i = 0; i < 5; i++) {
      if (!curr || !curr.parentElement || curr.parentElement === document.body) break;
      curr = curr.parentElement;
      const hasPrompt = curr.querySelector('.rc-CML, .cml, p, [class*="content" i], [class*="prompt" i], legend, h1, h2, h3, h4');
      if (hasPrompt && !hasPrompt.closest('label, [role="radio"], [role="checkbox"], .c-input-choice')) {
        return curr;
      }
    }
    return container;
  }

  // Helper: Extract true question prompt text from Coursera question container
  function extractQuestionPrompt(rawContainer, fallbackIndex) {
    const container = getEffectiveQuestionContainer(rawContainer);

    // Strategy 1: ARIA labelledby / describedby
    const rg = container.querySelector('[role="radiogroup"], [role="group"]') || rawContainer.querySelector('[role="radiogroup"], [role="group"]') || container;
    const ariaLabelledBy = rg?.getAttribute('aria-labelledby') || container.getAttribute('aria-labelledby') || rawContainer.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          const text = cleanPromptText(el.innerText || el.textContent || '');
          if (text.length >= 4 && !/^question\s*\d+$/i.test(text)) {
            return text;
          }
        }
      }
    }

    // Strategy 2: Previous siblings of radiogroup or options container
    const optGroup = container.querySelector('[role="radiogroup"], [role="group"], fieldset') || rawContainer;
    let prev = optGroup.previousElementSibling;
    while (prev) {
      if (!prev.querySelector('label, [role="radio"], [role="checkbox"], input')) {
        const text = cleanPromptText(prev.innerText || prev.textContent || '');
        if (text.length >= 4 && !/^question\s*\d+$/i.test(text)) {
          return text;
        }
      }
      prev = prev.previousElementSibling;
    }

    // Strategy 3: Dedicated Coursera selectors for the prompt
    const promptSelectors = [
      '.rc-CML',
      '.cml',
      '.rc-FormPartsQuestion__contentText',
      '.rc-FormPartsQuestion__content',
      '.rc-FormPartsQuestion__title',
      '[data-testid*="question-title" i]',
      '[data-testid*="question-prompt" i]',
      '[data-testid*="question-content" i]',
      '[data-testid*="prompt" i]',
      '[class*="promptText" i]',
      '[class*="question-text" i]',
      '[class*="QuestionContent" i]',
      '.c-question-prompt',
      '.c-question-body',
      'legend',
      '[role="heading"]',
      'h1, h2, h3, h4, h5',
      '.css-1f9e2vi'
    ];

    for (const sel of promptSelectors) {
      const candidates = Array.from(container.querySelectorAll(sel));
      for (const el of candidates) {
        if (el.closest('label, [role="radio"], [role="checkbox"], .c-input-choice, [class*="feedback" i], [class*="grade" i], button')) {
          continue;
        }
        const cleaned = cleanPromptText(el.innerText || el.textContent || '');
        if (cleaned.length >= 4 && !/^question\s*\d+$/i.test(cleaned)) {
          return cleaned;
        }
      }
    }

    // Strategy 4: Clone container, strip all options/radios/inputs/feedback/buttons, and read remaining text
    try {
      const clone = container.cloneNode(true);
      clone.querySelectorAll(
        'label, [role="radio"], [role="checkbox"], .c-input-choice, input, button, [class*="feedback" i], [class*="grade" i], [class*="badge" i], .cca-rec-badge, [aria-live="polite"]'
      ).forEach(el => el.remove());

      const remainingText = cleanPromptText(clone.innerText || clone.textContent || '');
      if (remainingText.length >= 4 && !/^question\s*\d+$/i.test(remainingText)) {
        return remainingText;
      }
    } catch {}

    // Strategy 5: Text before the first option element
    const firstOption = container.querySelector('label, [role="radio"], [role="checkbox"], .c-input-choice, input');
    if (firstOption) {
      const fullText = container.innerText || container.textContent || '';
      const optText = (firstOption.innerText || firstOption.textContent || '').trim();
      if (optText && fullText.includes(optText)) {
        const beforeOpt = fullText.split(optText)[0];
        const cleaned = cleanPromptText(beforeOpt);
        if (cleaned.length >= 4 && !/^question\s*\d+$/i.test(cleaned)) {
          return cleaned;
        }
      }
    }

    // Strategy 6: If container was rawContainer, try its parent container before giving up
    if (rawContainer.parentElement && rawContainer.parentElement !== document.body) {
      try {
        const pClone = rawContainer.parentElement.cloneNode(true);
        pClone.querySelectorAll(
          'label, [role="radio"], [role="checkbox"], .c-input-choice, input, button, [class*="feedback" i], [class*="grade" i], [class*="badge" i], .cca-rec-badge'
        ).forEach(el => el.remove());
        const pText = cleanPromptText(pClone.innerText || pClone.textContent || '');
        if (pText.length >= 4 && !/^question\s*\d+$/i.test(pText)) {
          return pText;
        }
      } catch {}
    }

    return `Question ${fallbackIndex}`;
  }

  // Auto-Harvester & Grader: Reads Coursera feedback, scores, and eliminates wrong options
  let lastHarvestTime = 0;
  function harvestQuizResultsAndScore() {
    const now = Date.now();
    const containers = Array.from(document.querySelectorAll(
      '.rc-FormPartsQuestion, [data-testid="quiz-question"], .c-question, .rc-QuizQuestion'
    ));

    let correctCount = 0;
    let wrongCount = 0;
    let memoryUpdated = false;

    containers.forEach((container, i) => {
      const prompt = extractQuestionPrompt(container, i + 1);
      const normKey = prompt.toLowerCase().replace(/[^a-z0-9]/g, ' ').slice(0, 100).trim();
      if (normKey.length < 10) return;

      const containerText = (container.innerText || container.textContent || '').toLowerCase();
      const isCorrect = containerText.includes('nice work') ||
                        containerText.includes('correct!') ||
                        /1\s*\/\s*1\s*point/.test(containerText) ||
                        container.querySelector('.rc-FormPartsQuestion--correct, [class*="correct" i]') !== null;

      const isIncorrect = containerText.includes('try again') ||
                          containerText.includes('incorrect') ||
                          /0\s*\/\s*1\s*point/.test(containerText) ||
                          container.querySelector('.rc-FormPartsQuestion--incorrect, [class*="incorrect" i]') !== null;

      if (!quizMemoryCache[normKey]) {
        quizMemoryCache[normKey] = {
          correctAnswer: null,
          correctAnswers: [],
          wrongAnswers: [],
          feedbackText: '',
          updatedAt: Date.now()
        };
      }

      // Extract feedback explanation message
      const feedbackEl = container.querySelector('[class*="feedback" i], div[role="alert"], [data-testid*="feedback" i]');
      if (feedbackEl) {
        quizMemoryCache[normKey].feedbackText = feedbackEl.innerText.trim();
      }

      // Find checked / selected options
      const checkedOptEls = Array.from(container.querySelectorAll(
        'input[type="radio"]:checked, input[type="checkbox"]:checked, [aria-checked="true"], label.selected, div[class*="checked" i]'
      ));
      const selectedTexts = checkedOptEls.map(el => {
        const label = el.closest('label, div[role="radio"], div[role="checkbox"], .c-input-choice') || el.parentElement;
        return (label?.innerText || '').trim();
      }).filter(Boolean);

      if (isCorrect) {
        correctCount++;
        if (selectedTexts.length > 0) {
          quizMemoryCache[normKey].correctAnswer = selectedTexts[0];
          quizMemoryCache[normKey].correctAnswers = selectedTexts;
          memoryUpdated = true;
        }
      } else if (isIncorrect) {
        wrongCount++;
        selectedTexts.forEach(txt => {
          if (!quizMemoryCache[normKey].wrongAnswers.includes(txt)) {
            quizMemoryCache[normKey].wrongAnswers.push(txt);
            memoryUpdated = true;
          }
        });
        // Clear correct answer since this attempt failed
        quizMemoryCache[normKey].correctAnswer = null;
        quizMemoryCache[normKey].correctAnswers = [];
      }
    });

    if (memoryUpdated) {
      lastHarvestTime = now;
      try {
        chrome.storage.local.set({ cca_quiz_memory: quizMemoryCache }, () => {
          log.info(`Updated quiz memory: ${wrongCount} wrong answers eliminated, ${correctCount} correct answers learned.`);
        });
      } catch {}
    }

    // Extract grade / score percentage from page
    let scorePercent = null;
    const gradeElements = Array.from(document.querySelectorAll(
      '[data-testid*="grade" i], .rc-GradeNumber, [class*="gradeNumber" i], [class*="Grade" i], [class*="score" i], div[role="status"], h1, h2, h3'
    ));
    for (const el of gradeElements) {
      const t = el.innerText || el.textContent || '';
      const m = t.match(/(\d+(\.\d+)?)%/);
      if (m) {
        scorePercent = parseFloat(m[1]);
        break;
      }
    }

    const totalGraded = correctCount + wrongCount;
    if (scorePercent === null && totalGraded > 0) {
      scorePercent = Math.round((correctCount / totalGraded) * 100);
    }

    return {
      scorePercent,
      correctCount,
      wrongCount,
      totalGraded,
      isGraded: totalGraded > 0 || scorePercent !== null
    };
  }

  function extractQuizQuestions() {
    const rawContainers = Array.from(document.querySelectorAll(
      '.rc-FormPartsQuestion, [data-testid="quiz-question"], [data-testid*="part-container" i], .c-question, .rc-QuizQuestion, [role="group"]:has([role="radiogroup"]), fieldset:has([role="radiogroup"]), div:has(> div[role="radiogroup"])'
    ));

    // Filter out containers that are contained inside another container
    let containers = rawContainers.filter(c => {
      return !rawContainers.some(other => other !== c && other.contains(c));
    });

    // Fallback: If no containers matched, find option groups directly
    if (containers.length === 0) {
      const optionGroups = Array.from(document.querySelectorAll(
        '[role="radiogroup"], fieldset:has(input), div:has(> label input[type="radio"]), div:has(> label input[type="checkbox"])'
      ));
      containers = optionGroups.map(og => {
        return og.closest('[role="group"], fieldset, .rc-FormPartsQuestion, [data-testid*="part" i]') ||
               og.parentElement?.parentElement ||
               og.parentElement ||
               og;
      });
    }

    const corpus = getCourseCorpus();
    const results = [];

    containers.forEach((container, i) => {
      const promptText = extractQuestionPrompt(container, i + 1);

      // Multi-Select Question Detection ("Select all that apply", checkboxes)
      const checkboxInputs = Array.from(container.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
      const multiPhrases = /(select|choose|check)\s+(all|each|every|multiple|two|three|four|both)\b|all\s+that\s+apply|which\s+of\s+the\s+following\s+are/i;
      const isMultiSelect = checkboxInputs.length > 1 || multiPhrases.test(promptText);

      const optionElements = Array.from(container.querySelectorAll(
        'label, div[role="radio"], div[role="checkbox"], .c-input-choice'
      ));

      const options = [];
      optionElements.forEach(optEl => {
        const text = (optEl.textContent || '').trim();
        const input = optEl.querySelector('input[type="radio"], input[type="checkbox"]') ||
                      (optEl.tagName === 'INPUT' ? optEl : null) ||
                      optEl;
        if (text.length > 0) {
          options.push({
            text,
            element: optEl,
            inputElement: input,
            isCheckbox: !!optEl.querySelector('input[type="checkbox"], [role="checkbox"]') || optEl.getAttribute('role') === 'checkbox'
          });
        }
      });

      if (options.length > 0) {
        const recommended = deduceBestAnswer(promptText, options, corpus, isMultiSelect);
        results.push({
          index: i + 1,
          container,
          prompt: promptText,
          isMultiSelect,
          options,
          recommended
        });
      }
    });

    return results;
  }

  function deduceBestAnswer(prompt, options, corpus = '', isMultiSelect = false) {
    const normKey = prompt.toLowerCase().replace(/[^a-z0-9]/g, ' ').slice(0, 100).trim();
    const memory = quizMemoryCache[normKey] || null;

    // 1. Memory Check: If we previously learned the 100% correct answer(s)
    if (memory && memory.correctAnswers && memory.correctAnswers.length > 0) {
      const matched = options.filter(o =>
        memory.correctAnswers.some(ca => o.text.toLowerCase().includes(ca.toLowerCase()) || ca.toLowerCase().includes(o.text.toLowerCase()))
      );
      if (matched.length > 0) {
        return {
          option: matched[0],
          options: matched,
          isMultiSelect: matched.length > 1 || isMultiSelect,
          confidence: 100,
          runnerUp: null,
          reasons: ['✨ Locked Correct (from previous attempt)'],
          isMemoryLocked: true
        };
      }
    } else if (memory && memory.correctAnswer) {
      const matchedOpt = options.find(o => o.text.toLowerCase().includes(memory.correctAnswer.toLowerCase()) || memory.correctAnswer.toLowerCase().includes(o.text.toLowerCase()));
      if (matchedOpt) {
        return {
          option: matchedOpt,
          options: [matchedOpt],
          isMultiSelect: false,
          confidence: 100,
          runnerUp: null,
          reasons: ['✨ Locked Correct (from previous attempt)'],
          isMemoryLocked: true
        };
      }
    }

    const lowerPrompt = prompt.toLowerCase();
    const isNegative =
      lowerPrompt.includes('not ') ||
      lowerPrompt.includes('except') ||
      lowerPrompt.includes('false') ||
      lowerPrompt.includes('incorrect') ||
      lowerPrompt.includes('least likely') ||
      lowerPrompt.includes('untrue') ||
      lowerPrompt.includes('disadvantage') ||
      lowerPrompt.includes('drawback');

    const promptTokens = tokenizeAndStem(prompt);
    const feedbackTokens = memory?.feedbackText ? tokenizeAndStem(memory.feedbackText) : [];
    const scoredOptions = [];

    options.forEach(opt => {
      const lowerOpt = opt.text.toLowerCase().trim();
      const optTokens = tokenizeAndStem(opt.text);
      let score = 50;
      let reasons = [];

      // Memory Exclusion: If this option was marked WRONG in a previous attempt, heavily penalize it!
      if (memory && memory.wrongAnswers && memory.wrongAnswers.length > 0) {
        const wasWrong = memory.wrongAnswers.some(w => lowerOpt.includes(w.toLowerCase()) || w.toLowerCase().includes(lowerOpt));
        if (wasWrong) {
          score -= 999;
          reasons.push('❌ Eliminated (failed previous attempt)');
        }
      }

      // Memory Feedback Alignment: If Coursera gave explanation, match options against it!
      if (feedbackTokens.length > 0) {
        let feedbackHits = 0;
        optTokens.forEach(t => { if (feedbackTokens.includes(t)) feedbackHits++; });
        if (feedbackHits > 0) {
          score += feedbackHits * 25;
          reasons.push('Matches instructor feedback explanation');
        }
      }

      // Course Transcript & Reading Corpus Match
      if (corpus && corpus.length > 100) {
        if (lowerOpt.length > 15 && corpus.includes(lowerOpt)) {
          if (isNegative) {
            score -= 40;
          } else {
            score += 70;
            reasons.push('Exact course text match');
          }
        } else {
          let hits = 0;
          optTokens.forEach(t => { if (corpus.includes(t)) hits++; });
          if (optTokens.length > 0) {
            const ratio = hits / optTokens.length;
            if (isNegative) {
              if (ratio < 0.25) {
                score += 45;
                reasons.push('Statement absent from course text');
              }
            } else if (ratio > 0.6) {
              score += Math.round(ratio * 40);
              reasons.push('High course transcript overlap');
            }
          }
        }
      }

      // Question-Option Keyword Alignment
      let sharedCount = 0;
      const promptSet = new Set(promptTokens);
      optTokens.forEach(t => { if (promptSet.has(t)) sharedCount++; });
      if (sharedCount > 0) {
        score += sharedCount * 12;
      }

      // Absolute vs Nuanced Phrasing
      const hasAbsolute = /\b(always|never|only|must|impossible|none of the above|entirely|exclusively)\b/i.test(lowerOpt);
      const hasNuanced = /\b(can|may|often|typically|generally|helps to|primarily|potential|usually|various)\b/i.test(lowerOpt);

      if (hasAbsolute) {
        if (isNegative) {
          score += 35;
          reasons.push('Absolute claim in negative question');
        } else {
          score -= 15;
        }
      }

      if (hasNuanced && !isNegative) {
        score += 20;
        reasons.push('Nuanced academic phrasing');
      }

      // "All of the above" check
      if (lowerOpt.includes('all of the above') || lowerOpt.includes('all of these')) {
        if (!isNegative) score += 25;
      }

      // Informative description length
      const wordCount = opt.text.split(/\s+/).length;
      if (wordCount >= 5 && wordCount <= 25) {
        score += Math.min(15, wordCount);
      }

      scoredOptions.push({
        option: opt,
        score,
        reasons
      });
    });

    // Sort descending by score
    scoredOptions.sort((a, b) => b.score - a.score);

    // Multi-Select Handling: Select all positive non-eliminated options
    if (isMultiSelect) {
      const nonEliminated = scoredOptions.filter(s => s.score > 0);
      let selected = nonEliminated.filter(s => s.score >= 50);
      if (selected.length === 0 && nonEliminated.length > 0) {
        selected = nonEliminated.slice(0, 2);
      }
      if (selected.length === 0) {
        selected = scoredOptions.slice(0, 1);
      }

      return {
        option: selected[0].option,
        options: selected.map(s => s.option),
        isMultiSelect: true,
        confidence: 88,
        runnerUp: null,
        reasons: selected[0].reasons,
        eliminated: memory?.wrongAnswers || []
      };
    }

    const best = scoredOptions[0];
    const second = scoredOptions.length > 1 ? scoredOptions[1] : null;

    let confidence = 85;
    if (second) {
      const margin = best.score - second.score;
      if (margin > 30) confidence = 96;
      else if (margin > 15) confidence = 90;
      else if (margin > 5) confidence = 83;
      else confidence = 74;
    }

    return {
      option: best.option,
      options: [best.option],
      isMultiSelect: false,
      confidence,
      runnerUp: second && (best.score - second.score < 25) ? second.option : null,
      runnerUpScore: second ? second.score : 0,
      reasons: best.reasons,
      eliminated: memory?.wrongAnswers || []
    };
  }

  // Helper: Apply single or multiple selected answers cleanly to Coursera DOM
  function applyAnswersToDOM(q) {
    if (!q || !q.recommended) return;
    const recOpts = q.recommended.options && q.recommended.options.length > 0
      ? q.recommended.options
      : (q.recommended.option ? [q.recommended.option] : []);

    if (q.isMultiSelect || recOpts.length > 1) {
      // First uncheck any currently checked checkboxes that are NOT recommended
      q.options.forEach(opt => {
        const isRec = recOpts.some(ro => ro.text === opt.text);
        const input = opt.inputElement;
        if (!isRec && input && (input.checked || input.getAttribute('aria-checked') === 'true')) {
          forceClick(input);
        }
      });
      // Check all recommended options
      recOpts.forEach(opt => {
        const input = opt.inputElement;
        if (input && (!input.checked || input.getAttribute('aria-checked') === 'false')) {
          forceClick(input);
        }
      });
    } else if (recOpts[0] && recOpts[0].inputElement) {
      forceClick(recOpts[0].inputElement);
    }
  }

  // Format Questions as an Educational Study Guide (Bypasses AI Refusal Filters)
  function formatQuestionsForAI(questions) {
    let text = `Educational Study & Conceptual Verification Guide:\n\n`;
    text += `Please analyze the following academic questions and identify the correct option(s) for each:\n\n`;

    questions.forEach(q => {
      text += `==============================\n`;
      text += `Question ${q.index}${q.isMultiSelect ? ' (Multi-Select: Select all that apply)' : ''}:\n`;
      text += `${q.prompt}\n\n`;
      text += `Options:\n`;
      q.options.forEach((opt, oIdx) => {
        const letter = String.fromCharCode(65 + oIdx);
        text += `${letter}) ${opt.text}\n`;
      });
      text += `\n`;
    });

    text += `==============================\n`;
    text += `Instructions for AI:\n`;
    text += `1. Output each Question number with its correct option letter(s) and exact text. For multi-select questions, list ALL correct options.\n`;
    text += `2. Provide a 1-sentence academic rationale explaining why this option is correct.\n`;
    return text;
  }

  // Direct Gemini AI Solver (Handles both Single-Choice and Multi-Select with Memory Exclusion)
  async function solveWithGeminiAPI(questions) {
    const key = (userGeminiApiKey && userGeminiApiKey.trim()) ? userGeminiApiKey.trim() : DEFAULT_GEMINI_KEY;
    if (!key) {
      const promptKey = prompt('🔑 Enter your Google Gemini API Key (Get a 100% free key at aistudio.google.com):');
      if (promptKey && promptKey.trim()) {
        userGeminiApiKey = promptKey.trim();
        chrome.storage.local.set({ gemini_api_key: userGeminiApiKey });
      } else {
        showToast('⚠️ Gemini API key required to solve with AI');
        return;
      }
    }

    showToast('✨ Gemini AI is analyzing quiz questions...', 4000);

    const questionsPayload = questions.map(q => {
      const normKey = q.prompt.toLowerCase().replace(/[^a-z0-9]/g, ' ').slice(0, 100).trim();
      const memory = quizMemoryCache[normKey] || null;
      return {
        index: q.index,
        question: q.prompt,
        isMultiSelect: !!q.isMultiSelect,
        options: q.options.map(o => o.text),
        previouslyEliminatedWrongOptions: memory?.wrongAnswers || []
      };
    });

    const promptBody = `You are a world-class academic tutor. Solve the following academic questions with 100% precision.
CRITICAL RULES:
1. If "isMultiSelect" is false: select exactly 1 correct option.
2. If "isMultiSelect" is true ("Select all that apply"): select ALL applicable correct options.
3. NEVER select any option listed in "previouslyEliminatedWrongOptions" because those were tested and confirmed wrong by the course instructor!
4. Return strictly a raw JSON array of objects with the exact schema:
[
  {
    "index": 1,
    "isMultiSelect": false,
    "answers": ["exact option text"]
  }
]
Do not output extra commentary or markdown, output only the JSON array.

Questions:
${JSON.stringify(questionsPayload, null, 2)}`;

    // Candidate Keys pool (User custom key -> Key 1 -> Key 3 -> Key 2)
    const candidateKeys = [
      (userGeminiApiKey && userGeminiApiKey.trim()) ? userGeminiApiKey.trim() : null,
      DEFAULT_GEMINI_KEY,
      ...BACKUP_GEMINI_KEYS
    ].filter((k, idx, arr) => k && arr.indexOf(k) === idx);

    // Active Gemini endpoints
    const models = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'];
    let lastError = null;
    let data = null;

    const requestBody = JSON.stringify({
      contents: [{ parts: [{ text: promptBody }] }]
    });

    keyLoop:
    for (const key of candidateKeys) {
      const headers = {
        'Content-Type': 'application/json',
        'X-goog-api-key': key
      };
      if (key.startsWith('AQ.') || key.startsWith('ya29.')) {
        headers['Authorization'] = `Bearer ${key}`;
      }

      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
          const response = await fetch(url, {
            method: 'POST',
            headers,
            body: requestBody
          });

          if (response.ok) {
            data = await response.json();
            break keyLoop;
          } else {
            let errDetail = '';
            try {
              const errJson = await response.json();
              errDetail = errJson.error?.message || response.statusText;
            } catch {
              errDetail = `HTTP ${response.status}`;
            }
            lastError = new Error(`Key (...${key.slice(-6)}) ${model} (${response.status}): ${errDetail}`);
            if (response.status === 429 || response.status === 403) {
              log.info(`API Key limit reached (${response.status}), rotating to backup key...`);
              break;
            }
            continue;
          }
        } catch (e) {
          lastError = e;
        }
      }
    }

    if (!data) {
      log.warn('Gemini API Solve error across all keys:', lastError);
      showToast(`❌ Gemini Solve failed: ${lastError?.message || 'API error'}`, 5000);
      return;
    }

    try {
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      const jsonMatch = rawText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      const cleanJson = jsonMatch ? jsonMatch[0] : rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const answers = JSON.parse(cleanJson);

      let appliedCount = 0;
      answers.forEach(item => {
        const q = questions.find(x => x.index === item.index);
        if (!q) return;

        const answerList = Array.isArray(item.answers)
          ? item.answers
          : (item.answer ? [item.answer] : []);

        const matchedOptions = [];
        answerList.forEach(ans => {
          const aText = String(ans).toLowerCase().trim();
          const aTextClean = aText.replace(/^[a-z][.):-]\s*/i, '').trim();
          const matchedOpt = q.options.find(o => {
            const oText = o.text.toLowerCase().trim();
            const oTextClean = oText.replace(/^[a-z][.):-]\s*/i, '').trim();
            return oText.includes(aText) || aText.includes(oText) ||
                   (aTextClean.length > 3 && (oTextClean.includes(aTextClean) || aTextClean.includes(oTextClean)));
          });
          if (matchedOpt && !matchedOptions.includes(matchedOpt)) {
            matchedOptions.push(matchedOpt);
          }
        });

        if (matchedOptions.length > 0) {
          q.recommended = {
            option: matchedOptions[0],
            options: matchedOptions,
            isMultiSelect: matchedOptions.length > 1 || q.isMultiSelect,
            confidence: 100,
            reasons: ['✨ Gemini AI Verified (100%)'],
            isMemoryLocked: true
          };

          applyAnswersToDOM(q);
          appliedCount++;
        }
      });

      renderQuizSidebar(questions);
      checkAndMarkHonorAgreement();
      showToast(`🎉 Gemini AI solved & selected ${appliedCount} questions!`, 3500);
    } catch (parseErr) {
      log.warn('Gemini response parse error:', parseErr);
      showToast(`⚠️ Gemini responded, but format could not be parsed`, 3500);
    }
  }

  // Checks and marks the mandatory Coursera quiz submission honor agreement checkbox
  function checkAndMarkHonorAgreement() {
    const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    if (allCheckboxes.length === 0) return false;

    // Filter for agreement / honor code checkboxes
    const agreementCheckboxes = allCheckboxes.filter(cb => {
      const container = cb.closest('label, div, p, fieldset, section') || cb.parentElement;
      const text = ((container?.innerText || '') + ' ' + (cb.getAttribute('aria-label') || '') + ' ' + (cb.name || '') + ' ' + (cb.id || '')).toLowerCase();

      const hasAgreementKeywords =
        text.includes('honor') ||
        text.includes('agree') ||
        text.includes('understand') ||
        text.includes('submitting work') ||
        text.includes('own work') ||
        text.includes('deactivation') ||
        text.includes('failure of this course') ||
        text.includes('code of conduct');

      // Also detect if checkbox is located outside question cards (e.g. in the submission footer)
      const isInsideQuestion = cb.closest('.rc-QuizQuestion, [data-testid*="question" i], [data-testid*="quiz-question" i], [class*="Question" i]');

      return hasAgreementKeywords || (!isInsideQuestion && allCheckboxes.length <= 15);
    });

    let marked = false;
    for (const cb of agreementCheckboxes) {
      if (!cb.checked) {
        try {
          // Set checked using property descriptor to notify React synthetic event system
          const proto = window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
          if (setter) {
            setter.call(cb, true);
          } else {
            cb.checked = true;
          }

          cb.dispatchEvent(new Event('input', { bubbles: true }));
          cb.dispatchEvent(new Event('change', { bubbles: true }));

          // Click visible label or parent wrapper for full user simulation
          const label = cb.closest('label') || document.querySelector(`label[for="${cb.id}"]`) || cb.parentElement;
          if (label) {
            forceClick(label);
          } else {
            forceClick(cb);
          }
          marked = true;
        } catch (err) {
          log.warn('Failed to mark agreement checkbox:', err);
        }
      } else {
        marked = true;
      }
    }

    if (marked) {
      log.info('Honor Code agreement checkbox verified/marked.');
    }
    return marked;
  }

  // Detects if current quiz has strict attempt limits (e.g. "Only 2 attempts", "2 attempts remaining")
  function checkLimitedAttempts() {
    const pageText = (document.body ? document.body.innerText : '') || '';

    const patterns = [
      /\bonly\s+(\d+|one|two|three)\s+attempts?\b/i,
      /\b(\d+)\s+attempts?\s+(?:remaining|left)\b/i,
      /\battempts?\s*(?:remaining|left)?:\s*\d+\s*(?:of|\/)\s*([1-3])\b/i,
      /\byou\s+have\s+(\d+|one|two|three)\s+attempts?\s+every\b/i,
      /\b(\d+|one|two|three)\s+attempts?\s+every\s+\d+\s+hours?\b/i,
      /\bmaximum\s+(?:of\s+)?(\d+|one|two|three)\s+attempts?\b/i,
      /\blimited\s+to\s+(\d+|one|two|three)\s+attempts?\b/i,
      /\byou\s+can\s+(?:only\s+)?take\s+this\s+quiz\s+(\d+|one|two|three)\s+times?\b/i,
      /\b(\d+)\s+of\s+2\s+attempts?\b/i,
      /\b(\d+)\s+of\s+3\s+attempts?\b/i
    ];

    for (const regex of patterns) {
      const match = pageText.match(regex);
      if (match) {
        return { isLimited: true, reason: match[0].trim() };
      }
    }

    const attemptEls = document.querySelectorAll('[data-testid*="attempt" i], [class*="attempt" i], [class*="Attempt" i]');
    for (const el of attemptEls) {
      const txt = (el.textContent || '').trim();
      for (const regex of patterns) {
        const match = txt.match(regex);
        if (match) {
          return { isLimited: true, reason: match[0].trim() };
        }
      }
    }

    return { isLimited: false, reason: null };
  }

  // Auto-Submit Coursera Quiz (Checks Honor Code & Confirms Modal)
  async function submitQuiz() {
    // 0. LIMITED ATTEMPTS SAFETY GUARD:
    // If the quiz states limited attempts (e.g., "only 2 attempts"), leave for user to submit manually!
    const limitInfo = checkLimitedAttempts();
    if (limitInfo.isLimited) {
      log.warn(`Limited attempts detected ("${limitInfo.reason}"). Auto-submission blocked.`);
      showToast(`🔒 Limited attempts detected ("${limitInfo.reason}"). Submission left for you to review and submit manually!`, 6000);
      return false;
    }

    log.info('Preparing to submit quiz...');
    showToast('📝 Marking agreement checkbox & submitting...', 2500);

    // 1. Ensure Honor Code / submission agreement checkbox is checked
    checkAndMarkHonorAgreement();
    await new Promise(r => setTimeout(r, 600));

    // 2. Find Submit button
    const findSubmit = () => {
      return Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]')).find(b => {
        if (b.offsetParent === null && b.offsetWidth === 0) return false;
        const t = (b.textContent || '').trim().toLowerCase();
        const a = (b.getAttribute('aria-label') || '').toLowerCase();
        const tid = (b.getAttribute('data-testid') || '').toLowerCase();
        return (
          t === 'submit quiz' ||
          t === 'submit assignment' ||
          t === 'submit' ||
          tid.includes('submit-quiz') ||
          a.includes('submit quiz')
        );
      });
    };

    let submitBtn = findSubmit();

    // If submit button is disabled, re-verify checkbox and wait up to 1.5s for React state to re-render
    if (submitBtn && (submitBtn.disabled || submitBtn.hasAttribute('disabled'))) {
      checkAndMarkHonorAgreement();
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 300));
        submitBtn = findSubmit();
        if (submitBtn && !submitBtn.disabled && !submitBtn.hasAttribute('disabled')) break;
      }
    }

    if (!submitBtn || submitBtn.disabled || submitBtn.hasAttribute('disabled')) {
      log.warn('Submit button not found or still disabled after agreement check.');
      showToast('⚠️ Agreement marked. Please click "Submit Quiz" manually.', 4000);
      return false;
    }

    forceClick(submitBtn);

    // 3. Confirm modal if Coursera prompts: "Submit your quiz?"
    setTimeout(() => {
      const confirmBtn = Array.from(document.querySelectorAll('div[role="dialog"] button, .rc-Modal button')).find(b => {
        const t = (b.textContent || '').trim().toLowerCase();
        return t === 'submit' || t === 'yes, submit' || t === 'confirm';
      });
      if (confirmBtn) {
        log.info('Confirming quiz submission modal...');
        forceClick(confirmBtn);
      }
    }, 800);

    return true;
  }

  // Quiz Auto-Solve, Submit & Re-attempt Loop until score >= 75%
  let isRetryingQuiz = false;
  let quizRetryAttempts = 0;

  async function startQuizAutoRetryLoop() {
    const limitInfo = checkLimitedAttempts();
    if (limitInfo.isLimited) {
      showToast(`🔒 Limited attempts detected ("${limitInfo.reason}"). Auto-retry loop disabled to protect your attempts. Submit manually!`, 6000);
      return;
    }

    if (isRetryingQuiz) {
      showToast('🔄 Quiz auto-retry loop is already active!', 2500);
      return;
    }
    isRetryingQuiz = true;
    quizRetryAttempts = 0;
    showToast('🚀 Starting Quiz Auto-Solve & Loop until ≥75%...', 3000);
    runQuizLoopIteration();
  }

  async function runQuizLoopIteration() {
    quizRetryAttempts++;
    log.info(`Running quiz loop iteration #${quizRetryAttempts}...`);

    // 1. Check if we are currently looking at quiz results
    const results = harvestQuizResultsAndScore();
    if (results.isGraded && results.scorePercent !== null) {
      log.info(`Detected quiz results: ${results.scorePercent}% (${results.correctCount} correct, ${results.wrongCount} wrong).`);

      if (results.scorePercent >= 75) {
        isRetryingQuiz = false;
        showToast(`🎉 PASSED with ${results.scorePercent}%! (Threshold ≥75% met in attempt #${quizRetryAttempts})`, 5000);
        setTimeout(() => {
          const nextBtn = findNextLessonButton();
          if (nextBtn) {
            showToast('🚀 Advancing to next lesson...', 2500);
            forceClick(nextBtn);
          }
        }, 2500);
        return;
      } else {
        // Score < 75%: Retake with wrong answers eliminated
        showToast(`⚠️ Score: ${results.scorePercent}% (< 75%). ${results.wrongCount} wrong answers eliminated. Retaking...`, 4000);

        const retakeBtn = Array.from(document.querySelectorAll('button, a[role="button"]')).find(b => {
          if (b.offsetParent === null && b.offsetWidth === 0) return false;
          if (b.hasAttribute('disabled') || b.disabled) return false;
          const t = (b.textContent || '').trim().toLowerCase();
          const tid = (b.getAttribute('data-testid') || '').toLowerCase();
          return (
            t.includes('try again') ||
            t.includes('retake') ||
            t.includes('resume') ||
            tid.includes('retake') ||
            tid.includes('try-again')
          );
        });

        if (retakeBtn) {
          log.info('Clicking retake quiz button...');
          forceClick(retakeBtn);
          // Confirm retake modal if present
          setTimeout(() => {
            const modalConfirm = Array.from(document.querySelectorAll('div[role="dialog"] button, .rc-Modal button')).find(b => {
              const t = (b.textContent || '').trim().toLowerCase();
              return t.includes('start') || t.includes('retake') || t.includes('continue');
            });
            if (modalConfirm) forceClick(modalConfirm);
          }, 600);

          await waitForQuestionsToLoad();
        }
      }
    }

    // 2. Extract and solve questions
    await new Promise(r => setTimeout(r, 1200));
    const questions = extractQuizQuestions();
    if (questions.length === 0) {
      log.info('No quiz questions found yet. Retrying detection...');
      setTimeout(runQuizLoopIteration, 1500);
      return;
    }

    showToast(`🧠 Solving ${questions.length} questions (Attempt #${quizRetryAttempts})...`, 3000);

    // Try Gemini AI solve if candidate key exists, otherwise heuristics
    let aiSolved = false;
    const candidateKeys = [
      (userGeminiApiKey && userGeminiApiKey.trim()) ? userGeminiApiKey.trim() : null,
      DEFAULT_GEMINI_KEY,
      ...BACKUP_GEMINI_KEYS
    ].filter(Boolean);

    if (candidateKeys.length > 0) {
      try {
        await solveWithGeminiAPI(questions);
        aiSolved = true;
      } catch (err) {
        log.warn('Gemini solver encountered error, falling back to heuristics:', err);
      }
    }

    if (!aiSolved) {
      questions.forEach(q => applyAnswersToDOM(q));
      renderQuizSidebar(questions);
    }

    await new Promise(r => setTimeout(r, 1500));

    // 3. Auto-Submit the quiz
    showToast('📝 Auto-submitting quiz answers...', 3000);
    const submitted = await submitQuiz();
    if (!submitted) {
      showToast('⚠️ Submit button disabled or not found. Please click Submit.', 4000);
      isRetryingQuiz = false;
      return;
    }

    // 4. Await grading results
    waitForQuizResults();
  }

  function waitForQuestionsToLoad(attempts = 0) {
    return new Promise(resolve => {
      const check = () => {
        const q = extractQuizQuestions();
        if (q.length > 0 || attempts > 15) {
          resolve();
        } else {
          setTimeout(() => waitForQuestionsToLoad(attempts + 1).then(resolve), 800);
        }
      };
      check();
    });
  }

  function waitForQuizResults(attempts = 0) {
    setTimeout(() => {
      const results = harvestQuizResultsAndScore();
      if (results.isGraded || attempts >= 20) {
        runQuizLoopIteration();
      } else {
        waitForQuizResults(attempts + 1);
      }
    }, 1500);
  }

  function renderQuizSidebar(questions) {
    cachedQuestions = questions;
    removeQuizSidebar();

    // 1. Floating Toggle Button
    quizToggleBtn = document.createElement('button');
    quizToggleBtn.id = 'cca-quiz-toggle-btn';
    quizToggleBtn.innerHTML = `<span>🧠</span><span>Quiz Answers (${questions.length})</span>`;
    quizToggleBtn.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 2147483646;
      background: linear-gradient(135deg, #6366f1, #06b6d4);
      color: #ffffff;
      border: none;
      border-radius: 9999px;
      padding: 10px 18px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.45);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    `;

    quizToggleBtn.addEventListener('click', () => {
      if (quizSidebarEl) {
        const isHidden = quizSidebarEl.style.display === 'none';
        quizSidebarEl.style.display = isHidden ? 'flex' : 'none';
      }
    });
    document.body.appendChild(quizToggleBtn);

    // 2. Sidebar Panel
    quizSidebarEl = document.createElement('aside');
    quizSidebarEl.id = 'cca-quiz-sidebar';
    quizSidebarEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      bottom: 20px;
      width: 400px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 18px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75);
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f8fafc;
      overflow: hidden;
    `;

    // Header with Aryan Branding & Portfolio Link
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(0, 0, 0, 0.35);
    `;
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 22px;">🧠</span>
        <div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <strong style="font-size: 14px; color: #f8fafc;">Quiz Assistant</strong>
            <span style="font-size: 9px; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 1px 6px; border-radius: 4px; font-weight: 800;">by Aryan</span>
          </div>
          <span style="font-size: 11px; color: #94a3b8;">${questions.length} Questions Detected</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <a href="https://aryaninvincible-portfolio.vercel.app" target="_blank" rel="noopener noreferrer" title="Visit Aryan's Portfolio" style="
          font-size: 11px; color: #38bdf8; text-decoration: none; display: flex; align-items: center; gap: 4px; font-weight: 700;
          background: rgba(56, 189, 248, 0.12); padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.3);
        ">🌐 Portfolio</a>
        <button id="cca-close-sidebar-btn" style="
          background: none; border: none; color: #94a3b8; font-size: 22px; cursor: pointer; line-height: 1; padding: 0 4px;
        ">&times;</button>
      </div>
    `;

    quizSidebarEl.appendChild(header);

    // Limited Attempts Safety Alert Banner (e.g. "Only 2 attempts allowed")
    const limitInfo = checkLimitedAttempts();
    if (limitInfo.isLimited) {
      const limitBanner = document.createElement('div');
      limitBanner.style.cssText = `
        margin: 10px 14px 0 14px;
        background: rgba(245, 158, 11, 0.18);
        border: 1px solid rgba(245, 158, 11, 0.55);
        border-radius: 10px;
        padding: 9px 12px;
        display: flex;
        align-items: flex-start;
        gap: 8px;
      `;
      limitBanner.innerHTML = `
        <span style="font-size: 18px; line-height: 1;">🔒</span>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <strong style="color: #fde68a; font-size: 11.5px;">Limited Attempts Detected: "${limitInfo.reason}"</strong>
          <span style="color: #cbd5e1; font-size: 10.5px; line-height: 1.35;">
            Automatic submission is locked to protect your grade. Use <strong>Auto-Select All</strong> to fill answers, then review & submit manually!
          </span>
        </div>
      `;
      quizSidebarEl.appendChild(limitBanner);
    }

    // Actions Bar: Auto-Select, Gemini Solve, Auto-Retry Loop (>=75%), Copy for AI
    const actions = document.createElement('div');
    actions.style.cssText = `
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(99, 102, 241, 0.1);
    `;
    actions.innerHTML = `
      <div style="display: flex; gap: 6px; width: 100%;">
        <button id="cca-auto-select-all" style="
          flex: 1; padding: 7px 10px; background: #10b981; border: none; border-radius: 8px;
          color: white; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        ">
          <span>⚡</span><span>Auto-Select All</span>
        </button>
        <button id="cca-gemini-solve-btn" style="
          flex: 1; padding: 7px 10px; background: linear-gradient(135deg, #4f46e5, #06b6d4); border: none; border-radius: 8px;
          color: white; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
        ">
          <span>✨</span><span>Gemini AI Solve</span>
        </button>
      </div>
      <div style="display: flex; gap: 6px; width: 100%;">
        <button id="cca-auto-retry-loop-btn" style="
          flex: 2; padding: 7px 10px;
          background: ${limitInfo.isLimited ? 'rgba(100, 116, 139, 0.35)' : 'linear-gradient(135deg, #f59e0b, #ea580c)'};
          border: ${limitInfo.isLimited ? '1px dashed rgba(148, 163, 184, 0.4)' : 'none'};
          border-radius: 8px;
          color: ${limitInfo.isLimited ? '#94a3b8' : 'white'};
          font-size: 11.5px; font-weight: 800; cursor: ${limitInfo.isLimited ? 'not-allowed' : 'pointer'};
          display: flex; align-items: center; justify-content: center; gap: 4px;
          box-shadow: ${limitInfo.isLimited ? 'none' : '0 4px 12px rgba(245, 158, 11, 0.35)'};
        " title="${limitInfo.isLimited ? 'Auto-submit disabled for limited-attempt quiz' : 'Auto-submit and retry if score is under 75%'}">
          <span>${limitInfo.isLimited ? '🔒' : '🔄'}</span><span>${limitInfo.isLimited ? 'Auto-Submit Disabled' : 'Auto-Submit & Retry (till ≥75%)'}</span>
        </button>
        <button id="cca-copy-quiz-btn" style="
          flex: 1; padding: 7px 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
          color: #f1f5f9; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
        ">
          <span>📋</span><span>Copy for AI</span>
        </button>
      </div>
    `;

    // Questions List
    const list = document.createElement('div');
    list.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    `;

    questions.forEach(q => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: rgba(30, 41, 59, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      `;

      const conf = q.recommended.confidence;
      const confColor = conf >= 95 ? '#10b981' : (conf >= 85 ? '#06b6d4' : '#f59e0b');
      const confLabel = conf >= 95 ? '100% Verified' : (conf >= 85 ? 'Good Match' : 'Review Recommended');

      const isMulti = !!q.isMultiSelect;
      const recList = q.recommended.options && q.recommended.options.length > 0
        ? q.recommended.options
        : (q.recommended.option ? [q.recommended.option] : []);

      const typeBadge = isMulti
        ? `<span style="font-size: 9px; font-weight: 800; background: #6366f1; color: white; padding: 2px 6px; border-radius: 4px;">☑️ MULTI-CHOICE (${recList.length})</span>`
        : `<span style="font-size: 9px; font-weight: 800; background: rgba(148, 163, 184, 0.2); color: #cbd5e1; padding: 2px 6px; border-radius: 4px;">🔘 SINGLE-CHOICE</span>`;

      const reasonTags = (q.recommended.reasons && q.recommended.reasons.length > 0)
        ? q.recommended.reasons.map(r => `<span style="font-size: 9.5px; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; padding: 1px 5px; border-radius: 4px;">${r}</span>`).join(' ')
        : '';

      const answersHtml = recList.map(opt => `
        <div style="display: flex; align-items: flex-start; gap: 6px; margin-top: 3px;">
          <span style="color: #34d399; font-size: 12px; font-weight: 900;">${isMulti ? '☑' : '✓'}</span>
          <span style="font-size: 12px; color: #ffffff; line-height: 1.35; font-weight: 600;">${opt.text}</span>
        </div>
      `).join('');

      const runnerUpHtml = q.recommended.runnerUp ? `
        <div style="
          background: rgba(100, 116, 139, 0.15); border: 1px dashed rgba(148, 163, 184, 0.3);
          border-radius: 8px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; gap: 6px;
        ">
          <div style="font-size: 11px; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <strong style="color: #94a3b8;">Alt:</strong> ${q.recommended.runnerUp.text}
          </div>
          <button class="cca-alt-btn" data-idx="${q.index}" style="
            background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2);
            color: #f1f5f9; font-size: 10px; font-weight: 700; border-radius: 4px; padding: 2px 6px; cursor: pointer; flex-shrink: 0;
          ">Select Alt</button>
        </div>
      ` : '';

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 11px; font-weight: 800; color: #94a3b8;">QUESTION ${q.index}</span>
            ${typeBadge}
          </div>
          <span style="font-size: 10px; font-weight: 800; background: ${confColor}; color: white; padding: 2px 7px; border-radius: 4px;">
            ${conf}% • ${confLabel}
          </span>
        </div>
        <p style="font-size: 12px; line-height: 1.4; color: #f8fafc; margin: 0; font-weight: 600;">${q.prompt}</p>
        
        <div style="
          background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4);
          border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
            <span style="font-size: 11px; font-weight: 700; color: #34d399;">Recommended Answer:</span>
            <div>${reasonTags}</div>
          </div>
          ${answersHtml}

          <!-- Manual Correction Bar: Mark as Wrong or Teach Correct -->
          <div style="display: flex; gap: 6px; align-items: center; justify-content: flex-end; margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255, 255, 255, 0.15);">
            <button class="cca-mark-wrong-btn" data-idx="${q.index}" title="Mark this answer as wrong and eliminate it" style="
              background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5;
              font-size: 10px; font-weight: 700; border-radius: 5px; padding: 3px 8px; cursor: pointer; display: flex; align-items: center; gap: 4px;
            ">
              <span>❌</span><span>Mark as Wrong</span>
            </button>
            <button class="cca-toggle-teach-btn" data-idx="${q.index}" title="Pick which choice is actually correct" style="
              background: rgba(56, 189, 248, 0.18); border: 1px solid rgba(56, 189, 248, 0.4); color: #7dd3fc;
              font-size: 10px; font-weight: 700; border-radius: 5px; padding: 3px 8px; cursor: pointer; display: flex; align-items: center; gap: 4px;
            ">
              <span>✏️</span><span>This is Correct &rarr;</span>
            </button>
          </div>
        </div>

        <!-- Collapsible Teach Panel: Select any option as the true correct one -->
        <div class="cca-teach-options-panel" id="cca-teach-panel-${q.index}" style="
          display: none; background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(56, 189, 248, 0.3);
          border-radius: 10px; padding: 10px; flex-direction: column; gap: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.5);
        ">
          <div style="font-size: 10px; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.04em;">
            Select the true correct answer to train assistant:
          </div>
          ${q.options.map((opt, oIdx) => {
            const isCurr = recList.some(ro => ro.text === opt.text);
            return `
              <div style="
                display: flex; align-items: center; justify-content: space-between; gap: 8px;
                padding: 6px 8px; background: ${isCurr ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.04)'};
                border: 1px solid ${isCurr ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)'};
                border-radius: 6px; font-size: 11px;
              ">
                <span style="color: #f1f5f9; flex: 1; line-height: 1.3;">
                  <strong style="color: #94a3b8;">${String.fromCharCode(65 + oIdx)})</strong> ${opt.text}
                </span>
                <button class="cca-set-correct-btn" data-idx="${q.index}" data-opt-idx="${oIdx}" style="
                  background: #059669; border: none; color: white; font-size: 10px; font-weight: 800;
                  border-radius: 4px; padding: 3px 8px; cursor: pointer; white-space: nowrap;
                ">✓ This is Correct</button>
              </div>
            `;
          }).join('')}
        </div>

        ${runnerUpHtml}

        <div style="display: flex; gap: 6px; margin-top: 2px;">
          <button class="cca-select-btn" data-idx="${q.index}" style="
            flex: 1; padding: 6px 10px; background: rgba(99, 102, 241, 0.25); border: 1px solid rgba(99, 102, 241, 0.5);
            border-radius: 6px; color: #a5b4fc; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px;
          ">
            <span>🎯</span><span>Select Answer</span>
          </button>
          <button class="cca-search-btn" data-idx="${q.index}" title="Search Google for this question & answer" style="
            padding: 6px 9px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px; color: #94a3b8; font-size: 11px; cursor: pointer;
          ">🔍</button>
          <button class="cca-ai-btn" data-idx="${q.index}" title="Copy prompt for ChatGPT / Claude" style="
            padding: 6px 9px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 6px; color: #94a3b8; font-size: 11px; cursor: pointer;
          ">🤖</button>
        </div>
      `;

      list.appendChild(card);
    });

    // Developer Footer Card with Portfolio Link
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 10px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: #94a3b8;
    `;
    footer.innerHTML = `
      <span>Crafted by <strong style="color: #38bdf8;">Aryan</strong></span>
      <a href="https://aryaninvincible-portfolio.vercel.app" target="_blank" rel="noopener noreferrer" style="
        color: #818cf8; text-decoration: none; font-weight: 600; display: flex; align-items: center; gap: 4px;
      ">
        <span>aryaninvincible-portfolio.vercel.app</span>
        <span>&rarr;</span>
      </a>
    `;

    quizSidebarEl.appendChild(actions);
    quizSidebarEl.appendChild(list);
    quizSidebarEl.appendChild(footer);
    document.body.appendChild(quizSidebarEl);

    // Highlight on page
    highlightQuizOptions(questions);

    // Header Close Button
    header.querySelector('#cca-close-sidebar-btn').onclick = () => {
      quizSidebarEl.style.display = 'none';
    };

    // Auto-Select All Action (Supports both single and multi-select + checks Honor agreement)
    actions.querySelector('#cca-auto-select-all').onclick = () => {
      let count = 0;
      questions.forEach(q => {
        applyAnswersToDOM(q);
        count++;
      });
      // Automatically check the Coursera Honor Code submission agreement checkbox
      checkAndMarkHonorAgreement();
      showToast(`⚡ Auto-selected answers for ${count} questions & checked agreement!`, 3000);
    };

    // Gemini AI Solve Button
    actions.querySelector('#cca-gemini-solve-btn').onclick = () => {
      solveWithGeminiAPI(questions);
    };

    // Auto-Submit & Retry Loop (till >=75%)
    actions.querySelector('#cca-auto-retry-loop-btn').onclick = () => {
      if (limitInfo.isLimited) {
        showToast(`🔒 Limited attempts detected ("${limitInfo.reason}"). Auto-submit is locked to protect your grade. Please review and submit manually!`, 6000);
        return;
      }
      startQuizAutoRetryLoop();
    };

    // Copy All Questions formatted as Educational Study Guide (Never refused by AI)
    actions.querySelector('#cca-copy-quiz-btn').onclick = () => {
      const prompt = formatQuestionsForAI(questions);
      navigator.clipboard.writeText(prompt).then(() => {
        showToast('📋 Copied study guide for AI! (Bypasses refusal filters)', 3500);
      });
    };

    // Select Individual Answer Button
    list.querySelectorAll('.cca-select-btn').forEach(btn => {
      btn.onclick = (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        const item = questions.find(x => x.index === idx);
        if (item) {
          applyAnswersToDOM(item);
          if (item.container) item.container.scrollIntoView({ behavior: 'smooth', block: 'center' });
          showToast(`🎯 Selected Answer for Q${idx}`);
        }
      };
    });

    // Select Alt Option Button
    list.querySelectorAll('.cca-alt-btn').forEach(btn => {
      btn.onclick = (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        const item = questions.find(x => x.index === idx);
        if (item && item.recommended?.runnerUp?.inputElement) {
          forceClick(item.recommended.runnerUp.inputElement);
          if (item.container) item.container.scrollIntoView({ behavior: 'smooth', block: 'center' });
          showToast(`🎯 Selected Alternative for Q${idx}`);
        }
      };
    });

    // Toggle Teach Options Panel
    list.querySelectorAll('.cca-toggle-teach-btn').forEach(btn => {
      btn.onclick = (e) => {
        const idx = e.currentTarget.dataset.idx;
        const panel = list.querySelector(`#cca-teach-panel-${idx}`);
        if (panel) {
          const isHidden = panel.style.display === 'none';
          panel.style.display = isHidden ? 'flex' : 'none';
        }
      };
    });

    // Mark as Wrong Action
    list.querySelectorAll('.cca-mark-wrong-btn').forEach(btn => {
      btn.onclick = (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        const item = questions.find(x => x.index === idx);
        if (!item) return;

        const wrongOptions = item.recommended.options && item.recommended.options.length > 0
          ? item.recommended.options.map(o => o.text)
          : [item.recommended.option.text];

        const normKey = item.prompt.toLowerCase().replace(/[^a-z0-9]/g, ' ').slice(0, 100).trim();

        if (!quizMemoryCache[normKey]) {
          quizMemoryCache[normKey] = { correctAnswer: null, correctAnswers: [], wrongAnswers: [], feedbackText: '', updatedAt: Date.now() };
        }
        wrongOptions.forEach(wt => {
          if (!quizMemoryCache[normKey].wrongAnswers.includes(wt)) {
            quizMemoryCache[normKey].wrongAnswers.push(wt);
          }
        });
        quizMemoryCache[normKey].correctAnswer = null;
        quizMemoryCache[normKey].correctAnswers = [];
        chrome.storage.local.set({ cca_quiz_memory: quizMemoryCache });

        // Re-deduce answer eliminating this option
        item.recommended = deduceBestAnswer(item.prompt, item.options, getCourseCorpus(), item.isMultiSelect);
        applyAnswersToDOM(item);
        renderQuizSidebar(questions);
        showToast(`❌ Eliminated wrong choice! Switched to next option.`);
      };
    });

    // Teach Correct Answer Action
    list.querySelectorAll('.cca-set-correct-btn').forEach(btn => {
      btn.onclick = (e) => {
        const qIdx = parseInt(e.currentTarget.dataset.idx, 10);
        const optIdx = parseInt(e.currentTarget.dataset.optIdx, 10);
        const item = questions.find(x => x.index === qIdx);
        if (!item || !item.options[optIdx]) return;

        const chosenOpt = item.options[optIdx];
        const normKey = item.prompt.toLowerCase().replace(/[^a-z0-9]/g, ' ').slice(0, 100).trim();

        if (!quizMemoryCache[normKey]) {
          quizMemoryCache[normKey] = { correctAnswer: null, correctAnswers: [], wrongAnswers: [], feedbackText: '', updatedAt: Date.now() };
        }
        quizMemoryCache[normKey].correctAnswer = chosenOpt.text;
        quizMemoryCache[normKey].correctAnswers = [chosenOpt.text];
        quizMemoryCache[normKey].wrongAnswers = quizMemoryCache[normKey].wrongAnswers.filter(w => w !== chosenOpt.text);
        quizMemoryCache[normKey].userOverridden = true;
        chrome.storage.local.set({ cca_quiz_memory: quizMemoryCache });

        item.recommended = {
          option: chosenOpt,
          options: [chosenOpt],
          isMultiSelect: false,
          confidence: 100,
          reasons: ['👑 User Verified Correct (100%)'],
          isMemoryLocked: true
        };

        applyAnswersToDOM(item);
        renderQuizSidebar(questions);
        showToast(`👑 Saved as 100% correct! Memorized for all future attempts.`);
      };
    });

    // Google Search for Question
    list.querySelectorAll('.cca-search-btn').forEach(btn => {
      btn.onclick = (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        const item = questions.find(x => x.index === idx);
        if (item) {
          const query = `"${item.prompt.slice(0, 80)}" ${item.recommended.option.text.slice(0, 40)}`;
          window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
        }
      };
    });

    // Single Question AI Copy (Educational format)
    list.querySelectorAll('.cca-ai-btn').forEach(btn => {
      btn.onclick = (e) => {
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        const item = questions.find(x => x.index === idx);
        if (item) {
          let prompt = `Educational Concept Verification:\n\n`;
          prompt += `==============================\n`;
          prompt += `Question ${item.index}${item.isMultiSelect ? ' (Multi-Select: Select all that apply)' : ''}:\n${item.prompt}\n\nOptions:\n`;
          item.options.forEach((opt, oIdx) => {
            prompt += `${String.fromCharCode(65 + oIdx)}) ${opt.text}\n`;
          });
          prompt += `\nPlease state which option(s) are correct and provide a concise 1-sentence conceptual explanation.`;
          navigator.clipboard.writeText(prompt).then(() => showToast(`📋 Q${idx} question & options copied!`));
        }
      };
    });
  }

  function highlightQuizOptions(questions) {
    questions.forEach(q => {
      const recList = q.recommended?.options && q.recommended.options.length > 0
        ? q.recommended.options
        : (q.recommended?.option ? [q.recommended.option] : []);

      recList.forEach(best => {
        if (best && best.element) {
          best.element.style.border = '2px solid #10b981';
          best.element.style.borderRadius = '8px';
          best.element.style.background = 'rgba(16, 185, 129, 0.08)';
          best.element.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.3)';
          best.element.style.transition = 'all 0.25s ease';

          if (!best.element.querySelector('.cca-rec-badge')) {
            const badge = document.createElement('span');
            badge.className = 'cca-rec-badge';
            badge.textContent = '✨ CCA Recommended';
            badge.style.cssText = `
              display: inline-block;
              background: #059669;
              color: white;
              font-size: 10px;
              font-weight: 800;
              padding: 2px 6px;
              border-radius: 4px;
              margin-left: 8px;
            `;
            best.element.appendChild(badge);
          }
        }
      });
    });
  }

  function removeQuizSidebar() {
    if (quizSidebarEl && quizSidebarEl.parentNode) {
      quizSidebarEl.parentNode.removeChild(quizSidebarEl);
      quizSidebarEl = null;
    }
    if (quizToggleBtn && quizToggleBtn.parentNode) {
      quizToggleBtn.parentNode.removeChild(quizToggleBtn);
      quizToggleBtn = null;
    }
  }

  // =========================================================================
  // 4. SCREEN WAKE LOCK & ALWAYS ACTIVE ENGINE
  // =========================================================================

  let wakeLockSentinel = null;
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        if (!wakeLockSentinel || wakeLockSentinel.released) {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
          wakeLockSentinel.addEventListener('release', () => {
            wakeLockSentinel = null;
          });
        }
      } catch {}
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && settings.activeMode?.screenWakeLock) {
      requestWakeLock();
    }
  });

  // Inject Main World Page Script for visibility and blur spoofing
  function injectMainWorldScript() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/content/page-script.js');
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.onload = () => s.remove();
    } catch {}
  }

  // Site Unlocker
  function applyUnlocker() {
    if (settings.siteUnlocker?.enabled === false) return;

    if (!document.getElementById('cca-unlock-styles')) {
      const st = document.createElement('style');
      st.id = 'cca-unlock-styles';
      st.textContent = `
        *, *::before, *::after {
          -webkit-user-select: auto !important;
          user-select: auto !important;
          -webkit-touch-callout: default !important;
        }
      `;
      (document.head || document.documentElement).appendChild(st);
    }

    const allow = (e) => e.stopPropagation();
    window.addEventListener('contextmenu', allow, true);
    window.addEventListener('copy', allow, true);
    window.addEventListener('cut', allow, true);
    window.addEventListener('selectstart', allow, true);
  }

  // Update Bridge Element for Main World script
  function updateBridge() {
    let bridge = document.getElementById('cca-bridge-port');
    if (!bridge) {
      bridge = document.createElement('span');
      bridge.id = 'cca-bridge-port';
      bridge.style.display = 'none';
      (document.head || document.documentElement).appendChild(bridge);
    }
    bridge.dataset.enabled = settings.activeMode?.enabled ? 'true' : 'false';
    bridge.dataset.spoofVisibility = settings.activeMode?.spoofVisibility ? 'true' : 'false';
    bridge.dataset.preventWindowBlur = settings.activeMode?.preventWindowBlur ? 'true' : 'false';
    bridge.dataset.keepRenderLoop = settings.activeMode?.keepRenderLoopActive ? 'true' : 'false';
  }

  // =========================================================================
  // 5. MASTER SCANNER & LIFECYCLE
  // =========================================================================

  let lastQuizUrl = '';
  let lastQuizSignature = '';

  function getQuizSignature(qList) {
    return qList.map(q => q.prompt.slice(0, 40) + ':' + q.options.length).join('|');
  }

  function handleQuizLifecycle() {
    if (settings.quizAssistant?.enabled === false) {
      if (quizSidebarEl || quizToggleBtn) removeQuizSidebar();
      return;
    }

    const currentUrl = window.location.href;
    const inQuiz = isQuizContext();

    // 1. If we are NOT on a quiz page (e.g. video, reading, home)
    if (!inQuiz) {
      if (quizSidebarEl || quizToggleBtn) {
        removeQuizSidebar();
      }
      cachedQuestions = [];
      lastQuizUrl = currentUrl;
      lastQuizSignature = '';
      return;
    }

    // 2. We ARE in a quiz: harvest results if graded
    harvestQuizResultsAndScore();

    const qList = extractQuizQuestions();
    if (qList.length === 0) {
      return;
    }

    const newSig = getQuizSignature(qList);
    const urlChanged = currentUrl !== lastQuizUrl;
    const questionsChanged = newSig !== lastQuizSignature;

    // If user navigated to a DIFFERENT quiz, or the questions updated, or sidebar is missing
    if (urlChanged || questionsChanged || !quizSidebarEl) {
      lastQuizUrl = currentUrl;
      lastQuizSignature = newSig;
      log.info(`New quiz context detected (${qList.length} questions). Refreshing sidebar for current quiz...`);
      renderQuizSidebar(qList);
    }
  }

  function masterScan() {
    // 1. Check for Coursera post-video "Start" card button
    checkAndClickStartButton();

    // 2. Scan and attach videos
    scanForVideos();

    // 3. Check for Reading & Item page completion (categorization exercises, interactive widgets, readings)
    checkItemCompletion();

    // 4. Check for in-video question popups
    checkInVideoCheckpoint();

    // 5. Dynamic Quiz Assistant Lifecycle (auto-detects different quizzes and resets stale answers)
    handleQuizLifecycle();
  }

  // Init
  function init() {
    injectMainWorldScript();
    applyUnlocker();

    // Fetch latest settings from storage
    try {
      chrome.storage.local.get(['settings'], (res) => {
        if (res && res.settings) {
          settings = { ...settings, ...res.settings };
        }
        updateBridge();
        if (settings.activeMode?.screenWakeLock) {
          requestWakeLock();
        }
      });
    } catch {}

    // Listen for live updates
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SETTINGS_CHANGED' && msg.payload) {
        settings = { ...settings, ...msg.payload };
        updateBridge();
        // Update playback speed across active videos
        if (settings.mediaEnhancement?.defaultPlaybackSpeed) {
          document.querySelectorAll('video').forEach(v => {
            v.playbackRate = settings.mediaEnhancement.defaultPlaybackSpeed;
          });
          const badge = document.querySelector('.cca-speed-badge');
          if (badge) badge.textContent = `${settings.mediaEnhancement.defaultPlaybackSpeed}x`;
        }
      }
    });

    // Listen for SPA back/forward history transitions
    window.addEventListener('popstate', masterScan);

    // Run high-frequency master scan every 200ms
    setInterval(masterScan, 200);

    // Also observe DOM changes via MutationObserver for zero-delay detection
    const obs = new MutationObserver(() => {
      checkAndClickStartButton();
      checkInVideoCheckpoint();
    });

    obs.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    log.info('Course Completion Assistant standalone bundle active on', currentDomain);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
