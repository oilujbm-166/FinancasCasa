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
    if (event === 'PASSWORD_RECOVERY') {
      // Usuário chegou aqui pelo link de "esqueci minha senha" no email.
      // Supabase abre uma sessão temporária só pra permitir updateUser({password}).
      // Não chamamos onAuthenticated() — aguardamos o usuário definir a nova senha.
      _inPasswordRecovery = true;
      if (session?.user) _currentUser = session.user;
      showAuthGate();
      showResetPasswordView();
      return;
    }
    if (event === 'SIGNED_IN' && session?.user) {
      if (_inPasswordRecovery) return; // aguarda completePasswordReset finalizar o fluxo
      _currentUser = session.user;
      hideAuthGate();
      onAuthenticated();
    } else if (event === 'SIGNED_OUT') {
      if (_currentUser) sessionStorage.removeItem('fc_mk_' + _currentUser.id);
      _masterKey = null;
      _currentUser = null;
      _derivedCryptoKey = null;
      _inPasswordRecovery = false;
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

// Flag: true enquanto o usuário está no fluxo de reset de senha (após clicar no link do email).
// Impede que o SIGNED_IN disparado pela sessão temporária do Supabase jogue o usuário pro app
// antes de ele definir a nova senha.
let _inPasswordRecovery = false;

// === RESET DE SENHA ===
async function handleForgotPassword() {
  const email = (document.getElementById('authForgotEmail') || {}).value || '';
  const trimmed = email.trim();
  clearForgotMessages();
  if (!trimmed) {
    showForgotError('Informe seu email.');
    return;
  }
  const client = getSupabaseClient();
  if (!client) {
    showForgotError('Serviço indisponível no momento. Tente novamente em alguns segundos.');
    return;
  }
  // redirectTo volta pro mesmo origin/path em que o usuário está agora — funciona tanto em
  // localhost quanto no GitHub Pages, desde que a URL esteja autorizada nas configurações do
  // projeto Supabase (Authentication → URL Configuration → Redirect URLs).
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await client.auth.resetPasswordForEmail(trimmed, { redirectTo });
  if (error) {
    showForgotError('Não foi possível enviar agora. Tente de novo em alguns minutos.');
    return;
  }
  // Mensagem neutra — não confirma nem nega que a conta existe (evita enumeração de emails).
  showForgotInfo('Se houver uma conta com esse email, você receberá um link para redefinir a senha em instantes. Confira a caixa de entrada e o spam.');
}

async function completePasswordReset() {
  const oldP = (document.getElementById('authOldPassword') || {}).value || '';
  const newP = (document.getElementById('authNewPassword') || {}).value || '';
  const confP = (document.getElementById('authNewPasswordConfirm') || {}).value || '';
  clearResetMessages();
  if (!oldP || !newP || !confP) { showResetError('Preencha os 3 campos.'); return; }
  if (newP.length < 12) { showResetError('Nova senha precisa ter 12+ caracteres.'); return; }
  if (newP !== confP) { showResetError('As novas senhas não coincidem.'); return; }

  const client = getSupabaseClient();
  if (!client || !_currentUser) { showResetError('Sessão inválida. Recarregue a página.'); return; }

  const { data: settings } = await client.from('user_settings')
    .select('wrapped_master_key, master_key_iv, master_key_salt')
    .eq('user_id', _currentUser.id).maybeSingle();
  if (!settings?.wrapped_master_key) {
    // Conta pré-Fase-C/G, sem wrapped. Usuário precisa logar uma vez pra migração lazy rodar.
    showResetError('Conta ainda não migrada pro novo esquema. Faça login normal uma vez e tente resetar depois. Ou use "Esqueci a senha atual" pra começar do zero.');
    return;
  }

  // 1. Desembrulha MK com a senha antiga
  let rawMK;
  try {
    const oldSalt = base64ToBuf(settings.master_key_salt);
    const oldPwKey = await derivePasswordKey(oldP, oldSalt);
    rawMK = await unwrapMasterKey(settings.wrapped_master_key, settings.master_key_iv, oldPwKey);
  } catch (e) {
    showResetError('Senha atual incorreta.');
    return;
  }

  // 2. Re-wrappa com a senha nova
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const newPwKey = await derivePasswordKey(newP, newSalt);
  const newWrapped = await wrapMasterKey(rawMK, newPwKey);

  // 3. Atualiza senha no Supabase Auth
  const { error: updErr } = await client.auth.updateUser({ password: newP });
  if (updErr) { rawMK.fill(0); showResetError(updErr.message || 'Falha ao atualizar senha.'); return; }

  // 4. Persiste novo wrapped
  const { error: persistErr } = await client.from('user_settings').update({
    wrapped_master_key: newWrapped.ciphertext,
    master_key_iv: newWrapped.iv,
    master_key_salt: bufToBase64(newSalt)
  }).eq('user_id', _currentUser.id);
  if (persistErr) {
    // Senha Supabase já mudou mas wrapped ainda é o antigo — próximo login vai falhar no unwrap.
    // Admin precisa intervir ou usuário usa "Esqueci a senha atual" na próxima.
    rawMK.fill(0);
    showResetError('Falha crítica ao salvar nova chave. Contate o admin.');
    return;
  }

  // 5. Atualiza memória + sessionStorage
  _masterKey = await importMasterKey(rawMK);
  sessionStorage.setItem('fc_mk_' + _currentUser.id, serializeMasterKey(rawMK));
  rawMK.fill(0);
  _sessionPassword = newP;
  _inPasswordRecovery = false;
  showResetInfo('Senha trocada! Dados preservados. Entrando...');
  setTimeout(() => { hideResetPasswordView(); hideAuthGate(); onAuthenticated(); }, 800);
}

// Path "esqueci a senha atual": confirma 2x que quer perder todos os dados, então
// atualiza senha Supabase, gera MK nova, zera user_data encrypted_data e api_key_v2.
function showLostPasswordConfirm() {
  clearResetMessages();
  _hideAllAuthViews();
  const view = document.getElementById('authResetDestroyConfirm');
  if (view) view.style.display = 'block';
}

async function handleLostOldPassword() {
  const newP = (document.getElementById('authDestroyNewPassword') || {}).value || '';
  const confP = (document.getElementById('authDestroyNewPasswordConfirm') || {}).value || '';
  const errEl = document.getElementById('authDestroyError');
  const showErr = (msg) => { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } };
  if (errEl) errEl.style.display = 'none';

  if (!newP || !confP) { showErr('Preencha os 2 campos.'); return; }
  if (newP.length < 12) { showErr('Nova senha precisa ter 12+ caracteres.'); return; }
  if (newP !== confP) { showErr('As senhas não coincidem.'); return; }

  const client = getSupabaseClient();
  if (!client || !_currentUser) { showErr('Sessão inválida. Recarregue a página.'); return; }

  // 1. Atualiza senha no Supabase Auth
  const { error: updErr } = await client.auth.updateUser({ password: newP });
  if (updErr) { showErr(updErr.message || 'Falha ao atualizar senha.'); return; }

  // 2. Gera MK nova + wrap com senha nova
  const rawMK = await generateMasterKeyRaw();
  const newSalt = crypto.getRandomValues(new Uint8Array(16));
  const newPwKey = await derivePasswordKey(newP, newSalt);
  const newWrapped = await wrapMasterKey(rawMK, newPwKey);
  _masterKey = await importMasterKey(rawMK);

  // 3. Blob vazio criptografado com a MK nova
  const emptyBlob = {
    transactions: [], budgetData: [], goals: [], investments: [], aiHistory: [],
    customCategories: {}, planejamentoMedica: null, perfil: { casal: '' }
  };
  const encEmpty = await encryptJson(_masterKey, emptyBlob);

  // 4. Persiste: wrapped nova, zera v1+v2 API keys
  const { error: sErr } = await client.from('user_settings').update({
    wrapped_master_key: newWrapped.ciphertext,
    master_key_iv: newWrapped.iv,
    master_key_salt: bufToBase64(newSalt),
    encrypted_api_key: null,
    api_key_iv: null,
    api_key_salt: null,
    encrypted_api_key_v2: null,
    api_key_iv_v2: null
  }).eq('user_id', _currentUser.id);
  if (sErr) { rawMK.fill(0); showErr('Falha ao zerar settings. Contate o admin.'); return; }

  // 5. Zera user_data (blob antigo vira inaccessível anyway — MK antiga perdida)
  const { error: dErr } = await client.from('user_data').update({
    encrypted_data: encEmpty.ciphertext,
    data_iv: encEmpty.iv,
    data_version: 1,
    data: null,
    updated_at: new Date().toISOString()
  }).eq('user_id', _currentUser.id);
  if (dErr) console.warn('Falha ao zerar user_data:', dErr);

  // 6. Estado
  sessionStorage.setItem('fc_mk_' + _currentUser.id, serializeMasterKey(rawMK));
  rawMK.fill(0);
  _sessionPassword = newP;
  _inPasswordRecovery = false;
  GEMINI_API_KEY = '';

  // Zera coleções in-memory pra não vazar dados antigos no render até loadFromSupabase
  if (typeof transactions !== 'undefined') transactions.length = 0;
  if (typeof goals !== 'undefined') goals.length = 0;
  if (typeof investments !== 'undefined') investments.length = 0;
  if (typeof aiHistory !== 'undefined') aiHistory.length = 0;

  setTimeout(() => {
    _hideAllAuthViews();
    hideAuthGate();
    onAuthenticated();
  }, 400);
}

async function clearEncryptedApiKeyCloud() {
  if (!_currentUser) return;
  const client = getSupabaseClient();
  if (!client) return;
  try {
    await client.from('user_settings').update({
      encrypted_api_key: null,
      api_key_iv: null,
      api_key_salt: null,
      encrypted_api_key_v2: null,
      api_key_iv_v2: null
    }).eq('user_id', _currentUser.id);
    // Também limpa in-memory e o input da UI se já carregou
    GEMINI_API_KEY = '';
    const input = document.getElementById('apiKeyInput');
    if (input) input.value = '';
  } catch (e) {
    console.warn('Falha ao limpar API key criptografada após reset de senha:', e);
  }
}

// === UI HELPERS: RESET DE SENHA ===
// Helper: esconde todas as views do auth-card de uma vez (login, signup, forgot, reset)
function _hideAllAuthViews() {
  ['authForm', 'authSignupForm', 'authForgotForm', 'authResetForm', 'authResetDestroyConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showSignupView() {
  clearAuthMessages();
  clearSignupMessages();
  _hideAllAuthViews();
  const signup = document.getElementById('authSignupForm');
  if (signup) signup.style.display = 'block';
  // Pré-popula o email se o usuário já tinha digitado no login
  const mainEmail = (document.getElementById('authEmail') || {}).value || '';
  const signupEmail = document.getElementById('authSignupEmail');
  if (signupEmail && mainEmail && !signupEmail.value) signupEmail.value = mainEmail;
}

function hideSignupView() {
  clearSignupMessages();
  _hideAllAuthViews();
  const form = document.getElementById('authForm');
  if (form) form.style.display = 'block';
}

function showForgotView() {
  clearAuthMessages();
  _hideAllAuthViews();
  const forgot = document.getElementById('authForgotForm');
  if (forgot) forgot.style.display = 'block';
  // Pré-popula o email se o usuário já tinha digitado no login
  const mainEmail = (document.getElementById('authEmail') || {}).value || '';
  const forgotEmail = document.getElementById('authForgotEmail');
  if (forgotEmail && mainEmail && !forgotEmail.value) forgotEmail.value = mainEmail;
}

function hideForgotView() {
  clearForgotMessages();
  _hideAllAuthViews();
  const form = document.getElementById('authForm');
  if (form) form.style.display = 'block';
}

function showResetPasswordView() {
  clearAuthMessages();
  clearForgotMessages();
  _hideAllAuthViews();
  const reset = document.getElementById('authResetForm');
  if (reset) reset.style.display = 'block';
}

function hideResetPasswordView() {
  _hideAllAuthViews();
  const form = document.getElementById('authForm');
  if (form) form.style.display = 'block';
}

function showForgotError(msg) {
  const el = document.getElementById('authForgotError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function showForgotInfo(msg) {
  const el = document.getElementById('authForgotInfo');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function clearForgotMessages() {
  const err = document.getElementById('authForgotError');
  const info = document.getElementById('authForgotInfo');
  if (err) err.style.display = 'none';
  if (info) info.style.display = 'none';
}
function showResetError(msg) {
  const el = document.getElementById('authResetError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function showResetInfo(msg) {
  const el = document.getElementById('authResetInfo');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function clearResetMessages() {
  const err = document.getElementById('authResetError');
  const info = document.getElementById('authResetInfo');
  if (err) err.style.display = 'none';
  if (info) info.style.display = 'none';
}

function showSignupError(msg) {
  const el = document.getElementById('authSignupError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function showSignupInfo(msg) {
  const el = document.getElementById('authSignupInfo');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function clearSignupMessages() {
  const err = document.getElementById('authSignupError');
  const info = document.getElementById('authSignupInfo');
  if (err) err.style.display = 'none';
  if (info) info.style.display = 'none';
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

  // Aloca o latch ANTES de signInWithPassword pra garantir que onAuthenticated
  // (disparado pelo listener SIGNED_IN em paralelo) encontre o promise e espere.
  let latchResolve, latchReject;
  _unlockPromise = new Promise((res, rej) => { latchResolve = res; latchReject = rej; });
  const settleLatch = (err) => {
    _unlockPromise = null;
    if (err) latchReject(err); else latchResolve();
  };

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    settleLatch();
    showAuthError(error.message === 'Invalid login credentials'
      ? 'Email ou senha incorretos.'
      : error.message);
    return;
  }
  _derivedCryptoKey = null;
  _sessionPassword = password;

  const userId = data.user?.id;
  if (!userId) { settleLatch(); return; }

  try {
    const { data: settings } = await client
      .from('user_settings')
      .select('wrapped_master_key, master_key_iv, master_key_salt')
      .eq('user_id', userId)
      .maybeSingle();
    if (settings?.wrapped_master_key) {
      const salt = base64ToBuf(settings.master_key_salt);
      const pwKey = await derivePasswordKey(password, salt);
      const rawMK = await unwrapMasterKey(
        settings.wrapped_master_key,
        settings.master_key_iv,
        pwKey
      );
      _masterKey = await importMasterKey(rawMK);
      sessionStorage.setItem('fc_mk_' + userId, serializeMasterKey(rawMK));
      rawMK.fill(0);
    }
    // Usuário sem wrapped_master_key (conta antiga) segue — Fase G migrará depois.
    settleLatch();
  } catch (e) {
    // Senha aceita pelo auth mas wrapped decifra errado: estado inconsistente. Force signOut.
    settleLatch(e);
    showAuthError('Falha ao desbloquear seus dados. Entre em contato com o admin.');
    await client.auth.signOut();
  }
}

// handleSignUp: legado. Mantido como atalho para abrir a view de signup com código (Fase 1.1).
// Antes chamava client.auth.signUp({ email, password }), mas agora signups são bloqueados
// pelo Supabase (signups disabled) e só rolam via redeem-invite Edge Function.
async function handleSignUp() {
  showSignupView();
}

// Fluxo da Fase 1.1: usuário com código de convite + email + senha → chama redeem-invite
// Edge Function (pública, verify_jwt=false), que cria a conta via service role e devolve sessão.
async function completeSignup() {
  const email = (document.getElementById('authSignupEmail') || {}).value.trim();
  const code = (document.getElementById('authSignupCode') || {}).value.trim();
  const password = (document.getElementById('authSignupPassword') || {}).value || '';
  clearSignupMessages();

  if (!email) {
    showSignupError('Informe seu email.');
    return;
  }
  if (!code) {
    showSignupError('Informe o código de convite que você recebeu.');
    return;
  }
  if (password.length < 12) {
    showSignupError('Senha deve ter no mínimo 12 caracteres.');
    return;
  }

  const url = `${SUPABASE_URL}/functions/v1/redeem-invite`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // apikey é exigido pelo gateway das Edge Functions mesmo quando verify_jwt=false
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, code, password }),
    });
  } catch (e) {
    showSignupError('Falha de rede. Verifique sua conexão e tente novamente.');
    return;
  }

  let data = null;
  try { data = await res.json(); } catch (e) {}

  if (!res.ok) {
    // Mapeia HTTP status → mensagem amigável em PT-BR. Detalhes em supabase/functions/redeem-invite/index.ts
    const errKind = data?.error || '';
    let msg;
    if (res.status === 400) msg = 'Dados inválidos. Verifique email, código e senha (mínimo 12 caracteres).';
    else if (res.status === 403) msg = 'Esse código não é válido para este email. Confirme o email exato em que você recebeu o convite.';
    else if (res.status === 404) msg = 'Código de convite inválido. Confira se digitou exatamente como recebeu.';
    else if (res.status === 410 && errKind === 'code expired') msg = 'Este código expirou. Peça um novo ao administrador.';
    else if (res.status === 410) msg = 'Este código já foi usado. Cada convite vale para uma conta só.';
    else if (res.status === 429) msg = 'Muitas tentativas seguidas. Aguarde 1 hora antes de tentar de novo.';
    else if (res.status === 500) msg = 'Erro ao criar conta no servidor. Tente novamente em alguns minutos.';
    else msg = `Erro inesperado (${res.status}): ${errKind || 'sem detalhes'}.`;
    showSignupError(msg);
    return;
  }

  // Sucesso: a função retornou { user, session }. Vamos plugar a sessão no client Supabase
  // e o onAuthStateChange dispara SIGNED_IN → onAuthenticated → entra no app.
  const session = data?.session;
  if (!session?.access_token || !session?.refresh_token) {
    // Fallback: cria conta deu certo mas sessão veio incompleta. Pede pra fazer login manual.
    showSignupInfo('Conta criada! Use "Entrar" com seu email e senha para acessar o app.');
    return;
  }

  showSignupInfo('Conta criada! Entrando...');
  const client = getSupabaseClient();
  if (!client) {
    showSignupError('Cliente Supabase não disponível. Recarregue a página e tente fazer login.');
    return;
  }
  // Guarda a senha em memória pra cripto v1 da API key Gemini funcionar nesta sessão.
  // Legado: removido na Fase J quando a cripto v1 for extinta.
  _sessionPassword = password;
  await client.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  // setSession dispara onAuthStateChange → SIGNED_IN → onAuthenticated (fire-and-forget).
  // Abaixo: inicializa envelope encryption. onAuthenticated corre em paralelo, mas o
  // loadFromSupabase pré-Fase-E só lê user_data.data (NULL pra conta nova) → no-op seguro.

  const userId = session.user?.id;
  if (!userId) {
    showSignupError('Sessão criada sem userId. Faça login manual.');
    return;
  }
  try {
    const rawMK = await generateMasterKeyRaw();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pwKey = await derivePasswordKey(password, salt);
    const wrapped = await wrapMasterKey(rawMK, pwKey);
    _masterKey = await importMasterKey(rawMK);

    const emptyBlob = {
      transactions: [],
      budgetData: [],
      goals: [],
      investments: [],
      aiHistory: [],
      customCategories: {},
      planejamentoMedica: null,
      perfil: { casal: '' }
    };
    const encBlob = await encryptJson(_masterKey, emptyBlob);

    const { error: settingsErr } = await client.from('user_settings').upsert({
      user_id: userId,
      wrapped_master_key: wrapped.ciphertext,
      master_key_iv: wrapped.iv,
      master_key_salt: bufToBase64(salt)
    }, { onConflict: 'user_id' });
    if (settingsErr) throw settingsErr;

    const { error: dataErr } = await client.from('user_data').upsert({
      user_id: userId,
      encrypted_data: encBlob.ciphertext,
      data_iv: encBlob.iv,
      data_version: 1,
      data: null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (dataErr) throw dataErr;

    sessionStorage.setItem('fc_mk_' + userId, serializeMasterKey(rawMK));
    rawMK.fill(0);
  } catch (e) {
    console.error('Falha ao inicializar envelope encryption no signup:', e);
    // Conta já existe (invite consumido). Próximo login cai na migração lazy da Fase G.
    showSignupError('Erro na criptografia inicial. Faça logout e login de novo em alguns minutos.');
  }
}

async function handleSignOut() {
  const client = getSupabaseClient();
  if (client) await client.auth.signOut();
  if (_currentUser) sessionStorage.removeItem('fc_mk_' + _currentUser.id);
  _masterKey = null;
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
// MasterKey AES-GCM 256 (CryptoKey). Derivada da wrapped_master_key via senha no login
// ou gerada no signup. Necessária pra criptografar/decifrar user_data.encrypted_data
// e user_settings.encrypted_api_key_v2. _sessionPassword é legado (Fase J remove).
let _masterKey = null;
// Latch pra serializar onAuthenticated com o unwrap/migração em handleSignIn.
// O listener SIGNED_IN do Supabase dispara onAuthenticated em paralelo assim que
// signInWithPassword resolve, antes de handleSignIn conseguir popular _masterKey.
// onAuthenticated espera este latch antes de chamar loadFromSupabase. null = sem unlock em curso.
let _unlockPromise = null;

async function onAuthenticated() {
  // Espera o unwrap/migração em handleSignIn terminar antes de tocar user_data.
  if (_unlockPromise) {
    try { await _unlockPromise; }
    catch (e) { console.warn('onAuthenticated abortado: unlock falhou'); return; }
  }

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

  // Restaura chave API criptografada. Preferência: v2 (MasterKey). Fallback: v1 (senha),
  // usado até Fase G migrar todos pros novos campos _v2.
  if (_masterKey) {
    await tryRestoreApiKeyV2();
  } else if (_sessionPassword) {
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

  if (!_masterKey) {
    // Sem MasterKey não dá pra criptografar. Acontece pra usuário antigo antes da
    // Fase G migrar, ou se sessionStorage foi limpo e Fase H ainda vai pedir unlock.
    console.warn('saveToSupabase: MasterKey ausente, skip cloud save');
    updateSyncStatus('error', 'Faça login para salvar');
    return;
  }

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

    const enc = await encryptJson(_masterKey, blob);

    const { error } = await client
      .from('user_data')
      .upsert({
        user_id: _currentUser.id,
        encrypted_data: enc.ciphertext,
        data_iv: enc.iv,
        data: null,
        data_version: 1,
        updated_at: new Date().toISOString()
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
      .select('data, encrypted_data, data_iv, updated_at')
      .eq('user_id', _currentUser.id)
      .maybeSingle();

    if (error) throw error;
    if (!row) return;

    let cloudData;
    if (row.encrypted_data && _masterKey) {
      try {
        cloudData = await decryptJson(_masterKey, row.encrypted_data, row.data_iv);
      } catch (e) {
        // Ciphertext corrompido ou MK errada: desloga pra evitar sobrescrever com dados ruins.
        showAuthError('Não foi possível descriptografar seus dados. Faça login novamente.');
        await handleSignOut();
        return;
      }
    } else if (row.data) {
      // Legado plaintext — usuário pré-envelope. Fase G converte no próximo login.
      cloudData = row.data;
    } else {
      return;
    }

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

// === ENCRYPTION: API Key v2 (cifrada pela MasterKey, não pela senha) ===

async function saveApiKeyEncryptedV2(plainKey) {
  if (!_currentUser || !plainKey || !_masterKey) return;
  const client = getSupabaseClient();
  if (!client) return;
  try {
    const enc = await encryptJson(_masterKey, { key: plainKey });
    await client.from('user_settings').upsert({
      user_id: _currentUser.id,
      encrypted_api_key_v2: enc.ciphertext,
      api_key_iv_v2: enc.iv
    }, { onConflict: 'user_id' });
  } catch (e) {
    console.warn('Failed to encrypt/save API key v2:', e);
  }
}

async function tryRestoreApiKeyV2() {
  if (!_currentUser || !_masterKey) return;
  const client = getSupabaseClient();
  if (!client) return;
  try {
    const { data: row } = await client
      .from('user_settings')
      .select('encrypted_api_key_v2, api_key_iv_v2')
      .eq('user_id', _currentUser.id)
      .maybeSingle();
    if (!row?.encrypted_api_key_v2) return;
    const obj = await decryptJson(_masterKey, row.encrypted_api_key_v2, row.api_key_iv_v2);
    if (!obj?.key) return;
    GEMINI_API_KEY = obj.key;
    const input = document.getElementById('apiKeyInput');
    if (input) input.value = obj.key;
    const status = document.getElementById('apiKeyStatus');
    if (status) status.innerHTML = '<span style="color:var(--accent3)">Chave restaurada (criptografada na nuvem)</span>';
    const connStatus = document.getElementById('connectionStatus');
    if (connStatus) connStatus.innerHTML = '<div class="alert alert-success">API conectada</div>';
  } catch (e) {
    console.warn('API key v2 decryption failed:', e);
  }
}

// Override saveApiKeyToStorage to also encrypt to cloud
const _originalSaveApiKey = typeof saveApiKeyToStorage === 'function' ? saveApiKeyToStorage : null;
function saveApiKeyToStorageWithCloud(key) {
  if (_isOfflineMode) {
    try { localStorage.setItem(LS_KEY_API, key); } catch (e) {}
    return;
  }
  if (_currentUser && _masterKey) {
    saveApiKeyEncryptedV2(key);
  } else if (_currentUser && _sessionPassword) {
    // Legado: conta ainda em cripto v1 (pré-Fase-G). Fase J remove este ramo.
    saveEncryptedApiKey(key, _sessionPassword);
  } else {
    try { localStorage.setItem(LS_KEY_API, key); } catch (e) {}
  }
}
