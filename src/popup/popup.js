/**
 * Easy-UI Popup Controller
 * Course Completion Assistant
 */

import { storageManager } from '../storage/storage-manager.js';
import { Helpers } from '../utils/helpers.js';

let currentTab = null;
let currentDomain = '';
let settings = null;
let metrics = null;

// DOM Elements
const currentDomainEl = document.getElementById('current-domain');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusSubtext = document.getElementById('status-subtext');
const toggleActiveMode = document.getElementById('toggle-active-mode');

const speedDisplay = document.getElementById('speed-display');
const speedChips = document.querySelectorAll('.chip');

const toggleAutoNext = document.getElementById('toggle-auto-next');
const toggleAutoPlay = document.getElementById('toggle-auto-play');
const toggleUnlockSite = document.getElementById('toggle-unlock-site');
const toggleWakeLock = document.getElementById('toggle-wake-lock');
const toggleCourseFlow = document.getElementById('toggle-course-flow');
const toggleFastComplete = document.getElementById('toggle-fast-complete');
const toggleQuizAssistant = document.getElementById('toggle-quiz-assistant');
const toggleAutoRetryQuiz = document.getElementById('toggle-auto-retry-quiz');

const presetFast = document.getElementById('preset-fast');
const presetBalanced = document.getElementById('preset-balanced');
const presetNormal = document.getElementById('preset-normal');

const statVideos = document.getElementById('stat-videos');
const statTimeSaved = document.getElementById('stat-time-saved');

const btnOpenDashboard = document.getElementById('btn-open-dashboard');
const btnOpenOptions = document.getElementById('btn-open-options');
const btnQuickWhitelist = document.getElementById('btn-quick-whitelist');

// Speculative prefetching
function prefetchUrl(url) {
  if (!document.querySelector(`link[href="${url}"]`)) {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    document.head.appendChild(link);
  }
}

async function init() {
  // 1. Get active tab
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
    if (currentTab && currentTab.url) {
      currentDomain = Helpers.extractDomain(currentTab.url);
      currentDomainEl.textContent = currentDomain || 'Active Learning Tab';
    }
  }

  // 2. Fetch state
  settings = await storageManager.getSettings();
  metrics = await storageManager.getMetrics();

  renderUI();
  bindEvents();
}

function renderUI() {
  if (!settings || !metrics) return;

  // Active status
  const isWhitelisted = settings.activeMode.whitelistedDomains.includes(currentDomain);
  const isActive = settings.activeMode.enabled && (settings.activeMode.mode === 'all' || isWhitelisted);

  toggleActiveMode.checked = settings.activeMode.enabled;
  if (isActive) {
    statusDot.className = 'status-indicator active';
    statusText.textContent = 'Always Active: ON';
    statusSubtext.textContent = 'Tab never pauses on switch';
  } else {
    statusDot.className = 'status-indicator';
    statusText.textContent = 'Always Active: Paused';
    statusSubtext.textContent = settings.activeMode.mode === 'whitelist_only' && !isWhitelisted
      ? 'Site not on whitelist'
      : 'Automation currently paused';
  }

  // Speed chips
  const currentSpeed = settings.mediaEnhancement.defaultPlaybackSpeed || 1.5;
  speedDisplay.textContent = `${currentSpeed}x`;
  speedChips.forEach(chip => {
    const chipSpeed = parseFloat(chip.dataset.speed);
    chip.classList.toggle('active', chipSpeed === currentSpeed);
  });

  // Toggles
  toggleAutoNext.checked = !!settings.mediaEnhancement.autoNext;
  toggleAutoPlay.checked = !!settings.mediaEnhancement.autoPlay;
  toggleUnlockSite.checked = !!settings.siteUnlocker.enabled;
  toggleWakeLock.checked = !!settings.activeMode.screenWakeLock;
  if (toggleCourseFlow) toggleCourseFlow.checked = settings.courseFlow?.enabled !== false;
  if (toggleFastComplete) toggleFastComplete.checked = !!settings.courseFlow?.autoFastCompleteVideo;
  if (toggleQuizAssistant) toggleQuizAssistant.checked = settings.quizAssistant?.enabled !== false;
  if (toggleAutoRetryQuiz) toggleAutoRetryQuiz.checked = settings.quizAssistant?.autoSubmitAndRetry !== false;

  // Stats
  statVideos.textContent = metrics.watchedVideosCount || 0;
  statTimeSaved.textContent = Helpers.formatDuration(metrics.totalTimeSavedSeconds || 0);

  // Whitelist button
  if (currentDomain) {
    if (isWhitelisted) {
      btnQuickWhitelist.textContent = '✓ Whitelisted';
      btnQuickWhitelist.style.background = 'rgba(16, 185, 129, 0.15)';
      btnQuickWhitelist.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      btnQuickWhitelist.style.color = '#34d399';
    } else {
      btnQuickWhitelist.textContent = '+ Whitelist Site';
      btnQuickWhitelist.style.background = '';
      btnQuickWhitelist.style.borderColor = '';
      btnQuickWhitelist.style.color = '';
    }
  } else {
    btnQuickWhitelist.style.display = 'none';
  }
}

function bindEvents() {
  // Master Active Toggle
  toggleActiveMode.addEventListener('change', async (e) => {
    settings.activeMode.enabled = e.target.checked;
    await storageManager.updateSettings({ activeMode: { enabled: e.target.checked } });
    renderUI();
  });

  // Speed Chips
  speedChips.forEach(chip => {
    chip.addEventListener('click', async () => {
      const speed = parseFloat(chip.dataset.speed);
      await applySpeed(speed);
    });
  });

  // Quick Presets
  presetFast.addEventListener('click', async () => {
    await applyPreset(2.0, true, true);
  });

  presetBalanced.addEventListener('click', async () => {
    await applyPreset(1.5, true, true);
  });

  presetNormal.addEventListener('click', async () => {
    await applyPreset(1.0, false, false);
  });

  async function applySpeed(speed) {
    settings.mediaEnhancement.defaultPlaybackSpeed = speed;
    renderUI();
    await storageManager.updateSettings({
      mediaEnhancement: { defaultPlaybackSpeed: speed }
    }, true);
  }

  async function applyPreset(speed, autoNext, activeMode) {
    settings.mediaEnhancement.defaultPlaybackSpeed = speed;
    settings.mediaEnhancement.autoNext = autoNext;
    settings.activeMode.enabled = activeMode;
    renderUI();

    await storageManager.updateSettings({
      mediaEnhancement: { defaultPlaybackSpeed: speed, autoNext },
      activeMode: { enabled: activeMode }
    }, true);
  }

  // Feature Toggles
  toggleAutoNext.addEventListener('change', async (e) => {
    await storageManager.updateSettings({ mediaEnhancement: { autoNext: e.target.checked } });
  });

  toggleAutoPlay.addEventListener('change', async (e) => {
    await storageManager.updateSettings({ mediaEnhancement: { autoPlay: e.target.checked } });
  });

  toggleUnlockSite.addEventListener('change', async (e) => {
    await storageManager.updateSettings({ siteUnlocker: { enabled: e.target.checked } });
  });

  toggleWakeLock.addEventListener('change', async (e) => {
    await storageManager.updateSettings({ activeMode: { screenWakeLock: e.target.checked } });
  });

  if (toggleCourseFlow) {
    toggleCourseFlow.addEventListener('change', async (e) => {
      await storageManager.updateSettings({ courseFlow: { enabled: e.target.checked } });
    });
  }

  if (toggleFastComplete) {
    toggleFastComplete.addEventListener('change', async (e) => {
      await storageManager.updateSettings({ courseFlow: { autoFastCompleteVideo: e.target.checked } });
    });
  }

  if (toggleQuizAssistant) {
    toggleQuizAssistant.addEventListener('change', async (e) => {
      await storageManager.updateSettings({ quizAssistant: { enabled: e.target.checked } });
    });
  }

  if (toggleAutoRetryQuiz) {
    toggleAutoRetryQuiz.addEventListener('change', async (e) => {
      await storageManager.updateSettings({ quizAssistant: { autoSubmitAndRetry: e.target.checked } });
    });
  }

  // Whitelist Toggle
  btnQuickWhitelist.addEventListener('click', async () => {
    if (!currentDomain) return;
    let list = [...settings.activeMode.whitelistedDomains];
    if (list.includes(currentDomain)) {
      list = list.filter(d => d !== currentDomain);
    } else {
      list.push(currentDomain);
    }
    settings.activeMode.whitelistedDomains = list;
    await storageManager.updateSettings({ activeMode: { whitelistedDomains: list } });
    renderUI();
  });

  // Open Full Dashboard
  const dashboardUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('src/dashboard/dashboard.html') : 'dashboard.html';
  btnOpenDashboard.addEventListener('mouseenter', () => prefetchUrl(dashboardUrl));
  btnOpenDashboard.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: dashboardUrl });
    } else {
      window.open(dashboardUrl, '_blank');
    }
  });

  // Open Preferences
  const optionsUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('src/options/options.html') : 'options.html';
  btnOpenOptions.addEventListener('mouseenter', () => prefetchUrl(optionsUrl));
  btnOpenOptions.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(optionsUrl, '_blank');
    }
  });

  // Portfolio Link
  const portfolioLink = document.getElementById('portfolio-link');
  if (portfolioLink) {
    portfolioLink.addEventListener('click', (e) => {
      e.preventDefault();
      const url = 'https://aryaninvincible-portfolio.vercel.app';
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url });
      } else {
        window.open(url, '_blank');
      }
    });
  }

  // Gemini API Key Handler
  const DEFAULT_GEMINI_KEY = '';
  const BACKUP_GEMINI_KEYS = [];
  const inputGeminiKey = document.getElementById('input-gemini-key');
  const btnSaveGeminiKey = document.getElementById('btn-save-gemini-key');
  if (inputGeminiKey) {
    chrome.storage.local.get(['gemini_api_key'], (res) => {
      if (res && res.gemini_api_key && res.gemini_api_key.trim()) {
        inputGeminiKey.value = res.gemini_api_key.trim();
      } else {
        inputGeminiKey.value = DEFAULT_GEMINI_KEY;
        chrome.storage.local.set({ gemini_api_key: DEFAULT_GEMINI_KEY });
      }
    });
  }
  if (btnSaveGeminiKey && inputGeminiKey) {
    btnSaveGeminiKey.addEventListener('click', () => {
      const val = inputGeminiKey.value.trim() || DEFAULT_GEMINI_KEY;
      chrome.storage.local.set({ gemini_api_key: val }, () => {
        btnSaveGeminiKey.textContent = 'Saved!';
        btnSaveGeminiKey.style.background = '#10b981';
        setTimeout(() => {
          btnSaveGeminiKey.textContent = 'Save';
          btnSaveGeminiKey.style.background = '';
        }, 1500);
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
