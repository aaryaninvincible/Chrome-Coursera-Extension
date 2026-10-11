/**
 * Security Audit Module
 * Performs built-in security posture assessments of the extension,
 * analyzing permissions, host scopes, CSP compliance, and storage integrity.
 */

export class SecurityAuditor {
  constructor() {
    this.manifest = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
      ? chrome.runtime.getManifest()
      : {
          manifest_version: 3,
          permissions: ['storage', 'alarms', 'tabs', 'scripting'],
          host_permissions: ['<all_urls>'],
          content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" }
        };
  }

  /**
   * Run full security audit and return score + actionable recommendations
   */
  async runAudit(settings = {}) {
    const findings = [];
    let score = 100;

    // 1. Audit Extension Permissions
    const declaredPermissions = this.manifest.permissions || [];
    const sensitivePermissions = ['webRequest', 'cookies', 'management', 'debugger'];
    const hasSensitive = declaredPermissions.some(p => sensitivePermissions.includes(p));

    if (hasSensitive) {
      score -= 20;
      findings.push({
        id: 'sensitive-permissions',
        severity: 'high',
        category: 'Permissions',
        title: 'Sensitive Permissions Detected',
        description: 'Extension requests elevated browser permissions that could pose risks if compromised.',
        recommendation: 'Remove unused high-privilege permissions.'
      });
    } else {
      findings.push({
        id: 'least-privilege',
        severity: 'good',
        category: 'Permissions',
        title: 'Principle of Least Privilege Maintained',
        description: 'Declared permissions are restricted to standard functional needs (storage, alarms, tabs, scripting).',
        recommendation: 'No action required.'
      });
    }

    // 2. Audit Host Permissions
    const hostPermissions = this.manifest.host_permissions || [];
    if (hostPermissions.includes('<all_urls>') || hostPermissions.includes('*://*/*')) {
      if (settings?.activeMode?.mode === 'whitelist_only') {
        score -= 5;
        findings.push({
          id: 'host-permissions-controlled',
          severity: 'medium',
          category: 'Host Scope',
          title: 'Broad Host Permission with Whitelist Enforcement',
          description: 'Extension has broad URL permissions but strictly enforces user-managed domain whitelist.',
          recommendation: 'Keep domain whitelist mode enabled for maximum isolation.'
        });
      } else {
        score -= 10;
        findings.push({
          id: 'host-permissions-broad',
          severity: 'medium',
          category: 'Host Scope',
          title: 'Broad Host Permissions Enabled',
          description: 'Extension can run scripts across all web pages.',
          recommendation: 'Enable "Whitelist Only" mode in Settings to restrict automation to trusted learning domains only.'
        });
      }
    }

    // 3. Content Security Policy (CSP)
    const csp = this.manifest.content_security_policy?.extension_pages || '';
    const hasUnsafeEval = csp.includes('unsafe-eval');
    const hasUnsafeInline = csp.includes('unsafe-inline');

    if (hasUnsafeEval || hasUnsafeInline) {
      score -= 25;
      findings.push({
        id: 'csp-violation',
        severity: 'critical',
        category: 'CSP',
        title: 'Weak Content Security Policy',
        description: 'CSP allows unsafe-eval or unsafe-inline scripts.',
        recommendation: 'Enforce strict Manifest V3 CSP: script-src \'self\'; object-src \'self\'.'
      });
    } else {
      findings.push({
        id: 'csp-compliant',
        severity: 'good',
        category: 'CSP',
        title: 'Strict Manifest V3 CSP Compliant',
        description: 'All inline scripts and arbitrary code execution are blocked by browser enforcement.',
        recommendation: 'No action required.'
      });
    }

    // 4. Storage Security & Encryption / Passkey
    const isPasskeyEnabled = settings?.security?.passkeyProtected === true;
    if (isPasskeyEnabled) {
      findings.push({
        id: 'passkey-active',
        severity: 'good',
        category: 'Authentication',
        title: 'WebAuthn Passkey Protection Active',
        description: 'Extension settings and sensitive controls are locked behind local biometric/PIN authentication.',
        recommendation: 'No action required.'
      });
    } else {
      score -= 10;
      findings.push({
        id: 'passkey-disabled',
        severity: 'info',
        category: 'Authentication',
        title: 'Passkey Protection Optional',
        description: 'Settings are stored locally in plaintext without biometric verification requirement.',
        recommendation: 'Enable Passkey Protection in the Security tab for shared workstation security.'
      });
    }

    // 5. Audit Storage Usage
    const storageStats = await this.getStorageUsage();
    if (storageStats.bytesInUse > 4 * 1024 * 1024) { // > 4MB
      score -= 5;
      findings.push({
        id: 'storage-bloat',
        severity: 'medium',
        category: 'Storage',
        title: 'High Storage Utilization',
        description: `Current storage usage is ${(storageStats.bytesInUse / (1024 * 1024)).toFixed(2)}MB.`,
        recommendation: 'Purge old session logs and inactive course histories.'
      });
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      timestamp: Date.now(),
      manifestVersion: this.manifest.manifest_version,
      findings
    };
  }

  async getStorageUsage() {
    return new Promise(resolve => {
      if (chrome.storage?.local?.getBytesInUse) {
        chrome.storage.local.getBytesInUse(bytesInUse => {
          resolve({ bytesInUse: bytesInUse || 0 });
        });
      } else {
        resolve({ bytesInUse: 0 });
      }
    });
  }
}

export const securityAuditor = new SecurityAuditor();
