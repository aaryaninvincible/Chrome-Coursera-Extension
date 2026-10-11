/**
 * Universal Media Enhancement System
 * Course Completion Assistant
 *
 * Controls playback speed (1x to 5x), handles autoplay, auto-resume, intro skipping,
 * auto-advancing to the next lesson, and progress/metrics logging.
 */

import { Logger } from '../utils/logger.js';
import { Helpers } from '../utils/helpers.js';

export const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

class MediaController {
  constructor() {
    this.settings = null;
    this.activeVideos = new Set();
    this.observer = null;
    this.currentSpeed = 1.5;
    this.nextTimer = null;
    this.toastElement = null;
    this.onVideoCompletion = null; // Callback to record metrics

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleVideoEnded = this.handleVideoEnded.bind(this);
    this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
    this.handleLoadedMetadata = this.handleLoadedMetadata.bind(this);
  }

  /**
   * Start video enhancements with settings
   */
  start(settings = {}, completionCallback = null) {
    this.settings = settings;
    this.currentSpeed = settings.defaultPlaybackSpeed || 1.5;
    this.onVideoCompletion = completionCallback;

    // Scan existing videos
    this.scanAndAttach();

    // Observe dynamically injected videos (e.g. SPAs, Coursera lecture transitions)
    if (!this.observer) {
      this.observer = new MutationObserver(Helpers.debounce(() => {
        this.scanAndAttach();
      }, 500));

      this.observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    // Bind hotkeys: '[' slows down, ']' speeds up, '\' resets
    window.removeEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keydown', this.handleKeyDown);

    Logger.info('MediaController initialized with default speed:', this.currentSpeed);
  }

  /**
   * Set playback speed across all active videos
   */
  setSpeed(speed) {
    this.currentSpeed = parseFloat(speed) || 1;
    this.activeVideos.forEach(video => {
      try {
        video.playbackRate = this.currentSpeed;
        video.defaultPlaybackRate = this.currentSpeed;
        this.updateBadge(video);
      } catch (err) {
        Logger.debug('Error updating playback rate on video:', err);
      }
    });

    this.showToast(`Playback Speed: ${this.currentSpeed}x`, 1500);
  }

  /**
   * Scan DOM (including shadow DOMs) for HTML5 video elements
   */
  scanAndAttach() {
    const videos = Helpers.deepQuerySelectorAll('video');
    videos.forEach(video => {
      if (!this.activeVideos.has(video)) {
        this.attachToVideo(video);
      }
    });
  }

  /**
   * Attach controllers and event listeners to a video element
   */
  attachToVideo(video) {
    this.activeVideos.add(video);

    // Apply current speed
    video.playbackRate = this.currentSpeed;
    video.defaultPlaybackRate = this.currentSpeed;

    // Remove old listeners just in case
    video.removeEventListener('ended', this.handleVideoEnded);
    video.removeEventListener('timeupdate', this.handleTimeUpdate);
    video.removeEventListener('loadedmetadata', this.handleLoadedMetadata);

    video.addEventListener('ended', this.handleVideoEnded);
    video.addEventListener('timeupdate', this.handleTimeUpdate);
    video.addEventListener('loadedmetadata', this.handleLoadedMetadata);

    // Auto Play if enabled
    if (this.settings?.autoPlay && video.paused) {
      this.attemptAutoPlay(video);
    }

    // Add floating speed badge
    if (this.settings?.showFloatingSpeedBadge !== false) {
      this.createSpeedBadge(video);
    }

    Logger.debug('Attached MediaController to video element.');
  }

  /**
   * Attempt auto-play with error handling for browser autoplay policies
   */
  async attemptAutoPlay(video) {
    try {
      await video.play();
      Logger.info('Auto-play started successfully.');
    } catch (err) {
      Logger.debug('Auto-play blocked by browser policy:', err.message);
      // Wait for first user click on document to unpause
      const resumeOnClick = () => {
        video.play().catch(() => {});
        document.removeEventListener('click', resumeOnClick);
      };
      document.addEventListener('click', resumeOnClick, { once: true });
    }
  }

  /**
   * Loaded metadata handler: handles intro skip & saved resume position
   */
  handleLoadedMetadata(e) {
    const video = e.target;
    video.playbackRate = this.currentSpeed;

    // Intro skip
    if (this.settings?.autoSeekIntro && this.settings.introSkipSeconds > 0) {
      if (video.currentTime < this.settings.introSkipSeconds && video.duration > this.settings.introSkipSeconds * 2) {
        video.currentTime = this.settings.introSkipSeconds;
        this.showToast(`Skipped Intro (+${this.settings.introSkipSeconds}s)`, 2000);
      }
    }
  }

  /**
   * Monitor playback progress & auto resume if stalled
   */
  handleTimeUpdate(e) {
    const video = e.target;
    // Keep speed locked in case LMS resets it
    if (Math.abs(video.playbackRate - this.currentSpeed) > 0.05) {
      video.playbackRate = this.currentSpeed;
    }

    // Auto Next when progress is >= 99%
    if (
      this.settings?.autoNext &&
      video.duration > 10 &&
      video.currentTime >= video.duration - 0.5 &&
      !video.dataset.ccaAdvancing
    ) {
      this.triggerAutoNext(video);
    }
  }

  /**
   * Video ended event
   */
  handleVideoEnded(e) {
    const video = e.target;
    
    // Record metrics
    if (this.onVideoCompletion) {
      this.onVideoCompletion({
        durationSeconds: Math.round(video.duration || 0),
        speed: this.currentSpeed,
        courseTitle: document.title || 'Online Course',
        videoTitle: video.title || document.querySelector('h1, h2')?.textContent || 'Lesson Video',
        domain: window.location.hostname
      });
    }

    if (this.settings?.autoNext) {
      this.triggerAutoNext(video);
    }
  }

  /**
   * Trigger auto-advancing to next lesson with visual countdown
   */
  triggerAutoNext(video) {
    if (video.dataset.ccaAdvancing) return;
    video.dataset.ccaAdvancing = 'true';

    const delay = this.settings?.autoNextDelaySeconds ?? 5;
    let remaining = delay;

    this.showNextCountdown(remaining, () => {
      // Cancelled
      video.dataset.ccaAdvancing = '';
      if (this.nextTimer) clearInterval(this.nextTimer);
      this.hideToast();
    });

    this.nextTimer = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        this.updateCountdownToast(remaining);
      } else {
        clearInterval(this.nextTimer);
        this.advanceToNextLesson();
      }
    }, 1000);
  }

  /**
   * Advance to next lesson via detected button
   */
  advanceToNextLesson() {
    this.hideToast();
    const nextBtn = Helpers.findNextLessonButton();
    if (nextBtn) {
      this.showToast('Navigating to next lesson...', 2000);
      nextBtn.click();
      Logger.info('Next lesson button clicked:', nextBtn);
    } else {
      this.showToast('No Next Lesson button detected on page.', 3000);
      Logger.warn('Auto-next failed: no matching button found.');
    }
  }

  /**
   * Floating Speed Badge on Video
   */
  createSpeedBadge(video) {
    const container = video.parentElement;
    if (!container || container.querySelector('.cca-speed-badge')) return;

    // Ensure container has relative positioning
    const compStyle = window.getComputedStyle(container);
    if (compStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const badge = document.createElement('div');
    badge.className = 'cca-speed-badge';
    badge.title = 'Click to cycle speed, or use [ and ] hotkeys';
    badge.textContent = `${this.currentSpeed}x`;

    badge.style.cssText = `
      position: absolute;
      top: 14px;
      right: 14px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      color: #38bdf8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      cursor: pointer;
      user-select: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    badge.addEventListener('mouseenter', () => {
      badge.style.transform = 'scale(1.08)';
      badge.style.borderColor = '#38bdf8';
    });
    badge.addEventListener('mouseleave', () => {
      badge.style.transform = 'scale(1)';
      badge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
    });

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleSpeed();
    });

    container.appendChild(badge);
  }

  updateBadge(video) {
    const badge = video.parentElement?.querySelector('.cca-speed-badge');
    if (badge) {
      badge.textContent = `${this.currentSpeed}x`;
    }
  }

  cycleSpeed() {
    const currentIdx = PLAYBACK_SPEEDS.indexOf(this.currentSpeed);
    const nextIdx = (currentIdx + 1) % PLAYBACK_SPEEDS.length;
    this.setSpeed(PLAYBACK_SPEEDS[nextIdx]);
  }

  /**
   * Keyboard shortcuts handling
   */
  handleKeyDown(e) {
    // Skip if typing in inputs or contenteditable
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }

    if (e.key === ']') {
      e.preventDefault();
      const next = PLAYBACK_SPEEDS.find(s => s > this.currentSpeed) || PLAYBACK_SPEEDS[PLAYBACK_SPEEDS.length - 1];
      this.setSpeed(next);
    } else if (e.key === '[') {
      e.preventDefault();
      const prev = [...PLAYBACK_SPEEDS].reverse().find(s => s < this.currentSpeed) || PLAYBACK_SPEEDS[0];
      this.setSpeed(prev);
    } else if (e.key === '\\') {
      e.preventDefault();
      this.setSpeed(1);
    } else if (e.key === 'End' || (e.shiftKey && (e.key === 'E' || e.key === 'e'))) {
      const video = Array.from(this.activeVideos)[0] || document.querySelector('video');
      if (video) {
        e.preventDefault();
        this.fastCompleteVideo(video);
      }
    }
  }

  /**
   * Fast Complete: Seeks video near end with safe buffer to trigger LMS completion & auto-advance
   */
  fastCompleteVideo(video) {
    if (!video) video = Array.from(this.activeVideos)[0] || document.querySelector('video');
    if (!video) {
      this.showToast('⚠️ No active video player found', 1500);
      return;
    }

    const dur = video.duration;
    if (!dur || isNaN(dur) || dur <= 0) {
      this.showToast('⏳ Video initializing, completing as soon as ready...', 2000);
      video.addEventListener('loadedmetadata', () => this.fastCompleteVideo(video), { once: true });
      return;
    }

    // Safe buffer so Coursera registers genuine watch time & fires completion beacons
    let bufferSec = 6.0;
    if (dur <= 12) {
      bufferSec = Math.max(3.0, dur * 0.5);
    } else if (dur <= 45) {
      bufferSec = 5.5;
    } else {
      bufferSec = 6.0;
    }
    const target = Math.max(0, dur - bufferSec);
    const remainingSec = Math.round(dur - target);

    this.showToast(`⚡ Fast-completing: Playing final ${remainingSec}s for completion credit...`, 3500);
    try {
      video.currentTime = target;
      video.playbackRate = 2.0;
      video.play().catch(() => {});
    } catch {}

    let advanceTriggered = false;
    const onEnded = () => {
      if (advanceTriggered) return;
      advanceTriggered = true;
      setTimeout(() => {
        this.handleVideoEnded(video);
      }, 2500);
    };

    video.addEventListener('ended', onEnded, { once: true });

    const fallbackDelay = Math.max(9000, Math.round((bufferSec + 5) * 1000));
    setTimeout(() => {
      if (!advanceTriggered) {
        onEnded();
      }
    }, fallbackDelay);
  }

  /**
   * On-screen Toast Notification System
   */
  showToast(message, durationMs = 2000) {
    this.hideToast();

    this.toastElement = document.createElement('div');
    this.toastElement.className = 'cca-toast';
    this.toastElement.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
      animation: cca-slide-down 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    this.toastElement.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>${message}</span>
    `;

    document.body.appendChild(this.toastElement);

    if (durationMs > 0) {
      setTimeout(() => this.hideToast(), durationMs);
    }
  }

  showNextCountdown(seconds, onCancel) {
    this.hideToast();

    this.toastElement = document.createElement('div');
    this.toastElement.className = 'cca-toast cca-countdown-toast';
    this.toastElement.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(14px);
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 18px;
      border-radius: 12px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      gap: 14px;
      pointer-events: auto;
    `;

    this.toastElement.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: #38bdf8;">Next lesson in</span>
        <span id="cca-countdown-num" style="background: #0284c7; color: white; border-radius: 6px; padding: 2px 8px; font-weight: 800;">${seconds}s</span>
      </div>
      <button id="cca-cancel-next" style="
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #f1f5f9;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      ">Cancel</button>
    `;

    document.body.appendChild(this.toastElement);

    const cancelBtn = this.toastElement.querySelector('#cca-cancel-next');
    cancelBtn.addEventListener('click', () => {
      if (onCancel) onCancel();
    });
  }

  updateCountdownToast(seconds) {
    const numEl = document.getElementById('cca-countdown-num');
    if (numEl) {
      numEl.textContent = `${seconds}s`;
    }
  }

  hideToast() {
    if (this.toastElement && this.toastElement.parentNode) {
      this.toastElement.parentNode.removeChild(this.toastElement);
      this.toastElement = null;
    }
  }

  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.nextTimer) {
      clearInterval(this.nextTimer);
    }
    this.hideToast();
    window.removeEventListener('keydown', this.handleKeyDown);
    this.activeVideos.clear();
  }
}

export const mediaController = new MediaController();
