// js/crypto/envelope.js
// Primitivas de envelope encryption via Web Crypto API.
// Puro (sem I/O, sem DOM). Exporta funções como globais — o projeto não usa módulos ES.
//
// Chaves envolvidas:
//   - MasterKey  : AES-GCM 256 aleatória por usuário. Criptografa dados e chave Gemini.
//   - SenhaKey   : AES-GCM 256 derivada de PBKDF2(senha, salt, 600k). Só envolve/desenvolve MasterKey.
//
// Todo decrypt que falha lança Error('DECRYPT_FAILED'). Chamador classifica o motivo.

(function () {
  'use strict';

  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('ENVELOPE_INSECURE_CONTEXT: crypto.subtle indisponível (requer HTTPS ou localhost).');
  }

  const PBKDF2_ITERATIONS = 600000;
  const AES_KEY_BITS = 256;
  const IV_BYTES = 12;
  const MASTER_KEY_BYTES = 32;

  // ---- Helpers base64 (bytes arbitrários, não UTF-8) ----
  function bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function base64ToBuf(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ---- MasterKey: gerar e importar ----
  async function generateMasterKeyRaw() {
    return crypto.getRandomValues(new Uint8Array(MASTER_KEY_BYTES));
  }

  async function importMasterKey(rawBytes) {
    return crypto.subtle.importKey(
      'raw',
      rawBytes,
      { name: 'AES-GCM', length: AES_KEY_BITS },
      true, // extractable: necessário se futuramente precisarmos re-exportar
      ['encrypt', 'decrypt']
    );
  }

  // ---- PBKDF2(senha) → SenhaKey ----
  async function derivePasswordKey(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: AES_KEY_BITS },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ---- Wrap/unwrap MasterKey com SenhaKey ----
  async function wrapMasterKey(masterKeyRaw, passwordKey) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      passwordKey,
      masterKeyRaw
    );
    return {
      ciphertext: bufToBase64(cipher),
      iv: bufToBase64(iv)
    };
  }

  async function unwrapMasterKey(wrappedB64, ivB64, passwordKey) {
    try {
      const cipher = base64ToBuf(wrappedB64);
      const iv = base64ToBuf(ivB64);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        passwordKey,
        cipher
      );
      return new Uint8Array(plain);
    } catch (e) {
      throw new Error('DECRYPT_FAILED');
    }
  }

  // ---- Criptografia de JSON arbitrário com MasterKey ----
  async function encryptJson(masterKey, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      masterKey,
      plain
    );
    return {
      ciphertext: bufToBase64(cipher),
      iv: bufToBase64(iv)
    };
  }

  async function decryptJson(masterKey, ciphertextB64, ivB64) {
    try {
      const cipher = base64ToBuf(ciphertextB64);
      const iv = base64ToBuf(ivB64);
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        masterKey,
        cipher
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) {
      throw new Error('DECRYPT_FAILED');
    }
  }

  // ---- Serialização dos raw bytes da MasterKey pra sessionStorage ----
  function serializeMasterKey(rawBytes) {
    return bufToBase64(rawBytes);
  }
  function deserializeMasterKey(b64) {
    return base64ToBuf(b64);
  }

  // ---- Exposição como globais ----
  window.generateMasterKeyRaw = generateMasterKeyRaw;
  window.importMasterKey = importMasterKey;
  window.derivePasswordKey = derivePasswordKey;
  window.wrapMasterKey = wrapMasterKey;
  window.unwrapMasterKey = unwrapMasterKey;
  window.encryptJson = encryptJson;
  window.decryptJson = decryptJson;
  window.serializeMasterKey = serializeMasterKey;
  window.deserializeMasterKey = deserializeMasterKey;
  window.bufToBase64 = bufToBase64;
  window.base64ToBuf = base64ToBuf;
})();
