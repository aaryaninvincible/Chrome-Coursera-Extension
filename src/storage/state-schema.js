/**
 * State Schema and Default Configurations
 * Course Completion Assistant
 */

export const DEFAULT_SETTINGS = {
  // Module 1: Window Persistence & Inactivity Prevention
  activeMode: {
    enabled: true,
    intervalSeconds: 60, // Activity dispatch interval: 30, 60, 120, 300
    screenWakeLock: true,
    spoofVisibility: true,
    preventWindowBlur: true,
    keepRenderLoopActive: true,
    whitelistedDomains: [
      'coursera.org',
      'udemy.com',
      'edx.org',
      'canvas.net',
      'instructure.com',
      'khanacademy.org',
      'pluralsight.com',
      'linkedin.com',
      'youtube.com'
    ],
    mode: 'all' // 'all' or 'whitelist_only'
  },

  // Module 2: Universal Media Enhancement
  mediaEnhancement: {
    enabled: true,
    defaultPlaybackSpeed: 1.5, // 1, 1.5, 2, 2.5, 3, 4, 5
    autoPlay: true,
    autoResumeOnStall: true,
    autoNext: true,
    autoNextDelaySeconds: 5,
    autoSeekIntro: false,
    introSkipSeconds: 15,
    rememberPlaybackPosition: true,
    showFloatingSpeedBadge: true
  },

  // Module 3: Unlock Restricted Websites
  siteUnlocker: {
    enabled: true,
    enableRightClick: true,
    enableTextSelection: true,
    enableCopy: true,
    enableShortcuts: true,
    enableDevAccess: true
  },

  // Module 4: Course Flow & Auto-Progression
  courseFlow: {
    enabled: true,
    autoClickStartOverlay: true, // Auto-clicks Coursera post-video "Start" card
    autoCompleteReadings: true,  // Auto-marks reading items as completed
    autoAdvanceReadingDelaySec: 3,
    autoPlayVideo: true,         // Aggressive autoplay on video pages
    autoSolveInVideoQuiz: true,  // Auto-advance in-video checkpoints
    autoFastCompleteVideo: false // Auto-seeks videos to end to complete in 1-2s
  },

  // Module 5: Quiz Assistant Sidebar
  quizAssistant: {
    enabled: true,
    showSidebar: true,
    highlightAnswers: true,
    autoSelectConfidenceThreshold: 0.8,
    autoSubmitAndRetry: true, // Auto-submits & re-attempts until score >= 75%
    minPassingScore: 75
  },

  // UI & System Preferences
  ui: {
    theme: 'system', // 'system', 'dark', 'light'
    accentColor: '#6366f1',
    compactMode: false
  },

  // Module 6: Security & Passkey Authentication
  security: {
    passkeyProtected: false,
    passkeyCredentialId: null,
    passkeyPublicKey: null,
    registeredAt: null,
    lastAuditDate: null,
    auditScore: 100
  }
};

export const DEFAULT_METRICS = {
  watchedVideosCount: 0,
  completedCoursesCount: 0,
  totalTimeSavedSeconds: 0, // Computed from speedup (timeSaved = duration * (1 - 1/speed))
  totalActiveTimeSeconds: 0,
  activeSessionsCount: 0,
  lastSessionDate: null,
  recentCourses: [] // Array of { id, title, domain, progress, lastSeen, playbackSpeed }
};
