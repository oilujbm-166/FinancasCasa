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
  'Impostos':     { icon: '🏛️', color: '#c084fc' },
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
  const data = {
    transactions, budgetData, goals, investments, aiHistory,
    customCategories: customCats,
    planejamentoMedica: (typeof planejamentoMedica !== 'undefined') ? planejamentoMedica : null
  };
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
      ensureDefaultCategories();
      // Rebuild budget from categories
      rebuildBudgetData();
      // Load transactions
      transactions.length = 0;
      data.transactions?.forEach(t => transactions.push(normalizeGroupTx(t)));
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
      // Restore módulo Planejamento Médica (se existir)
      if (typeof planejamentoMedica !== 'undefined' && data.planejamentoMedica) {
        planejamentoMedica = data.planejamentoMedica;
        if (typeof pmRestoreCategorias === 'function') pmRestoreCategorias();
      }
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

// === HELPER: Garante que categorias default introduzidas em updates estão presentes.
// Necessário quando usuários têm customCategories salvas que não incluem categorias adicionadas depois.
function ensureDefaultCategories() {
  if (!CATEGORIES['Impostos']) {
    CATEGORIES['Impostos'] = { icon: '🏛️', color: '#c084fc' };
  }
}

// === HELPER: Totais de um contracheque (bruto, descontos, líquido).
// Função pura: soma lançamentos por type.
function calcPayslipTotals(lancamentos) {
  const arr = Array.isArray(lancamentos) ? lancamentos : [];
  let bruto = 0;
  let descontos = 0;
  arr.forEach(l => {
    const v = parseFloat(l.value) || 0;
    if (l.type === 'receita') bruto += v;
    else descontos += v;
  });
  return {
    bruto: roundCents(bruto),
    descontos: roundCents(descontos),
    liquido: roundCents(bruto - descontos)
  };
}

// === HELPER: Constrói o objeto _pendingPayslip a partir da resposta parseada da IA.
// Função pura, testável isoladamente. Retorna null se não houver lançamentos.
function buildPendingPayslip(parsed) {
  const lancamentos = Array.isArray(parsed.lancamentos) ? parsed.lancamentos : [];
  if (lancamentos.length === 0) return null;
  const totals = calcPayslipTotals(lancamentos);
  return {
    empregador: parsed.empregador || '',
    competencia: parsed.competencia || '',
    bruto: (parsed.bruto !== undefined && parsed.bruto !== null)
      ? roundCents(parseFloat(parsed.bruto) || 0)
      : totals.bruto,
    liquido: (parsed.liquido !== undefined && parsed.liquido !== null)
      ? roundCents(parseFloat(parsed.liquido) || 0)
      : totals.liquido,
    lancamentos: lancamentos
  };
}

// === HELPER: Constrói a transação pai/filho final do contracheque para salvar em `transactions`.
// Função pura. Retorna null se pending for inválido.
// Invariantes garantidas:
//   - parent.val === +liquido (positivo, crédito na conta)
//   - sum(children.val) === parent.val (todos os filhos assinados)
//   - children[i].type ∈ {'receita', 'despesa'}
//   - isGroup === true, groupType === 'payslip'
function buildPayslipTransaction(pending) {
  if (!pending || !Array.isArray(pending.lancamentos) || pending.lancamentos.length === 0) return null;
  const { competencia, empregador, bruto, liquido, lancamentos } = pending;
  const dateStr = competencia ? (competencia + '-01') : new Date().toISOString().split('T')[0];
  const mesLabel = competencia ? competencia.split('-').reverse().join('/') : '';
  const empLabel = empregador || '—';

  const children = lancamentos.map(l => {
    const rawVal = parseFloat(l.value) || 0;
    const type = l.type === 'receita' ? 'receita' : 'despesa';
    const signedVal = type === 'receita' ? roundCents(rawVal) : roundCents(-rawVal);
    const requestedCat = l.category || 'Outros';
    const cat = (CATEGORIES[requestedCat] || requestedCat === 'Receita') ? requestedCat : 'Outros';
    return {
      date: l.date || dateStr,
      name: l.name || '—',
      cat: cat,
      val: signedVal,
      method: 'Folha',
      icon: catIcon(cat),
      color: catColor(cat),
      type: type
    };
  });

  return {
    date: dateStr,
    name: `Contracheque — ${empLabel} — ${mesLabel}`,
    cat: 'Receita',
    val: roundCents(liquido),
    method: 'Folha',
    icon: '💼',
    color: '#34d399',
    isGroup: true,
    groupType: 'payslip',
    groupMeta: {
      competencia: competencia || '',
      empregador: empregador || '',
      bruto: roundCents(bruto || 0)
    },
    children: children
  };
}

// === HELPER: Normaliza transações "grupo" (pai com filhos)
// Converte o formato legado isBill (só fatura) para o modelo genérico isGroup/groupType/groupMeta.
// Mutação in-place: roda no boot para transações vindas do localStorage ou Supabase.
function normalizeGroupTx(t) {
  if (!t || typeof t !== 'object') return t;
  if (t.isBill === true && !t.isGroup) {
    t.isGroup = true;
    t.groupType = 'invoice';
    t.groupMeta = {
      dueDate: t.dueDate,
      billMonth: t.billMonth,
      cardDigits: t.cardDigits
    };
  }
  if (Array.isArray(t.children)) {
    t.children.forEach(c => { if (c && !c.type) c.type = 'despesa'; });
  }
  return t;
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

  // Grupos são "transparentes" para cálculo: sempre iteramos os filhos e somamos por type.
  // Para grupos, parent.val == sum(children) por construção, então não conta o pai diretamente.
  let receitas = 0;
  let despesas = 0;
  const catBreakdown = {};
  thisMonthTx.forEach(t => {
    if (t.isGroup && t.children) {
      t.children.forEach(child => {
        const v = Math.abs(child.val);
        if (child.type === 'receita') {
          receitas += v;
        } else {
          despesas += v;
          catBreakdown[child.cat] = (catBreakdown[child.cat] || 0) + v;
        }
      });
    } else if (t.val > 0) {
      receitas += t.val;
    } else if (t.val < 0) {
      despesas += Math.abs(t.val);
      catBreakdown[t.cat] = (catBreakdown[t.cat] || 0) + Math.abs(t.val);
    }
  });
  const saldo = receitas - despesas;
  const totalInvested = investments.reduce((a, i) => a + (parseFloat(i.value) || 0), 0);

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
