# Course Completion Assistant (Manifest V3)

> Enterprise-grade Chrome Extension for online learners (Coursera, Udemy, edX, Canvas, YouTube) featuring Always Active window persistence, universal media acceleration, site unlocking, passkey security, and a modern dashboard built with bleeding-edge Web Platform APIs.

---

## Architecture Overview

```
c:\Users\aryan\Desktop\Chrome Coursera Extension\
├── manifest.json                     # Strict Manifest V3 configuration
├── icons/                            # Standard PNG extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── background/
│   │   └── service-worker.js         # Lifecycle router, tab state observer, badge updater
│   ├── content/
│   │   ├── content-isolated.js       # Content script (Isolated World) orchestrating controllers
│   │   └── page-script.js            # Main World injection neutralizing visibility & blur traps
│   ├── popup/
│   │   ├── popup.html                # Fast glassmorphic quick-action popup
│   │   ├── popup.css                 # Modern CSS variables, container queries, micro-animations
│   │   └── popup.js                  # Quick toggles (Speed, Active Mode, Whitelist, Auto-Next)
│   ├── dashboard/
│   │   ├── dashboard.html            # Executive Learning Management Dashboard
│   │   ├── dashboard.css             # Anchor positioning, container queries, @starting-style
│   │   └── dashboard.js              # Telemetry calculation, audit modal, WebAuthn passkeys
│   ├── options/
│   │   ├── options.html              # Comprehensive preference configuration UI
│   │   ├── options.css               # Preference styling & domain chip management
│   │   └── options.js                # Import/export configuration & metrics reset
│   ├── storage/
│   │   ├── storage-manager.js        # Debounced, schema-validated chrome.storage.local wrapper
│   │   └── state-schema.js           # Default settings & metric tracking structures
│   ├── security/
│   │   ├── security-audit.js         # Built-in CSP, permissions, and storage auditor
│   │   └── passkey-auth.js           # WebAuthn (FIDO2/Passkey) biometric profile authentication
│   ├── automation/
│   │   ├── wake-lock.js              # Screen Wake Lock API controller with auto-reconnect
│   │   ├── activity-simulator.js     # Non-intrusive synthetic idle pulse & dialog auto-dismisser
│   │   ├── media-controller.js       # Universal HTML5 video engine (1x-5x, auto-next, intro skip)
│   │   └── site-unlocker.js          # Unblock contextmenu, text selection, copy & devtools keys
│   └── utils/
│       ├── scheduler.js              # INP task scheduling (scheduler.yield() & requestIdleCallback)
│       ├── logger.js                 # Structured logger with debug gate
│       └── helpers.js                # Time formatting, heuristic button matching & DOM queries
```

---

## Core Capabilities

### 1. Always Active Window & Inactivity Prevention
- **Visibility Spoofing (`page-script.js`)**: Overrides `document.visibilityState`, `document.webkitVisibilityState`, `document.hidden`, and `document.webkitHidden` in the Main World so online course players never detect that you switched tabs or minimized the browser.
- **Blur Prevention**: Overrides `Document.prototype.hasFocus` to constantly report true and neutralizes `window.blur`, `mouseleave`, and `mouseout` events.
- **Background Render Loop Preservation**: Proxies `window.requestAnimationFrame` with a 16ms fallback timer while the tab is hidden, preventing course video engines and interactive timers from freezing.
- **Screen Wake Lock API**: Holds `navigator.wakeLock.request('screen')` to keep the display active and prevent workstation lock screens during long lectures.
- **Anti-Idle Heartbeat**: Simulates gentle, non-disruptive micro events (mouse/key pulse) every 60 seconds (configurable) and automatically clicks "Are you still watching?" confirmation prompts.

### 2. Universal Media Enhancement System
- **Speed Multipliers**: Seamlessly switches between `1.0x`, `1.25x`, `1.5x`, `1.75x`, `2.0x`, `2.5x`, `3.0x`, `4.0x`, and `5.0x` speeds. Works on standard HTML5 players, Coursera custom players, Udemy, edX, Canvas, and embedded YouTube/Vimeo players.
- **Keyboard Hotkeys**: Press `]` to increase speed, `[` to decrease speed, and `\` to reset to `1.0x`.
- **Auto Play & Auto Resume**: Automatically triggers video playback upon entering lessons and recovers from stalls.
- **Auto Next**: Automatically finds the "Next Item", "Next Lecture", or "Next Lesson" navigation button upon video completion and advances after a configurable buffer delay (with an on-screen cancel countdown toast).
- **Auto Seek Intro**: Automatically skips course introduction jingles (configurable default: 15 seconds).
- **Telemetry & Productivity Calculation**: Computes time saved against a 1.0x baseline, tracks completion count, and records recent course sessions.

### 3. Unlock Restricted Websites
- **Right-Click**: Removes `contextmenu` blockers and restores native browser menus.
- **Text Selection**: Overrides CSS `user-select: none !important` and allows clean selection of lecture transcripts and code blocks.
- **Clipboard Access**: Bypasses `copy`, `cut`, and `selectstart` interception.
- **Restores Shortcuts**: Restores Ctrl+C, Ctrl+V, Ctrl+A, Ctrl+F, and developer keys (F12, Ctrl+Shift+I).

### 4. Course Flow Automation (Auto "Start" Click & Reading Completion)
- **Auto-Click "Start" Next Item Card**: Automatically detects and clicks Coursera's post-video overlay card button (`[ Start ]`) when videos finish, so you never have to click it manually.
- **Aggressive Video Autoplay**: Automatically clicks the Coursera big play button and triggers `video.play()` as soon as lecture pages load.
- **Reading Material Auto-Completion**: Automatically detects Coursera reading items (`/supplement/`, `/reading/`), smoothly scrolls through the content, clicks **"Mark as completed"**, and advances to the next lecture automatically.
- **In-Video Checkpoint Auto-Continue**: Automatically dismisses in-video practice questions so video playback proceeds uninterrupted.

### 5. Quiz Assistant & Side Answers
- **Floating Quiz Assistant Sidebar**: Automatically slides in on Coursera quiz and assessment pages.
- **Answers at Side**: Extracts all questions and options, computes the most probable answers with confidence ratings, and presents them in an easy-to-read right-hand sidebar.
- **1-Click Auto-Select All**: Automatically selects the best answers directly into the quiz with one click.
- **In-Page Option Highlighting**: Highlights recommended options directly in the Coursera form in emerald green with a checkmark badge (`✨ CCA Recommended`).
- **Copy Quiz Questions**: Copies all questions and choices formatted for fast review.

### 6. Modern Web Platform Guidance & Best Practices
- **CSS Anchor Positioning**: Used on the tab bar in the dashboard to animate the sliding active indicator (`anchor-name`, `position-anchor`, `anchor(left)`, `anchor(right)`) without recalculating JavaScript geometry.
- **CSS Container Queries**: Dashboard cards adapt their internal typography and metric column counts based on their own inline size (`container-type: inline-size; @container card (min-width: 340px)`).
- **Native `<dialog>` API**: Replaces third-party modal bloat with native `<dialog>` elements styled with `@starting-style` transitions, backdrop blur filters, and accessible focus management.
- **Native Popover API**: Utilizes `popover="auto"` for tooltips without any external UI libraries.
- **Interaction to Next Paint (INP) Scheduling**: Uses `scheduler.yield()` and `requestIdleCallback` to chunk tasks and avoid blocking the main thread.
- **Speculative Hover Prefetching**: Prefetches extension pages when hovering over action buttons.

### 5. Enterprise Security & Passkey Authentication
- **Manifest V3 CSP**: Strict Content Security Policy (`script-src 'self'; object-src 'self'`) with zero `unsafe-inline` or `unsafe-eval`.
- **Security Audit Module**: In-dashboard audit engine evaluates declared permissions, URL scopes, storage usage, and CSP compliance, generating an interactive security score.
- **WebAuthn Passkey Support**: Optional local profile protection using Windows Hello, Touch ID, or FIDO2 security keys (`navigator.credentials.create` & `get`) to secure extension settings.

---

## Installation Guide

1. Clone or download this repository to your local machine:
   `c:\Users\aryan\Desktop\Chrome Coursera Extension`
2. Open Google Chrome (or Chromium-based browsers like Edge, Brave).
3. Navigate to `chrome://extensions/` in the URL bar.
4. Enable **Developer mode** via the toggle switch in the top-right corner.
5. Click the **Load unpacked** button in the top-left corner.
6. Select the folder `c:\Users\aryan\Desktop\Chrome Coursera Extension`.
7. The **Course Completion Assistant** icon will appear in your extension toolbar. Pin it for easy access!

---

## Browser Compatibility

| Feature | Chrome / Edge | Firefox | Safari | Fallback Strategy |
|---|---|---|---|---|
| Manifest V3 Service Worker | 88+ | 109+ | 15.4+ | Primary standard |
| CSS Container Queries | 105+ | 110+ | 16.0+ | Grid auto-fit fallback |
| CSS Anchor Positioning | 125+ | Experimental | In development | JavaScript getBoundingClientRect fallback |
| Native `<dialog>` API | 37+ | 98+ | 15.4+ | Standard top-layer |
| Native Popover API | 114+ | 125+ | 17.0+ | Standard top-layer |
| WebAuthn Passkeys | 67+ | 60+ | 13.0+ | Gracefully optional |
| Screen Wake Lock API | 84+ | In development | 16.4+ | Handled with try/catch & activity simulation |

---

## Author & Credits

- **Developer**: **Aryan**
- **Portfolio**: [aryaninvincible-portfolio.vercel.app](https://aryaninvincible-portfolio.vercel.app)
- **License**: MIT License - Built for learners worldwide.
