// ========================================
// STORAGE.JS - Data structures and persistence
// ========================================

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// === DEFAULT CATEGORIES (immutable reference) ===
const DEFAULT_CATEGORIES = {
  'Alimentação':  { icon: '🛒', color: '#fb923c' },
  'Moradia':      { icon: '🏠', color: '#fbbf24' },
  'Transporte':   { icon: '🚗', color: '#38bdf8' },
  'Saúde':        { icon: '💊', color: '#34d399' },
  'Lazer':        { icon: '🎬', color: '#f87171' },
  'Assinaturas':  { icon: '📱', color: '#818cf8' },
  'Educação':     { icon: '📚', color: '#60a5fa' },
  'Outros':       { icon: '📦', color: '#64748b' },
};

// Active categories (mutable, loaded from localStorage or defaults)
let CATEGORIES = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
// Always include system categories
CATEGORIES['Receita'] = { icon: '💰', color: '#34d399' };

// === RECEITA (INCOME) CATEGORIES ===
const RECEITA_CATEGORIES = {
  'Salário':      { icon: '💼', color: '#34d399' },
  'Freelance':    { icon: '💻', color: '#38bdf8' },
  'Rendimentos':  { icon: '📈', color: '#818cf8' },
  'Presente':     { icon: '🎁', color: '#fb923c' },
  'Reembolso':    { icon: '🔄', color: '#60a5fa' },
  'Outros':       { icon: '📦', color: '#64748b' },
};

function catIcon(cat) { return (CATEGORIES[cat] || RECEITA_CATEGORIES[cat] || CATEGORIES['Outros']).icon; }
function catColor(cat) { return (CATEGORIES[cat] || RECEITA_CATEGORIES[cat] || CATEGORIES['Outros']).color; }

// Returns expense categories only (no Receita, used for selects/chips)
function getExpenseCategories() {
  return Object.keys(CATEGORIES).filter(k => k !== 'Receita');
}

// === GLOBAL DATA ===
let transactions = [];

function rebuildBudgetData() {
  const cats = getExpenseCategories();
  const oldMap = {};
  budgetData.forEach(b => { oldMap[b.cat] = b; });
  budgetData.length = 0;
  cats.forEach(cat => {
    if (oldMap[cat]) {
      budgetData.push(oldMap[cat]);
    } else {
      budgetData.push({ cat, icon: catIcon(cat), limit: 0, spent: 0, color: catColor(cat) });
    }
  });
}

let budgetData = [];

let goals = [];

const allocations = [
  { name: 'Tesouro Selic (Reserva)', pct: 50, val: 'Sugestão', color: '#38bdf8' },
  { name: 'CDB Liquidez Diária',     pct: 20, val: 'Sugestão', color: '#34d399' },
  { name: 'Tesouro IPCA+ 2035',      pct: 15, val: 'Sugestão', color: '#818cf8' },
  { name: 'Fundos Imobiliários',      pct: 10, val: 'Sugestão', color: '#fb923c' },
  { name: 'Ações / ETF',              pct: 5,  val: 'Sugestão', color: '#f87171' },
];

let investments = [];

// === AI HISTORY ===
let aiHistory = [];
const LS_KEY_DATA = 'financasCasa_data';
const LS_KEY_API = 'financasCasa_apiKey';

// === PERSISTENCE (localStorage) ===
function getStorageUsage() {
  try {
    let total = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        total += localStorage[key].length * 2; // UTF-16 = 2 bytes per char
      }
    }
    return { usedBytes: total, limitBytes: 5 * 1024 * 1024, pct: Math.round((total / (5 * 1024 * 1024)) * 100) };
  } catch (e) { return { usedBytes: 0, limitBytes: 5242880, pct: 0 }; }
}

function showStorageWarning(msg) {
  let banner = document.getElementById('storageBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'storageBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 20px;background:#f87171;color:#fff;font-size:13px;font-family:DM Sans,sans-serif;text-align:center;cursor:pointer;';
    banner.onclick = () => banner.remove();
    document.body.prepend(banner);
  }
  banner.textContent = msg + ' (clique para fechar)';
}

function saveToLocalStorage() {
  const customCats = {};
  Object.entries(CATEGORIES).forEach(([k, v]) => { if (k !== 'Receita') customCats[k] = v; });
  const data = { transactions, budgetData, goals, investments, aiHistory, customCategories: customCats };
  try {
    const json = JSON.stringify(data);
    localStorage.setItem(LS_KEY_DATA, json);
    // Warn at 80% capacity
    const usage = getStorageUsage();
    if (usage.pct >= 80) {
      showStorageWarning('Armazenamento local em ' + usage.pct + '% da capacidade. Faça backup em Configurações para evitar perda de dados.');
    }
  } catch (e) {
    showStorageWarning('Erro ao salvar dados! Armazenamento local cheio ou indisponível. Faça backup imediatamente.');
  }
  // Sync to cloud if authenticated
  if (typeof scheduleSyncToSupabase === 'function') {
    scheduleSyncToSupabase();
  }
}

function loadFromLocalStorage() {
  try {
    const stored = localStorage.getItem(LS_KEY_DATA);
    if (stored) {
      const data = JSON.parse(stored);
      // Load custom categories
      if (data.customCategories && Object.keys(data.customCategories).length > 0) {
        Object.keys(CATEGORIES).forEach(k => { if (k !== 'Receita') delete CATEGORIES[k]; });
        Object.entries(data.customCategories).forEach(([k, v]) => { CATEGORIES[k] = v; });
        CATEGORIES['Receita'] = { icon: '💰', color: '#34d399' };
      }
      // Rebuild budget from categories
      rebuildBudgetData();
      // Load transactions
      transactions.length = 0;
      data.transactions?.forEach(t => transactions.push(t));
      // Load budget limits/spent
      data.budgetData?.forEach((b) => {
        const existing = budgetData.find(bd => bd.cat === b.cat);
        if (existing) Object.assign(existing, b);
      });
      goals.length = 0;
      data.goals?.forEach(g => goals.push(g));
      investments.length = 0;
      data.investments?.forEach(inv => investments.push(inv));
      aiHistory.length = 0;
      data.aiHistory?.forEach(h => aiHistory.push(h));
    } else {
      rebuildBudgetData();
    }
  } catch (e) {
    console.warn('Error loading from localStorage:', e);
    rebuildBudgetData();
  }
}

// === HELPER: Safe currency math (avoid floating point errors) ===
function roundCents(val) {
  return Math.round((parseFloat(val) || 0) * 100) / 100;
}

// === HELPER: Text sanitization for XSS prevention ===
function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

// === HELPER: Financial summaries from transactions ===
function getFinancialSummary(monthKey) {
  let currentMonth, currentYear;
  if (monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    currentYear = y;
    currentMonth = m - 1;
  } else {
    const now = new Date();
    currentMonth = now.getMonth();
    currentYear = now.getFullYear();
  }

  const thisMonthTx = transactions.filter(t => {
    const d = new Date(t.date + 'T00:00:00');
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const receitas = thisMonthTx.filter(t => t.val > 0).reduce((a, t) => a + t.val, 0);
  const despesas = thisMonthTx.filter(t => t.val < 0).reduce((a, t) => a + Math.abs(t.val), 0);
  const saldo = receitas - despesas;
  const totalInvested = investments.reduce((a, i) => a + (parseFloat(i.value) || 0), 0);

  const catBreakdown = {};
  thisMonthTx.filter(t => t.val < 0).forEach(t => {
    if (t.isBill && t.children) {
      t.children.forEach(child => {
        catBreakdown[child.cat] = (catBreakdown[child.cat] || 0) + Math.abs(child.val);
      });
    } else {
      catBreakdown[t.cat] = (catBreakdown[t.cat] || 0) + Math.abs(t.val);
    }
  });

  return { receitas, despesas, saldo, totalInvested, catBreakdown, goalsCount: goals.length };
}

// === API KEY MANAGEMENT ===
function getApiKey() {
  try { return localStorage.getItem(LS_KEY_API) || ''; }
  catch (e) { return ''; }
}

function saveApiKeyToStorage(key) {
  // If Supabase auth is active, encrypt to cloud instead of plaintext local
  if (typeof saveApiKeyToStorageWithCloud === 'function') {
    saveApiKeyToStorageWithCloud(key);
    return;
  }
  try { localStorage.setItem(LS_KEY_API, key); }
  catch (e) { console.warn('Could not save API key'); }
}
