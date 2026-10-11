/**
 * WebAuthn Passkey Authentication Module
 * Course Completion Assistant
 *
 * Provides optional local biometric / PIN protection for extension settings
 * using the W3C Web Authentication API (FIDO2 / Passkeys).
 */

import { Logger } from '../utils/logger.js';

export class PasskeyAuth {
  /**
   * Check if WebAuthn is supported on the current platform
   */
  static isSupported() {
    return (
      typeof window !== 'undefined' &&
      window.PublicKeyCredential !== undefined &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    );
  }

  /**
   * Check if a platform authenticator (Touch ID, Windows Hello, Face ID) is available
   */
  static async isPlatformAuthenticatorAvailable() {
    if (!this.isSupported()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Register a new passkey credential locally
   */
  static async registerPasskey(userName = 'CCA User') {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser environment.');
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const publicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: 'Course Completion Assistant',
        id: window.location.hostname
      },
      user: {
        id: userId,
        name: userName,
        displayName: userName
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' } // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    };

    try {
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions
      });

      if (!credential) {
        throw new Error('Registration failed: no credential returned.');
      }

      const rawIdBase64 = this.arrayBufferToBase64(credential.rawId);
      Logger.info('Passkey registered successfully with ID:', rawIdBase64);

      return {
        success: true,
        credentialId: rawIdBase64,
        registeredAt: Date.now()
      };
    } catch (err) {
      Logger.error('Passkey registration error:', err);
      throw err;
    }
  }

  /**
   * Authenticate / verify using the registered passkey
   */
  static async verifyPasskey(storedCredentialId) {
    if (!this.isSupported()) {
      throw new Error('WebAuthn is not supported in this browser environment.');
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const publicKeyCredentialRequestOptions = {
      challenge: challenge,
      timeout: 60000,
      userVerification: 'required',
      rpId: window.location.hostname
    };

    if (storedCredentialId) {
      publicKeyCredentialRequestOptions.allowCredentials = [
        {
          id: this.base64ToArrayBuffer(storedCredentialId),
          type: 'public-key',
          transports: ['internal']
        }
      ];
    }

    try {
      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions
      });

      if (!assertion) {
        throw new Error('Authentication cancelled or failed.');
      }

      Logger.info('Passkey assertion verified successfully.');
      return { success: true };
    } catch (err) {
      Logger.error('Passkey verification error:', err);
      throw err;
    }
  }

  // Helper conversions
  static arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  static base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}
