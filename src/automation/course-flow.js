/**
 * Course Flow Automation Controller
 * Course Completion Assistant
 *
 * Implements:
 * 1. Auto-clicks Coursera's post-video "Start" next item overlay button.
 * 2. Aggressive video autoplay upon lecture navigation.
 * 3. Reading material auto-completion ("Mark as completed" + auto-advance).
 * 4. In-video quiz / checkpoint auto-progression.
 */

import { Logger } from '../utils/logger.js';
import { Helpers } from '../utils/helpers.js';

class CourseFlowController {
  constructor() {
    this.settings = null;
    this.isActive = false;
    this.scanInterval = null;
    this.lastClickedUrl = '';
    this.hasHandledReading = false;
    this.toastElement = null;

    this.checkFlow = this.checkFlow.bind(this);
  }

  /**
   * Start course flow monitoring
   */
  start(settings = {}) {
    this.stop();
    this.settings = settings;
    this.isActive = true;
    this.hasHandledReading = false;

    // Fast interval (every 800ms) to detect overlay buttons and reading pages
    this.scanInterval = setInterval(this.checkFlow, 800);

    // Initial check
    this.checkFlow();

    Logger.info('CourseFlowController active: watching for Start cards, readings, and video autoplay.');
  }

  stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isActive = false;
    this.hideToast();
  }

  /**
   * Master polling loop
   */
  checkFlow() {
    if (!this.isActive) return;

    // 1. Check for post-video "Start" overlay card button (shown in user's screenshot)
    if (this.settings?.autoClickStartOverlay !== false) {
      this.detectAndClickStartOverlay();
    }

    // 2. Check for Coursera video autoplay
    if (this.settings?.autoPlayVideo !== false) {
      this.detectAndAutoplayVideo();
    }

    // 3. Check for Reading material "Mark as completed"
    if (this.settings?.autoCompleteReadings !== false) {
      this.detectAndCompleteReading();
    }

    // 4. Check for in-video questions / checkpoints
    if (this.settings?.autoSolveInVideoQuiz !== false) {
      this.detectInVideoCheckpoint();
    }
  }

  /**
   * 1. Detect and click the post-video "Start" card button
   * Seen when a Coursera video ends with a card: "Reading (20 min) - [ Start ] Pause"
   */
  detectAndClickStartOverlay() {
    // CRITICAL GUARD 1: Never click "Start" overlay while a video is actively playing!
    const activeVideo = document.querySelector('video');
    if (activeVideo && !activeVideo.ended && activeVideo.currentTime < Math.max(0, activeVideo.duration - 0.8)) {
      return false;
    }

    // CRITICAL GUARD 2: Never click "Start" overlay on quiz/exam pages
    if (
      window.location.href.includes('/quiz') ||
      window.location.href.includes('/exam') ||
      window.location.href.includes('/assignment') ||
      document.querySelector('[data-testid="quiz-container"], [data-testid="question-item"], .rc-QuizQuestion')
    ) {
      return false;
    }

    // Collect buttons inside overlay containers or with pause sibling
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'));

    for (const btn of buttons) {
      if (btn.offsetParent === null || btn.disabled) continue;

      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

      const isStartBtn = text === 'start' || text.startsWith('start ') || aria === 'start' || aria.startsWith('start ');

      if (isStartBtn) {
        const isInPlayerOrOverlay = btn.closest('.rc-VideoPlayer, .video-js, [data-testid*="video"], .c-video-overlay, div[role="dialog"], [class*="overlay" i], [class*="upNext" i], [class*="nextItem" i]') !== null;
        const parent = btn.parentElement;
        const hasPauseSibling = parent && (parent.textContent || '').toLowerCase().includes('pause');

        if (isInPlayerOrOverlay || hasPauseSibling) {
          Logger.info('Found Coursera post-video "Start" button overlay! Clicking now...');
          this.showToast('⏩ Auto-Clicking "Start" on next lesson...', 2000);
          btn.click();

          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 2. Detect video and trigger autoplay
   */
  detectAndAutoplayVideo() {
    const video = document.querySelector('video');
    if (!video) return;

    if (video.paused && !video.ended && video.readyState >= 1) {
      // Check for Coursera big play button overlay
      const playBtn = document.querySelector('button[aria-label="Play Video"], .vjs-big-play-button, button[data-track-component="play_video"]');
      if (playBtn && playBtn.offsetParent !== null) {
        playBtn.click();
        Logger.info('Clicked Coursera big play button overlay.');
      }

      video.play().catch(() => {
        // Fallback: click document to trigger play
        const resumeOnClick = () => {
          video.play().catch(() => {});
          document.removeEventListener('click', resumeOnClick);
        };
        document.addEventListener('click', resumeOnClick, { once: true });
      });
    }
  }

  /**
   * 3. Detect Coursera Reading material and interactive exercises and mark as completed
   */
  detectAndCompleteReading() {
    // Avoid re-running multiple times on same item page
    if (this.hasHandledReading && this.lastClickedUrl === window.location.href) {
      return;
    }

    // CRITICAL GUARD: Never auto-complete or advance if video is active or in a quiz
    const activeVideo = document.querySelector('video');
    if (activeVideo && !activeVideo.ended) return;

    if (
      window.location.href.includes('/quiz') ||
      window.location.href.includes('/exam') ||
      window.location.href.includes('/assignment') ||
      document.querySelector('[data-testid="quiz-container"], [data-testid="question-item"], .rc-QuizQuestion, [data-testid*="quiz" i]')
    ) {
      return;
    }

    // Look for genuine "Mark as completed" or "Mark as complete" or "Finish" button
    const completeButtons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="button"], input[type="submit"]'));
    const markCompleteBtn = completeButtons.find(btn => {
      if (btn.offsetParent === null && btn.offsetWidth === 0) return false;
      if (btn.disabled || btn.hasAttribute('disabled')) return false;
      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tid = (btn.getAttribute('data-testid') || '').toLowerCase();

      if (text === 'completed' || aria === 'completed') return false;

      return (
        text === 'mark as completed' ||
        text === 'mark as complete' ||
        text === 'mark as read' ||
        text === 'finish' ||
        text === 'finish and continue' ||
        text.includes('finish and continue') ||
        text.includes('i understand') ||
        text.includes("i'm done") ||
        tid === 'mark-complete' ||
        tid === 'mark-as-completed' ||
        aria === 'mark as completed' ||
        aria === 'mark as complete'
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
      this.hasHandledReading = true;
      this.lastClickedUrl = window.location.href;

      Logger.info('Found "Mark as completed" button on item/exercise. Clicking...');
      this.showToast('📖 Item/Exercise: Marking as completed...', 2500);

      try {
        markCompleteBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {}

      setTimeout(() => {
        markCompleteBtn.click();
        markCompleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // Advance to next lesson after delay
        const delay = (this.settings?.autoAdvanceReadingDelaySec || 3) * 1000;
        this.showToast(`✅ Item completed! Advancing to next item in ${this.settings?.autoAdvanceReadingDelaySec || 3}s...`, delay);

        setTimeout(() => {
          this.advanceToNextLesson();
        }, delay);
      }, 1000);
    } else if (widgetContinueBtn && !this.hasHandledReading) {
      Logger.info('Found widget Continue button. Clicking to progress exercise...');
      widgetContinueBtn.click();
    }
  }

  /**
   * 4. Detect in-video quiz / checkpoint popups that halt video playback
   */
  detectInVideoCheckpoint() {
    const inVideoDialog = document.querySelector('.rc-InVideoOverlay, .rc-InVideoQuiz, [data-testid="in-video-quiz"]');
    if (!inVideoDialog || inVideoDialog.offsetParent === null) return;

    // Look for continue or submit button
    const actionBtn = inVideoDialog.querySelector('button[type="submit"], button:has-text("Continue"), button:has-text("Skip"), button:has-text("Submit")') ||
      Array.from(inVideoDialog.querySelectorAll('button')).find(b => {
        const t = (b.textContent || '').toLowerCase();
        return t.includes('continue') || t.includes('skip') || t.includes('submit');
      });

    // If options exist, select the first or best option
    const radio = inVideoDialog.querySelector('input[type="radio"], [role="radio"]');
    if (radio && !radio.checked) {
      radio.click();
    }

    if (actionBtn && actionBtn.offsetParent !== null) {
      Logger.info('In-video checkpoint detected. Auto-continuing video...');
      this.showToast('⏩ In-Video Checkpoint: Auto-continuing...', 1500);
      actionBtn.click();
    }
  }

  /**
   * Advance to next lesson using Universal Heuristics
   */
  advanceToNextLesson() {
    const nextBtn = Helpers.findNextLessonButton();
    if (nextBtn) {
      this.showToast('🚀 Advancing to next lesson...', 2000);
      nextBtn.click();
      nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      Logger.info('Advanced to next lesson button successfully.');
    } else {
      Logger.debug('No next lesson button found.');
    }
  }

  /**
   * Toast Notification
   */
  showToast(message, durationMs = 2000) {
    this.hideToast();

    this.toastElement = document.createElement('div');
    this.toastElement.className = 'cca-flow-toast';
    this.toastElement.style.cssText = `
      position: fixed;
      bottom: 28px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(14px);
      color: #38bdf8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      font-weight: 700;
      padding: 10px 22px;
      border-radius: 9999px;
      border: 1px solid rgba(56, 189, 248, 0.4);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      gap: 10px;
      pointer-events: none;
      animation: cca-pop-toast 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    `;

    this.toastElement.textContent = message;
    document.body.appendChild(this.toastElement);

    if (durationMs > 0) {
      setTimeout(() => this.hideToast(), durationMs);
    }
  }

  hideToast() {
    if (this.toastElement && this.toastElement.parentNode) {
      this.toastElement.parentNode.removeChild(this.toastElement);
      this.toastElement = null;
    }
  }
}

export const courseFlow = new CourseFlowController();
