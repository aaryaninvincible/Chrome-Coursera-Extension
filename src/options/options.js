/**
 * Options Controller Script
 * Course Completion Assistant
 */

import { storageManager } from '../storage/storage-manager.js';
import { DEFAULT_SETTINGS, DEFAULT_METRICS } from '../storage/state-schema.js';
import { Scheduler } from '../utils/scheduler.js';

let settings = null;

// Element References
const optActiveEnabled = document.getElementById('opt-active-enabled');
const optWakeLock = document.getElementById('opt-wake-lock');
const optSpoofVisibility = document.getElementById('opt-spoof-visibility');
const optPreventBlur = document.getElementById('opt-prevent-blur');
const optIntervalSelect = document.getElementById('opt-interval-select');

const optDefaultSpeed = document.getElementById('opt-default-speed');
const optAutoPlay = document.getElementById('opt-auto-play');
const optAutoNext = document.getElementById('opt-auto-next');
const optAutoSeekIntro = document.getElementById('opt-auto-seek-intro');
const optIntroSeconds = document.getElementById('opt-intro-seconds');

const optUnlockRightClick = document.getElementById('opt-unlock-right-click');
const optUnlockCopy = document.getElementById('opt-unlock-copy');
const optUnlockShortcuts = document.getElementById('opt-unlock-shortcuts');

const inputDomain = document.getElementById('input-domain');
const btnAddDomain = document.getElementById('btn-add-domain');
const optionsDomainList = document.getElementById('options-domain-list');

const btnExportSettings = document.getElementById('btn-export-settings');
const btnImportSettings = document.getElementById('btn-import-settings');
const inputFileImport = document.getElementById('input-file-import');
const btnResetMetrics = document.getElementById('btn-reset-metrics');
const btnResetAll = document.getElementById('btn-reset-all');
const saveToast = document.getElementById('save-toast');

async function init() {
  settings = await storageManager.getSettings();
  populateUI();
  bindEvents();
}

function populateUI() {
  if (!settings) return;

  // Active Mode
  optActiveEnabled.checked = !!settings.activeMode?.enabled;
  optWakeLock.checked = !!settings.activeMode?.screenWakeLock;
  optSpoofVisibility.checked = !!settings.activeMode?.spoofVisibility;
  optPreventBlur.checked = !!settings.activeMode?.preventWindowBlur;
  optIntervalSelect.value = String(settings.activeMode?.intervalSeconds || 60);

  // Media
  optDefaultSpeed.value = String(settings.mediaEnhancement?.defaultPlaybackSpeed || 1.5);
  optAutoPlay.checked = !!settings.mediaEnhancement?.autoPlay;
  optAutoNext.checked = !!settings.mediaEnhancement?.autoNext;
  optAutoSeekIntro.checked = !!settings.mediaEnhancement?.autoSeekIntro;
  optIntroSeconds.value = String(settings.mediaEnhancement?.introSkipSeconds || 15);

  // Unlocker
  optUnlockRightClick.checked = !!settings.siteUnlocker?.enableRightClick;
  optUnlockCopy.checked = !!settings.siteUnlocker?.enableCopy;
  optUnlockShortcuts.checked = !!settings.siteUnlocker?.enableShortcuts;

  // Domains
  renderDomainChips();
}

function renderDomainChips() {
  optionsDomainList.innerHTML = '';
  const list = settings.activeMode?.whitelistedDomains || [];

  list.forEach(domain => {
    const chip = document.createElement('div');
    chip.className = 'domain-chip';
    chip.innerHTML = `
      <span>${domain}</span>
      <button class="chip-remove-btn" data-domain="${domain}" title="Remove">&times;</button>
    `;
    optionsDomainList.appendChild(chip);
  });
}

function bindEvents() {
  // Bind simple inputs
  const mapping = [
    [optActiveEnabled, (val) => ({ activeMode: { enabled: val } })],
    [optWakeLock, (val) => ({ activeMode: { screenWakeLock: val } })],
    [optSpoofVisibility, (val) => ({ activeMode: { spoofVisibility: val } })],
    [optPreventBlur, (val) => ({ activeMode: { preventWindowBlur: val } })],
    [optIntervalSelect, (val) => ({ activeMode: { intervalSeconds: parseInt(val, 10) } })],
    [optDefaultSpeed, (val) => ({ mediaEnhancement: { defaultPlaybackSpeed: parseFloat(val) } })],
    [optAutoPlay, (val) => ({ mediaEnhancement: { autoPlay: val } })],
    [optAutoNext, (val) => ({ mediaEnhancement: { autoNext: val } })],
    [optAutoSeekIntro, (val) => ({ mediaEnhancement: { autoSeekIntro: val } })],
    [optIntroSeconds, (val) => ({ mediaEnhancement: { introSkipSeconds: parseInt(val, 10) } })],
    [optUnlockRightClick, (val) => ({ siteUnlocker: { enableRightClick: val } })],
    [optUnlockCopy, (val) => ({ siteUnlocker: { enableCopy: val } })],
    [optUnlockShortcuts, (val) => ({ siteUnlocker: { enableShortcuts: val } })]
  ];

  mapping.forEach(([elem, transform]) => {
    elem.addEventListener('change', async () => {
      await Scheduler.yieldToMain();
      const val = elem.type === 'checkbox' ? elem.checked : elem.value;
      const update = transform(val);
      await storageManager.updateSettings(update);
      showToast('Settings saved');
    });
  });

  // Domain add
  btnAddDomain.addEventListener('click', addDomain);
  inputDomain.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDomain();
  });

  async function addDomain() {
    const domain = inputDomain.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    if (!domain) return;

    let list = [...(settings.activeMode.whitelistedDomains || [])];
    if (!list.includes(domain)) {
      list.push(domain);
      settings.activeMode.whitelistedDomains = list;
      await storageManager.updateSettings({ activeMode: { whitelistedDomains: list } });
      renderDomainChips();
      showToast(`Added ${domain}`);
    }
    inputDomain.value = '';
  }

  // Domain chip delete delegation
  optionsDomainList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('chip-remove-btn')) {
      const domain = e.target.dataset.domain;
      let list = settings.activeMode.whitelistedDomains.filter(d => d !== domain);
      settings.activeMode.whitelistedDomains = list;
      await storageManager.updateSettings({ activeMode: { whitelistedDomains: list } });
      renderDomainChips();
      showToast(`Removed ${domain}`);
    }
  });

  // Export JSON
  btnExportSettings.addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(settings, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `cca_settings_${Date.now()}.json`);
    dlAnchor.click();
  });

  // Import JSON
  btnImportSettings.addEventListener('click', () => inputFileImport.click());
  inputFileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const imported = JSON.parse(evt.target.result);
        settings = await storageManager.updateSettings(imported, true);
        populateUI();
        showToast('Settings imported successfully');
      } catch {
        alert('Invalid settings file format.');
      }
    };
    reader.readAsText(file);
  });

  // Reset Metrics
  btnResetMetrics.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all tracked learning statistics?')) {
      await storageManager.updateMetrics(() => JSON.parse(JSON.stringify(DEFAULT_METRICS)));
      showToast('Metrics reset');
    }
  });

  // Reset All
  btnResetAll.addEventListener('click', async () => {
    if (confirm('Are you sure you want to restore all settings and metrics to factory defaults?')) {
      await storageManager.updateSettings(DEFAULT_SETTINGS, true);
      await storageManager.updateMetrics(() => JSON.parse(JSON.stringify(DEFAULT_METRICS)));
      settings = await storageManager.getSettings();
      populateUI();
      showToast('All settings restored to factory defaults');
    }
  });
}

function showToast(msg) {
  saveToast.textContent = msg;
  saveToast.classList.add('show');
  setTimeout(() => saveToast.classList.remove('show'), 2000);
}

document.addEventListener('DOMContentLoaded', init);
