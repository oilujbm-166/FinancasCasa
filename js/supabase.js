// ========================================
// SUPABASE.JS - Auth, Sync & Encryption
// ========================================

const SUPABASE_URL = 'https://nlgqdvekpaxlmywowxnr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sZ3FkdmVrcGF4bG15d293eG5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3ODU2MjUsImV4cCI6MjA5MTM2MTYyNX0.cZ-aoam5cZAPIR4cxTpw_5J11ZeCBU3-wTuYc8pHHY4';

let _supabase = null;
let _currentUser = null;
let _isOfflineMode = false;
let _derivedCryptoKey = null; // session-scoped, never persisted
let _syncTimer = null;
let _lastSyncTimestamp = null;

// === INIT ===
function getSupabaseClient() {
  if (!_supabase && typeof supabase !== 'undefined') {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// === AUTH ===
async function initAuth() {
  const client = getSupabaseClient();
  if (!client) {
    // SDK not loaded (offline/CDN failure) — go offline mode
    continueOffline();
    return;
  }

  // Listen for auth changes
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      _currentUser = session.user;
      hideAuthGate();
      onAuthenticated();
    } else if (event === 'SIGNED_OUT') {
      _currentUser = null;
      _derivedCryptoKey = null;
      showAuthGate();
    }
  });

  // Check existing session
  const { data: { session } } = await client.auth.getSession();
  if (session?.user) {
    _currentUser = session.user;
    hideAuthGate();
    onAuthenticated();
  } else {
    showAuthGate();
  }
}

async function handleSignIn() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  clearAuthMessages();

  if (!email || !password) {
    showAuthError('Preencha email e senha.');
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    showAuthError(error.message === 'Invalid login credentials'
      ? 'Email ou senha incorretos.'
      : error.message);
    return;
  }
  // Store password hash for API key decryption during this session
  _derivedCryptoKey = null; // will derive on demand
  _sessionPassword = password;
}

async function handleSignUp() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  clearAuthMessages();

  if (!email || !password) {
    showAuthError('Preencha email e senha.');
    return;
  }
  if (password.length < 12) {
    showAuthError('Senha deve ter no mínimo 12 caracteres.');
    return;
  }

  const client = getSupabaseClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    if (/signups? not allowed/i.test(error.message || '')) {
      showAuthError('Cadastro disponível apenas por convite. Entre em contato com o administrador do sistema.');
    } else {
      showAuthError(error.message);
    }
    return;
  }
  showAuthInfo('Conta criada! Verifique seu email para confirmar.');
}

async function handleSignOut() {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
  _currentUser = null;
  _derivedCryptoKey = null;
  _sessionPassword = null;
  showAuthGate();
}

function continueOffline() {
  _isOfflineMode = true;
  hideAuthGate();
  if (typeof initApp === 'function') initApp();
}

// === AUTH UI HELPERS ===
function showAuthGate() {
  const el = document.getElementById('authGate');
  if (el) el.classList.remove('hidden');
}

function hideAuthGate() {
  const el = document.getElementById('authGate');
  if (el) el.classList.add('hidden');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function showAuthInfo(msg) {
  const el = document.getElementById('authInfo');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearAuthMessages() {
  const err = document.getElementById('authError');
  const info = document.getElementById('authInfo');
  if (err) err.style.display = 'none';
  if (info) info.style.display = 'none';
}

// === POST-AUTH FLOW ===
let _sessionPassword = null;

async function onAuthenticated() {
  updateSyncStatus('syncing', 'Sincronizando...');
  updateAccountInfo();

  try {
    await migrateLocalStorageToCloud();
    await loadFromSupabase();
    updateSyncStatus('synced', 'Sincronizado');
  } catch (e) {
    console.warn('Sync failed on auth:', e);
    updateSyncStatus('error', 'Erro no sync');
  }

  // Try to restore encrypted API key
  if (_sessionPassword) {
    await tryRestoreEncryptedApiKey(_sessionPassword);
  }

  // Init app after data is loaded
  if (typeof initApp === 'function') initApp();

  // Listen for reconnection
  window.addEventListener('online', () => {
    if (_currentUser) scheduleSyncToSupabase();
  });
}

// === SYNC STATUS UI ===
function updateSyncStatus(state, text) {
  const icon = document.getElementById('syncIcon');
  const label = document.getElementById('syncText');
  if (!icon || !label) return;

  const colors = { synced: 'var(--accent3)', syncing: 'var(--gold)', error: 'var(--danger)', offline: 'var(--text3)' };
  icon.style.color = colors[state] || colors.offline;
  icon.className = state === 'syncing' ? 'syncing' : '';
  label.textContent = text || state;
}

function updateAccountInfo() {
  const el = document.getElementById('accountInfo');
  if (el && _currentUser) {
    el.textContent = _currentUser.email;
  }
}

// === CLOUD SYNC ===
function scheduleSyncToSupabase() {
  if (!_currentUser || _isOfflineMode) return;
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => saveToSupabase(), 500);
}

async function saveToSupabase() {
  if (!_currentUser || _isOfflineMode) return;
  const client = getSupabaseClient();
  if (!client) return;

  updateSyncStatus('syncing', 'Salvando...');

  try {
    const customCats = {};
    Object.entries(CATEGORIES).forEach(([k, v]) => { if (k !== 'Receita') customCats[k] = v; });
    const blob = {
      transactions, budgetData, goals, investments, aiHistory,
      customCategories: customCats,
      planejamentoMedica: (typeof planejamentoMedica !== 'undefined') ? planejamentoMedica : null,
      perfil: (typeof perfil !== 'undefined') ? perfil : { casal: '' }
    };

    const { error } = await client
      .from('user_data')
      .upsert({
        user_id: _currentUser.id,
        data: blob
      }, { onConflict: 'user_id' });

    if (error) throw error;
    _lastSyncTimestamp = new Date().toISOString();
    updateSyncStatus('synced', 'Sincronizado');
  } catch (e) {
    console.warn('saveToSupabase error:', e);
    updateSyncStatus('error', 'Erro ao salvar');
  }
}

async function loadFromSupabase() {
  if (!_currentUser || _isOfflineMode) return;
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { data: row, error } = await client
      .from('user_data')
      .select('data, updated_at')
      .eq('user_id', _currentUser.id)
      .maybeSingle();

    if (error) throw error;
    if (!row || !row.data) return; // no cloud data

    const cloudData = row.data;

    // Populate globals from cloud data
    if (cloudData.customCategories && Object.keys(cloudData.customCategories).length > 0) {
      Object.keys(CATEGORIES).forEach(k => { if (k !== 'Receita') delete CATEGORIES[k]; });
      Object.entries(cloudData.customCategories).forEach(([k, v]) => { CATEGORIES[k] = v; });
      CATEGORIES['Receita'] = { icon: '💰', color: '#34d399' };
    }
    ensureDefaultCategories();
    rebuildBudgetData();

    transactions.length = 0;
    (cloudData.transactions || []).forEach(t => transactions.push(normalizeGroupTx(t)));

    if (cloudData.budgetData) {
      cloudData.budgetData.forEach(b => {
        const existing = budgetData.find(bd => bd.cat === b.cat);
        if (existing) Object.assign(existing, b);
      });
    }

    goals.length = 0;
    (cloudData.goals || []).forEach(g => goals.push(g));

    investments.length = 0;
    (cloudData.investments || []).forEach(inv => investments.push(inv));

    aiHistory.length = 0;
    (cloudData.aiHistory || []).forEach(h => aiHistory.push(h));

    // Restore módulo Planejamento Médica (se existir no blob)
    if (typeof planejamentoMedica !== 'undefined' && cloudData.planejamentoMedica) {
      planejamentoMedica = cloudData.planejamentoMedica;
      if (typeof pmRestoreCategorias === 'function') pmRestoreCategorias();
    }

    if (cloudData.perfil && typeof cloudData.perfil === 'object' && typeof perfil !== 'undefined') {
      perfil = { casal: cloudData.perfil.casal || '' };
    }

    // Sidebar (avatar + nome do lar) pode ter mudado com o sync — refresca se a função já carregou
    if (typeof refreshProfileDisplay === 'function') refreshProfileDisplay();
    // Também atualiza o input de Configurações caso esteja aberto
    const perfilInput = document.getElementById('perfilCasalInput');
    if (perfilInput && typeof perfil !== 'undefined') perfilInput.value = perfil.casal || '';

    // Also persist to localStorage as offline cache
    saveToLocalStorage();

    _lastSyncTimestamp = row.updated_at;
  } catch (e) {
    console.warn('loadFromSupabase error:', e);
  }
}

// === MIGRATION: localStorage → Cloud ===
async function migrateLocalStorageToCloud() {
  if (!_currentUser || _isOfflineMode) return;
  const client = getSupabaseClient();
  if (!client) return;

  // Check if cloud already has data
  const { data: existing } = await client
    .from('user_data')
    .select('id')
    .eq('user_id', _currentUser.id)
    .maybeSingle();

  const localRaw = localStorage.getItem(LS_KEY_DATA);
  const hasLocal = localRaw && localRaw.length > 10;

  if (!existing && hasLocal) {
    // First login: upload local data to cloud
    await saveToSupabase();

    // Migrate plaintext API key to encrypted cloud storage
    const plainKey = localStorage.getItem(LS_KEY_API);
    if (plainKey && _sessionPassword) {
      await saveEncryptedApiKey(plainKey, _sessionPassword);
      localStorage.removeItem(LS_KEY_API); // remove plaintext
    }
  }
  // If cloud exists, loadFromSupabase() will handle it
}

// === ENCRYPTION: API Key (PBKDF2 + AES-GCM) ===

async function deriveEncryptionKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuf(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

async function saveEncryptedApiKey(plainKey, password) {
  if (!_currentUser || !plainKey || !password) return;
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveEncryptionKey(password, salt);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plainKey)
    );

    await client.from('user_settings').upsert({
      user_id: _currentUser.id,
      encrypted_api_key: bufToBase64(encrypted),
      api_key_iv: bufToBase64(iv),
      api_key_salt: bufToBase64(salt)
    }, { onConflict: 'user_id' });
  } catch (e) {
    console.warn('Failed to encrypt/save API key:', e);
  }
}

async function tryRestoreEncryptedApiKey(password) {
  if (!_currentUser || !password) return;
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { data: row } = await client
      .from('user_settings')
      .select('encrypted_api_key, api_key_iv, api_key_salt')
      .eq('user_id', _currentUser.id)
      .maybeSingle();

    if (!row || !row.encrypted_api_key) return;

    const salt = base64ToBuf(row.api_key_salt);
    const iv = base64ToBuf(row.api_key_iv);
    const ciphertext = base64ToBuf(row.encrypted_api_key);
    const key = await deriveEncryptionKey(password, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, ciphertext
    );

    const plainKey = new TextDecoder().decode(decrypted);
    GEMINI_API_KEY = plainKey;

    // Update UI
    const input = document.getElementById('apiKeyInput');
    if (input) input.value = plainKey;
    const status = document.getElementById('apiKeyStatus');
    if (status) status.innerHTML = '<span style="color:var(--accent3)">Chave restaurada (criptografada na nuvem)</span>';
    const connStatus = document.getElementById('connectionStatus');
    if (connStatus) connStatus.innerHTML = '<div class="alert alert-success">API conectada</div>';
  } catch (e) {
    // Decryption failed — password mismatch or no key
    console.warn('API key decryption failed:', e);
  }
}

// Override saveApiKeyToStorage to also encrypt to cloud
const _originalSaveApiKey = typeof saveApiKeyToStorage === 'function' ? saveApiKeyToStorage : null;
function saveApiKeyToStorageWithCloud(key) {
  // Local storage as fallback for offline mode
  if (_isOfflineMode) {
    try { localStorage.setItem(LS_KEY_API, key); } catch (e) {}
    return;
  }
  // In authenticated mode: encrypt and store in cloud, don't store plaintext locally
  if (_currentUser && _sessionPassword) {
    saveEncryptedApiKey(key, _sessionPassword);
  } else {
    // Fallback: local only
    try { localStorage.setItem(LS_KEY_API, key); } catch (e) {}
  }
}
