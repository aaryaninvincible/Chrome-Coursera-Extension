/**
 * Dashboard Script
 * Course Completion Assistant
 *
 * Implements:
 * - CSS Anchor Positioning Tab Indicator Routing
 * - Live Metrics and Accordion Telemetry Updates
 * - Native Dialog API Controllers
 * - Native Popover Tooltip Positioning
 * - WebAuthn Passkey Registration & Verification
 * - Security Audit Engine UI
 * - INP-Optimized Task Scheduling
 */

import { storageManager } from '../storage/storage-manager.js';
import { securityAuditor } from '../security/security-audit.js';
import { PasskeyAuth } from '../security/passkey-auth.js';
import { Helpers } from '../utils/helpers.js';
import { Scheduler } from '../utils/scheduler.js';
import { Logger } from '../utils/logger.js';

let state = {
  settings: null,
  metrics: null,
  activeTab: 'dashboard',
  isUnlockedWithPasskey: false
};

// DOM References
const tabItems = document.querySelectorAll('.tab-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const tabIndicator = document.getElementById('tab-active-indicator');
const pageTitle = document.getElementById('page-title');
const pageSubtitle = document.getElementById('page-subtitle');
const btnThemeToggle = document.getElementById('btn-theme-toggle');

// Modals
const dialogAddSite = document.getElementById('dialog-add-site');
const dialogSecurityAudit = document.getElementById('dialog-security-audit');
const dialogPasskeyPrompt = document.getElementById('dialog-passkey-prompt');

// Buttons & Forms
const btnAddSite = document.getElementById('btn-add-site');
const btnAuditNow = document.getElementById('btn-audit-now');
const formAddDomain = document.getElementById('form-add-domain');
const inputNewDomain = document.getElementById('input-new-domain');
const btnCloseAddDialog = document.getElementById('btn-close-add-dialog');
const btnCancelAddSite = document.getElementById('btn-cancel-add-site');
const btnCloseAuditDialog = document.getElementById('btn-close-audit-dialog');
const btnDoneAudit = document.getElementById('btn-done-audit');
const btnClosePasskeyDialog = document.getElementById('btn-close-passkey-dialog');
const btnCancelPasskey = document.getElementById('btn-cancel-passkey');
const btnTriggerPasskey = document.getElementById('btn-trigger-passkey');
const btnTogglePasskey = document.getElementById('btn-toggle-passkey');
const passkeyStatusLabel = document.getElementById('passkey-status-label');

// Initialize
async function init() {
  state.settings = await storageManager.getSettings();
  state.metrics = await storageManager.getMetrics();

  initTheme();
  initTabs();
  initDialogs();
  initPopovers();
  renderDashboard();
  renderSettings();
  bindEventHandlers();

  // Run initial lightweight security check
  refreshSecurityStatus();
}

/**
 * Tab Navigation & Anchor-Positioned Indicator
 */
function initTabs() {
  tabItems.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      setActiveTab(targetTab);
    });
  });

  // Position indicator initially
  updateTabIndicator();
  window.addEventListener('resize', Helpers.debounce(updateTabIndicator, 100));
}

function setActiveTab(tabId) {
  state.activeTab = tabId;

  tabItems.forEach(item => {
    const isActive = item.dataset.tab === tabId;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  tabPanes.forEach(pane => {
    const isTarget = pane.id === `tab-content-${tabId}`;
    pane.classList.toggle('active', isTarget);
  });

  // Update Page Title
  const titles = {
    dashboard: { title: 'Executive Learning Dashboard', subtitle: 'Real-time automation status, media metrics, and learning analytics' },
    courses: { title: 'Active Learning Platforms', subtitle: 'Curriculum history, video completion, and platform stats' },
    activity: { title: 'System Automation Audit Log', subtitle: 'Live event sequence of wake lock, heartbeats, and video advances' },
    settings: { title: 'Preferences & Security Controls', subtitle: 'Fine-tune automation behavior, speeds, and passkey authentication' }
  };

  if (titles[tabId]) {
    pageTitle.textContent = titles[tabId].title;
    pageSubtitle.textContent = titles[tabId].subtitle;
  }

  updateTabIndicator();
}

/**
 * Updates sliding indicator. Uses CSS Anchor Positioning where supported,
 * with fallback geometry for legacy browsers.
 */
function updateTabIndicator() {
  const activeBtn = document.querySelector(`.tab-item[data-tab="${state.activeTab}"]`);
  if (!activeBtn || !tabIndicator) return;

  // Support for modern CSS Anchor Positioning property
  if ('anchorName' in document.documentElement.style || CSS.supports('position-anchor', '--test')) {
    tabIndicator.style.positionAnchor = `--tab-${state.activeTab}`;
  } else {
    // Graceful geometry fallback
    const rect = activeBtn.getBoundingClientRect();
    const parentRect = activeBtn.parentElement.getBoundingClientRect();
    tabIndicator.style.top = `${rect.top - parentRect.top}px`;
    tabIndicator.style.height = `${rect.height}px`;
  }
}

/**
 * Render Main Dashboard View with Container Query Cards and Accordion
 */
function renderDashboard() {
  const { metrics, settings } = state;
  if (!metrics || !settings) return;

  // 1. Statistics Card
  const timeSavedEl = document.getElementById('dash-time-saved');
  if (timeSavedEl) timeSavedEl.textContent = Helpers.formatDuration(metrics.totalTimeSavedSeconds || 0);

  const videosCountEl = document.getElementById('dash-videos-count');
  if (videosCountEl) videosCountEl.textContent = metrics.watchedVideosCount || 0;

  const coursesCountEl = document.getElementById('dash-courses-count');
  if (coursesCountEl) coursesCountEl.textContent = metrics.recentCourses?.length || 0;

  // 2. Automation Card
  const toggleActiveMode = document.getElementById('dash-toggle-active-mode');
  if (toggleActiveMode) toggleActiveMode.checked = !!settings.activeMode?.enabled;

  const statusDot = document.getElementById('engine-status-dot');
  const statusText = document.getElementById('engine-status-text');
  if (settings.activeMode?.enabled) {
    if (statusDot) statusDot.className = 'indicator-pulse';
    if (statusText) statusText.textContent = 'Active Mode: Operational';
  } else {
    if (statusDot) statusDot.className = 'status-indicator';
    if (statusText) statusText.textContent = 'Active Mode: Standby';
  }

  // 3. Site Status / Whitelist Card
  renderWhitelistTags();
  const modeAllRadio = document.getElementById('mode-all');
  const modeWhitelistRadio = document.getElementById('mode-whitelist');
  if (settings.activeMode?.mode === 'whitelist_only') {
    if (modeWhitelistRadio) modeWhitelistRadio.checked = true;
  } else {
    if (modeAllRadio) modeAllRadio.checked = true;
  }

  // 4. Update Quick Presets active state
  const speed = settings.mediaEnhancement?.defaultPlaybackSpeed;
  const btnFast = document.getElementById('dash-preset-fast');
  const btnSmart = document.getElementById('dash-preset-smart');
  const btnStandard = document.getElementById('dash-preset-standard');
  if (btnFast) btnFast.classList.toggle('active', speed === 2);
  if (btnSmart) btnSmart.classList.toggle('active', speed === 1.5);
  if (btnStandard) btnStandard.classList.toggle('active', speed === 1);

  // 5. Session Card
  const sessionsCountEl = document.getElementById('dash-sessions-count');
  if (sessionsCountEl) sessionsCountEl.textContent = metrics.activeSessionsCount || 0;

  // 6. Accordion Components Telemetry
  renderAccordionTelemetry();
}

function renderWhitelistTags() {
  const container = document.getElementById('whitelist-tags');
  const caption = document.getElementById('whitelist-count-caption');
  if (!container) return;

  const domains = state.settings?.activeMode?.whitelistedDomains || [];
  if (caption) caption.textContent = `${domains.length} domains configured`;

  container.innerHTML = '';
  domains.forEach(domain => {
    const tag = document.createElement('span');
    tag.className = 'domain-tag';
    tag.innerHTML = `
      <span>${domain}</span>
      <button class="domain-remove-btn" data-domain="${domain}" title="Remove domain">&times;</button>
    `;
    container.appendChild(tag);
  });
}

function renderAccordionTelemetry() {
  const { metrics, settings } = state;

  // Watched Videos Accordion
  const pillVideos = document.getElementById('acc-pill-videos');
  if (pillVideos) pillVideos.textContent = `${metrics.watchedVideosCount || 0} completed`;

  const tableBody = document.getElementById('videos-table-body');
  if (tableBody && metrics.recentCourses?.length) {
    tableBody.innerHTML = '';
    metrics.recentCourses.slice(0, 10).forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.title}</strong></td>
        <td><span class="domain-tag">${item.domain}</span></td>
        <td><span class="summary-pill highlight">${item.playbackSpeed || 1.5}x</span></td>
        <td><span style="color: #10b981; font-weight: 600;">Recorded</span></td>
      `;
      tableBody.appendChild(tr);
    });
  }

  // Completed Courses Accordion
  const pillCourses = document.getElementById('acc-pill-courses');
  if (pillCourses) pillCourses.textContent = `${metrics.completedCoursesCount || 0} recorded`;

  // Time Saved Accordion
  const pillSaved = document.getElementById('acc-pill-saved');
  if (pillSaved) pillSaved.textContent = Helpers.formatDuration(metrics.totalTimeSavedSeconds || 0);

  const totalSavedText = document.getElementById('stats-total-saved');
  if (totalSavedText) totalSavedText.textContent = Helpers.formatDuration(metrics.totalTimeSavedSeconds || 0);

  const activeSpeedText = document.getElementById('stats-active-speed');
  if (activeSpeedText) activeSpeedText.textContent = `${settings.mediaEnhancement?.defaultPlaybackSpeed || 1.5}x`;

  // Active Sessions Diagnostics
  const diagInterval = document.getElementById('diag-interval');
  if (diagInterval) diagInterval.textContent = `${settings.activeMode?.intervalSeconds || 60} seconds`;
}

/**
 * Render Settings Tab
 */
function renderSettings() {
  const { settings } = state;
  if (!settings) return;

  // Active Mode
  const setActiveMode = document.getElementById('set-active-mode');
  if (setActiveMode) setActiveMode.checked = !!settings.activeMode?.enabled;

  const setWakeLock = document.getElementById('set-wake-lock');
  if (setWakeLock) setWakeLock.checked = !!settings.activeMode?.screenWakeLock;

  const setIntervalSelect = document.getElementById('set-interval-select');
  if (setIntervalSelect) setIntervalSelect.value = String(settings.activeMode?.intervalSeconds || 60);

  // Video
  const setDefaultSpeed = document.getElementById('set-default-speed');
  if (setDefaultSpeed) setDefaultSpeed.value = String(settings.mediaEnhancement?.defaultPlaybackSpeed || 1.5);

  const setAutoNext = document.getElementById('set-auto-next');
  if (setAutoNext) setAutoNext.checked = !!settings.mediaEnhancement?.autoNext;

  const setNextDelay = document.getElementById('set-next-delay');
  if (setNextDelay) setNextDelay.value = String(settings.mediaEnhancement?.autoNextDelaySeconds || 5);

  // Site Unlocker
  const setUnlockRightClick = document.getElementById('set-unlock-right-click');
  if (setUnlockRightClick) setUnlockRightClick.checked = !!settings.siteUnlocker?.enableRightClick;

  const setUnlockCopy = document.getElementById('set-unlock-copy');
  if (setUnlockCopy) setUnlockCopy.checked = !!settings.siteUnlocker?.enableCopy;

  const setUnlockShortcuts = document.getElementById('set-unlock-shortcuts');
  if (setUnlockShortcuts) setUnlockShortcuts.checked = !!settings.siteUnlocker?.enableShortcuts;

  // Course Flow & Quiz Assistant
  const setAutoStartOverlay = document.getElementById('set-auto-start-overlay');
  if (setAutoStartOverlay) setAutoStartOverlay.checked = settings.courseFlow?.autoClickStartOverlay !== false;

  const setAutoCompleteReadings = document.getElementById('set-auto-complete-readings');
  if (setAutoCompleteReadings) setAutoCompleteReadings.checked = settings.courseFlow?.autoCompleteReadings !== false;

  const setQuizAssistant = document.getElementById('set-quiz-assistant');
  if (setQuizAssistant) setQuizAssistant.checked = settings.quizAssistant?.enabled !== false;

  const setQuizHighlight = document.getElementById('set-quiz-highlight');
  if (setQuizHighlight) setQuizHighlight.checked = settings.quizAssistant?.highlightAnswers !== false;

  // Passkey Status
  const isProtected = settings.security?.passkeyProtected;
  if (passkeyStatusLabel) {
    passkeyStatusLabel.textContent = isProtected
      ? 'Passkey Protection: Active (Verified by WebAuthn)'
      : 'Passkey Protection: Disabled';
  }
  if (btnTogglePasskey) {
    btnTogglePasskey.textContent = isProtected ? 'Disable Passkey' : 'Set Up Passkey';
  }
}

/**
 * Dialog API Initialization & Focus Trap Handling
 */
function initDialogs() {
  // Add Site Dialog
  btnAddSite.addEventListener('click', () => {
    dialogAddSite.showModal();
  });

  const closeAdd = () => dialogAddSite.close();
  btnCloseAddDialog.addEventListener('click', closeAdd);
  btnCancelAddSite.addEventListener('click', closeAdd);

  formAddDomain.addEventListener('submit', async (e) => {
    e.preventDefault();
    const domain = inputNewDomain.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    if (domain) {
      let list = [...(state.settings.activeMode.whitelistedDomains || [])];
      if (!list.includes(domain)) {
        list.push(domain);
        state.settings.activeMode.whitelistedDomains = list;
        await storageManager.updateSettings({ activeMode: { whitelistedDomains: list } });
        renderWhitelistTags();
      }
    }
    inputNewDomain.value = '';
    dialogAddSite.close();
  });

  // Security Audit Dialog
  btnAuditNow.addEventListener('click', runSecurityAuditModal);
  const closeAudit = () => dialogSecurityAudit.close();
  btnCloseAuditDialog.addEventListener('click', closeAudit);
  btnDoneAudit.addEventListener('click', closeAudit);

  // Passkey Dialog
  const closePasskey = () => dialogPasskeyPrompt.close();
  btnClosePasskeyDialog.addEventListener('click', closePasskey);
  btnCancelPasskey.addEventListener('click', closePasskey);

  btnTogglePasskey.addEventListener('click', handlePasskeyToggle);
}

/**
 * Native Popover API Tooltip Positioning
 */
function initPopovers() {
  // Check if native Popover API is supported
  if (!HTMLElement.prototype.hasOwnProperty('popover')) {
    Logger.debug('Native Popover API polyfill mode active.');
  }
}

/**
 * Security Audit execution and rendering
 */
async function runSecurityAuditModal() {
  dialogSecurityAudit.showModal();
  const body = document.getElementById('audit-modal-body');
  body.innerHTML = '<div class="empty-state">Running security and permission audit...</div>';

  const report = await securityAuditor.runAudit(state.settings);

  let findingsHtml = report.findings.map(f => {
    const iconColor = f.severity === 'good' ? '#10b981' : f.severity === 'critical' ? '#ef4444' : '#f59e0b';
    return `
      <div style="display: flex; gap: 12px; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; margin-bottom: 8px;">
        <span style="color: ${iconColor}; font-weight: 800; font-size: 16px;">&bull;</span>
        <div>
          <strong style="font-size: 13px;">${f.title}</strong>
          <p style="font-size: 12px; color: var(--text-secondary); margin: 2px 0;">${f.description}</p>
          <span style="font-size: 11px; color: #38bdf8;">Recommendation: ${f.recommendation}</span>
        </div>
      </div>
    `;
  }).join('');

  body.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle);">
      <div>
        <h4 style="font-size: 16px; font-weight: 800;">Extension Health Score</h4>
        <span style="font-size: 12px; color: var(--text-secondary);">Manifest V3 Security Compliance</span>
      </div>
      <div class="sec-score-ring" style="width: 48px; height: 48px; font-size: 18px;">
        ${report.score}
      </div>
    </div>
    <div style="max-height: 280px; overflow-y: auto;">
      ${findingsHtml}
    </div>
  `;

  // Update sidebar score
  const sidebarScore = document.getElementById('sidebar-sec-score');
  if (sidebarScore) sidebarScore.textContent = report.score;
}

async function refreshSecurityStatus() {
  const report = await securityAuditor.runAudit(state.settings);
  const sidebarScore = document.getElementById('sidebar-sec-score');
  if (sidebarScore) sidebarScore.textContent = report.score;
}

/**
 * Passkey Management using WebAuthn
 */
async function handlePasskeyToggle() {
  const isProtected = state.settings.security?.passkeyProtected;

  if (isProtected) {
    // Prompt to verify before disabling
    dialogPasskeyPrompt.showModal();
    btnTriggerPasskey.onclick = async () => {
      try {
        await PasskeyAuth.verifyPasskey(state.settings.security.passkeyCredentialId);
        state.settings.security.passkeyProtected = false;
        state.settings.security.passkeyCredentialId = null;
        await storageManager.updateSettings({ security: state.settings.security });
        dialogPasskeyPrompt.close();
        renderSettings();
      } catch (err) {
        showPasskeyError(err.message);
      }
    };
  } else {
    // Register new passkey
    dialogPasskeyPrompt.showModal();
    const desc = document.getElementById('passkey-prompt-desc');
    if (desc) desc.textContent = 'Touch your fingerprint sensor, use Windows Hello, or insert a security key to register this device.';

    btnTriggerPasskey.onclick = async () => {
      try {
        const regResult = await PasskeyAuth.registerPasskey('CCA User');
        state.settings.security.passkeyProtected = true;
        state.settings.security.passkeyCredentialId = regResult.credentialId;
        state.settings.security.registeredAt = regResult.registeredAt;
        await storageManager.updateSettings({ security: state.settings.security });
        dialogPasskeyPrompt.close();
        renderSettings();
      } catch (err) {
        showPasskeyError(err.message);
      }
    };
  }
}

function showPasskeyError(msg) {
  const errBox = document.getElementById('passkey-error-msg');
  if (errBox) {
    errBox.textContent = `Authentication error: ${msg}`;
    errBox.style.display = 'block';
  }
}

/**
 * Global Event Handlers
 */
function bindEventHandlers() {
  // Whitelist remove tag delegation
  document.addEventListener('click', async (e) => {
    if (e.target.classList.contains('domain-remove-btn')) {
      const domain = e.target.dataset.domain;
      let list = state.settings.activeMode.whitelistedDomains.filter(d => d !== domain);
      state.settings.activeMode.whitelistedDomains = list;
      await storageManager.updateSettings({ activeMode: { whitelistedDomains: list } });
      renderWhitelistTags();
    }
  });

  // Master Active switch on dashboard card
  const toggleActive = document.getElementById('dash-toggle-active-mode');
  if (toggleActive) {
    toggleActive.addEventListener('change', async (e) => {
      state.settings.activeMode.enabled = e.target.checked;
      await storageManager.updateSettings({ activeMode: { enabled: e.target.checked } });
      renderDashboard();
    });
  }

  // Quick Preset Buttons
  const btnFast = document.getElementById('dash-preset-fast');
  const btnSmart = document.getElementById('dash-preset-smart');
  const btnStandard = document.getElementById('dash-preset-standard');

  const applyPreset = async (speed, autoNext, active) => {
    state.settings.mediaEnhancement.defaultPlaybackSpeed = speed;
    state.settings.mediaEnhancement.autoNext = autoNext;
    state.settings.activeMode.enabled = active;
    await storageManager.updateSettings({
      mediaEnhancement: { defaultPlaybackSpeed: speed, autoNext },
      activeMode: { enabled: active }
    });
    renderDashboard();
    renderSettings();
  };

  if (btnFast) btnFast.addEventListener('click', () => applyPreset(2.0, true, true));
  if (btnSmart) btnSmart.addEventListener('click', () => applyPreset(1.5, true, true));
  if (btnStandard) btnStandard.addEventListener('click', () => applyPreset(1.0, false, false));

  // Site Mode Radio
  const modeRadios = document.querySelectorAll('input[name="site-mode"]');
  modeRadios.forEach(r => {
    r.addEventListener('change', async (e) => {
      state.settings.activeMode.mode = e.target.value;
      await storageManager.updateSettings({ activeMode: { mode: e.target.value } });
    });
  });

  // Settings change delegation with INP optimization
  const changeHandlers = {
    'set-active-mode': (val) => ({ activeMode: { enabled: val } }),
    'set-wake-lock': (val) => ({ activeMode: { screenWakeLock: val } }),
    'set-interval-select': (val) => ({ activeMode: { intervalSeconds: parseInt(val, 10) } }),
    'set-default-speed': (val) => ({ mediaEnhancement: { defaultPlaybackSpeed: parseFloat(val) } }),
    'set-auto-next': (val) => ({ mediaEnhancement: { autoNext: val } }),
    'set-next-delay': (val) => ({ mediaEnhancement: { autoNextDelaySeconds: parseInt(val, 10) } }),
    'set-unlock-right-click': (val) => ({ siteUnlocker: { enableRightClick: val } }),
    'set-unlock-copy': (val) => ({ siteUnlocker: { enableCopy: val } }),
    'set-unlock-shortcuts': (val) => ({ siteUnlocker: { enableShortcuts: val } }),
    'set-auto-start-overlay': (val) => ({ courseFlow: { autoClickStartOverlay: val } }),
    'set-auto-complete-readings': (val) => ({ courseFlow: { autoCompleteReadings: val } }),
    'set-quiz-assistant': (val) => ({ quizAssistant: { enabled: val } }),
    'set-quiz-highlight': (val) => ({ quizAssistant: { highlightAnswers: val } })
  };

  Object.entries(changeHandlers).forEach(([id, transform]) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', async () => {
        await Scheduler.yieldToMain();
        const value = el.type === 'checkbox' ? el.checked : el.value;
        const updateObj = transform(value);
        await storageManager.updateSettings(updateObj);
      });
    }
  });
}

function initTheme() {
  const savedTheme = localStorage.getItem('cca-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  btnThemeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('cca-theme', next);
  });
}

// Start
document.addEventListener('DOMContentLoaded', init);
