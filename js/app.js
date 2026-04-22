// ========================================
// APP.JS - Main application logic
// ========================================

// === MONTH NAMES ===
const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// === MODAL FUNCTIONS ===
function openAddTx() {
  document.getElementById('txModal').classList.add('show');
  document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('txTipo').value = 'despesa';
  updateTxCategories();
}

function closeAddTx() {
  document.getElementById('txModal').classList.remove('show');
  document.getElementById('txName').value = '';
  document.getElementById('txVal').value = '';
}

function updateTxCategories() {
  const tipo = document.getElementById('txTipo').value;
  const catSelect = document.getElementById('txCat');
  if (tipo === 'receita') {
    catSelect.innerHTML = '<option value="Receita">Receita</option>';
    catSelect.disabled = true;
  } else {
    catSelect.innerHTML = Object.keys(CATEGORIES)
      .filter(c => c !== 'Receita')
      .map(c => `<option value="${c}">${c}</option>`).join('');
    catSelect.disabled = false;
  }
}

function saveTx() {
  const tipo = document.getElementById('txTipo').value;
  const date = document.getElementById('txDate').value;
  const name = document.getElementById('txName').value.trim();
  const cat = document.getElementById('txCat').value;
  const val = parseFloat(document.getElementById('txVal').value);
  const method = document.getElementById('txMethod').value;

  if (!name || !val || val <= 0 || !date) {
    alert('Preencha todos os campos corretamente!');
    return;
  }

  const finalCat = tipo === 'receita' ? 'Receita' : cat;
  const tx = {
    date,
    name,
    cat: finalCat,
    val: roundCents(tipo === 'receita' ? Math.abs(val) : -Math.abs(val)),
    method,
    icon: catIcon(finalCat),
    color: catColor(finalCat)
  };

  // Se a categoria escolhida é médica, injeta contexto fiscal para aparecer no módulo
  const catDef = CATEGORIES[finalCat];
  if (catDef && catDef._medica && catDef.fiscal && catDef.fiscal.dedutivelLC && tipo === 'despesa') {
    const fator = catDef.fiscal.fatorPadrao || 1;
    tx.fiscal = {
      contexto: 'medica_pf',
      dedutivelLC: true,
      fatorAplicado: fator,
      valorDedutivel: roundCents(Math.abs(val) * fator),
      competencia: date.slice(0, 7),
    };
  }

  const dupes = findDuplicates([tx]);
  if (dupes.length > 0 && !confirm('Transação similar já existe (' + name + '). Adicionar mesmo assim?')) return;

  transactions.unshift(tx);
  updateBudgetFromTransactions();
  refreshAll();
  closeAddTx();
}

// === CURRENCY FORMAT ===
function formatBRL(v) {
  return 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// === DUPLICATE DETECTION ===
function txHash(date, val, name) {
  return (date || '') + '|' + Math.abs(val).toFixed(2) + '|' + (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findDuplicates(newItems) {
  const existing = new Set(transactions.map(t => txHash(t.date, t.val, t.name)));
  return newItems.filter(item => existing.has(txHash(item.date, item.val || item.value, item.name)));
}

// === DYNAMIC MONTH SELECTOR ===
function initMonthSelector() {
  const now = new Date();
  const container = document.getElementById('monthTabs');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = MONTH_NAMES[d.getMonth()];
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const isActive = i === 0;
    container.innerHTML += `<div class="month-tab${isActive ? ' active' : ''}" data-month="${key}" onclick="selectMonth('${key}', this)">${label}</div>`;
  }
}

let selectedMonth = null; // null = current month

function selectMonth(key, el) {
  document.querySelectorAll('.month-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  selectedMonth = key;
  refreshAll();
}

let accountingMode = 'caixa'; // 'caixa' or 'competencia'

function toggleAccountingMode() {
  accountingMode = accountingMode === 'caixa' ? 'competencia' : 'caixa';
  const btn = document.getElementById('accountingModeBtn');
  if (btn) btn.textContent = accountingMode === 'caixa' ? 'Caixa' : 'Competência';
  refreshAll();
}

function getFilteredTransactions() {
  if (!selectedMonth) {
    const now = new Date();
    selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  if (accountingMode === 'competencia') {
    // In accrual mode: bills are exploded into children by their purchase date
    const result = [];
    transactions.forEach(t => {
      if (t.isGroup && t.children) {
        // Include children whose purchase date matches selected month
        t.children.forEach(child => {
          if (child.date && child.date.startsWith(selectedMonth)) {
            result.push({ ...child, _fromBill: t.name });
          }
        });
      } else if (t.date && t.date.startsWith(selectedMonth)) {
        result.push(t);
      }
    });
    return result;
  }

  return transactions.filter(t => t.date && t.date.startsWith(selectedMonth));
}

// === DASHBOARD CARDS ===
function updateDashboardCards() {
  const monthTx = getFilteredTransactions();
  const allReceitas = transactions.filter(t => t.val > 0).reduce((a, t) => a + t.val, 0);
  const allDespesas = transactions.filter(t => t.val < 0).reduce((a, t) => a + Math.abs(t.val), 0);

  const receitas = monthTx.filter(t => t.val > 0).reduce((a, t) => a + t.val, 0);
  const despesas = monthTx.filter(t => t.val < 0).reduce((a, t) => a + Math.abs(t.val), 0);
  const saldo = receitas - despesas;

  // Update month labels
  if (selectedMonth) {
    const [y, m] = selectedMonth.split('-');
    const label = MONTH_NAMES[parseInt(m) - 1];
    const el1 = document.getElementById('dashMesLabel');
    const el2 = document.getElementById('dashMesLabel2');
    if (el1) el1.textContent = label;
    if (el2) el2.textContent = label;
  }

  document.getElementById('dashSaldo').textContent = formatBRL(allReceitas - allDespesas);
  document.getElementById('dashReceitas').textContent = formatBRL(receitas);
  document.getElementById('dashDespesas').textContent = formatBRL(despesas);

  if (transactions.length > 0) {
    const totalSaldo = allReceitas - allDespesas;
    document.getElementById('dashSaldoDelta').textContent = totalSaldo >= 0 ? '↑ Saldo positivo' : '↓ Saldo negativo';
    document.getElementById('dashSaldoDelta').className = 'card-delta ' + (totalSaldo >= 0 ? 'delta-up' : 'delta-down');
    document.getElementById('dashSaldoBadge').className = 'badge ' + (totalSaldo >= 0 ? 'badge-green' : 'badge-red');
    document.getElementById('dashSaldoBadge').textContent = totalSaldo >= 0 ? '↑' : '↓';
    document.getElementById('dashReceitasDelta').textContent = monthTx.filter(t => t.val > 0).length + ' entrada(s)';
    document.getElementById('dashDespesasDelta').textContent = monthTx.filter(t => t.val < 0).length + ' saída(s)';
    updateHealthScore(receitas, despesas, saldo);
  }

  const totalLimit = budgetData.reduce((a, b) => a + b.limit, 0);
  const totalSpent = budgetData.reduce((a, b) => a + b.spent, 0);
  document.getElementById('budgetTotal').textContent = formatBRL(totalLimit);
  document.getElementById('budgetSpent').textContent = formatBRL(totalSpent);
  document.getElementById('budgetAvail').textContent = formatBRL(Math.max(0, totalLimit - totalSpent));
}

// === HEALTH SCORE (improved criteria) ===
function updateHealthScore(receitas, despesas, saldo) {
  if (transactions.length === 0) return;

  const savingsRate = receitas > 0 ? (saldo / receitas) : 0;
  const liquidTotal = getLiquidTotal();
  const now = new Date();

  // 1. Savings rate (0-25 pts): linear up to 30%
  const s1 = savingsRate > 0 ? Math.min(25, Math.round((savingsRate / 0.30) * 25)) : 0;

  // 2. Expense coverage by liquid investments (0-20 pts): months covered, up to 6
  const monthsCovered = despesas > 0 ? liquidTotal / despesas : 0;
  const s2 = Math.min(20, Math.round((monthsCovered / 6) * 20));

  // 3. Budget adherence (0-15 pts): % of categories within limit
  const catsWithLimit = budgetData.filter(b => b.limit > 0);
  const withinBudget = catsWithLimit.filter(b => b.spent <= b.limit).length;
  const s3 = catsWithLimit.length > 0 ? Math.round((withinBudget / catsWithLimit.length) * 15) : 0;

  // 4. Investment diversification (0-15 pts): distinct types × 3
  const distinctTypes = new Set(investments.map(i => i.type)).size;
  const s4 = Math.min(15, distinctTypes * 3);

  // 5. Goal progress (0-15 pts): weighted average completion
  let s5 = 0;
  if (goals.length > 0) {
    const avgProgress = goals.reduce((a, g) => {
      const target = parseFloat(g.target) || 1;
      const current = parseFloat(g.current) || 0;
      return a + Math.min(1, current / target);
    }, 0) / goals.length;
    s5 = Math.round(avgProgress * 15);
  }

  // 6. Trend (0-10 pts): current savings rate vs avg of last 3 months
  let s6 = 0;
  let prevRates = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mTx = transactions.filter(t => t.date && t.date.startsWith(key));
    const mInc = mTx.filter(t => t.val > 0).reduce((a, t) => a + t.val, 0);
    const mExp = mTx.filter(t => t.val < 0).reduce((a, t) => a + Math.abs(t.val), 0);
    if (mInc > 0) prevRates.push((mInc - mExp) / mInc);
  }
  if (prevRates.length > 0) {
    const avgPrevRate = prevRates.reduce((a, r) => a + r, 0) / prevRates.length;
    if (savingsRate >= avgPrevRate) s6 = 10;
    else if (savingsRate >= avgPrevRate - 0.05) s6 = 5;
  }

  const score = Math.min(100, Math.max(0, s1 + s2 + s3 + s4 + s5 + s6));

  const circle = document.getElementById('scoreCircle');
  const offset = 364.4 * (1 - score / 100);
  const color = score >= 70 ? '#34d399' : score >= 40 ? '#fbbf24' : '#f87171';
  circle.setAttribute('stroke', color);
  circle.setAttribute('stroke-dashoffset', offset);
  document.getElementById('scoreNum').textContent = score;
  document.getElementById('scoreNum').style.color = color;
  const label = score >= 80 ? 'Excelente' : score >= 60 ? 'Bom' : score >= 40 ? 'Regular' : 'Atenção';
  document.getElementById('scoreLabel').textContent = label;
  document.getElementById('scoreLabel').style.color = color;

  // Contextual alerts per weak criterion
  const alerts = document.getElementById('healthAlerts');
  let html = '';
  if (s1 >= 20) html += '<div class="alert alert-success" style="font-size:12px;margin-bottom:8px">Economia de ' + Math.round(savingsRate * 100) + '% da renda — excelente!</div>';
  else if (s1 > 0) html += '<div class="alert alert-warn" style="font-size:12px;margin-bottom:8px">Economia de ' + Math.round(savingsRate * 100) + '% — tente chegar a 20-30%</div>';
  else html += '<div class="alert alert-danger" style="font-size:12px;margin-bottom:8px">Gastos maiores que receitas este mês</div>';

  if (s2 < 10) html += '<div class="alert alert-warn" style="font-size:12px;margin-bottom:8px">Reserva líquida cobre ' + monthsCovered.toFixed(1) + ' mês(es) — meta: 6 meses</div>';
  if (s3 === 0 && catsWithLimit.length === 0) html += '<div class="alert alert-info" style="font-size:12px;margin-bottom:8px">Defina limites de orçamento para melhorar o score</div>';
  else if (s3 < 10) html += '<div class="alert alert-warn" style="font-size:12px;margin-bottom:8px">' + (catsWithLimit.length - withinBudget) + ' categoria(s) acima do orçamento</div>';
  if (s4 < 6) html += '<div class="alert alert-info" style="font-size:12px;margin-bottom:8px">Diversifique: ' + distinctTypes + ' tipo(s) de investimento — considere pelo menos 3</div>';
  if (goals.length === 0) html += '<div class="alert alert-info" style="font-size:12px;margin-bottom:8px">Crie metas financeiras na aba Metas</div>';
  else if (s5 < 8) html += '<div class="alert alert-warn" style="font-size:12px;margin-bottom:8px">Metas com progresso baixo — revise os valores ou prazos</div>';
  if (s6 === 0 && prevRates.length > 0) html += '<div class="alert alert-warn" style="font-size:12px;margin-bottom:8px">Tendência negativa — taxa de economia caindo vs meses anteriores</div>';
  alerts.innerHTML = html;
}

function updateBudgetFromTransactions() {
  budgetData.forEach(b => b.spent = 0);
  const monthTx = getFilteredTransactions();
  monthTx.forEach(t => {
    if (t.isGroup && t.children) {
      // Grupo transparente: itera filhos, conta só despesas no orçamento.
      t.children.forEach(child => {
        if (child.type === 'receita') return;
        const b = budgetData.find(bd => bd.cat === child.cat);
        if (b) b.spent += Math.abs(child.val);
      });
    } else if (t.val < 0) {
      const b = budgetData.find(bd => bd.cat === t.cat);
      if (b) b.spent += Math.abs(t.val);
    }
  });
}

// Chart instance cache for update-in-place (avoids destroy/recreate)
const _charts = {};

function refreshAll() {
  updateBudgetFromTransactions();
  renderRecentTx();
  renderDespesas();
  updateDashboardCards();
  renderCashflowChart();
  renderCatChart();
  renderBudgetDonut();
  renderBudgetBars();
  renderMetas();
  renderInvestments();
  renderReceitas();
  renderCatChips();
  renderCategoryManager();
  renderProjecoes();
  // Re-render do módulo Planejamento Médica se estiver ativo e a section estiver visível
  if (typeof renderPlanejamentoMedica === 'function' && typeof isPlanejamentoMedicaAtivo === 'function' && isPlanejamentoMedicaAtivo()) {
    const section = document.getElementById('section-planejamentoMedica');
    if (section && section.classList.contains('active')) {
      renderPlanejamentoMedica();
    }
  }
  saveToLocalStorage();
}

// === RESET ALL DATA ===
function resetAllData() {
  if (!confirm('Tem certeza? Isso vai apagar TODAS as transações, orçamentos e metas. Esta ação não pode ser desfeita.')) return;
  transactions.length = 0;
  budgetData.forEach(b => { b.limit = 0; b.spent = 0; });
  goals.length = 0;
  investments.length = 0;
  aiHistory.length = 0;
  try { localStorage.removeItem(LS_KEY_DATA); } catch (e) {}
  refreshAll();
  document.getElementById('dashSaldo').textContent = 'R$ 0,00';
  document.getElementById('dashReceitas').textContent = 'R$ 0,00';
  document.getElementById('dashDespesas').textContent = 'R$ 0,00';
  document.getElementById('dashSaldoDelta').textContent = 'Dados resetados';
  document.getElementById('dashSaldoDelta').style.color = 'var(--text3)';
  document.getElementById('scoreCircle').setAttribute('stroke-dashoffset', '364.4');
  document.getElementById('scoreCircle').setAttribute('stroke', '#64748b');
  document.getElementById('scoreNum').textContent = '—';
  document.getElementById('scoreNum').style.color = '#64748b';
  document.getElementById('scoreLabel').textContent = 'Sem dados';
  document.getElementById('scoreLabel').style.color = 'var(--text3)';
  document.getElementById('healthAlerts').innerHTML = '<div class="alert alert-info" style="font-size:12px">Dados resetados. Importe seus extratos para recomeçar.</div>';
  alert('Todos os dados foram resetados!');
}

// === BACKUP REMINDER (Fase I) ===
// Dados são criptografados ponta-a-ponta; sem senha, não há recuperação. Banner
// no topo do app reforça a rotina de exportar JSON mensalmente.
function maybeShowBackupReminder() {
  const last = parseInt(localStorage.getItem('fc_last_backup') || '0', 10);
  const dismissedUntil = parseInt(localStorage.getItem('fc_backup_reminder_dismissed') || '0', 10);
  const now = Date.now();
  if (now < dismissedUntil) return;
  if (last && now - last < 30 * 86400 * 1000) return;
  const banner = document.getElementById('backupReminderBanner');
  if (banner) banner.style.display = 'block';
}
function markBackupDone() {
  localStorage.setItem('fc_last_backup', String(Date.now()));
  const banner = document.getElementById('backupReminderBanner');
  if (banner) banner.style.display = 'none';
  updateLastBackupLabel();
}
function dismissBackupReminder(days) {
  if (days > 0) localStorage.setItem('fc_backup_reminder_dismissed', String(Date.now() + days * 86400 * 1000));
  const banner = document.getElementById('backupReminderBanner');
  if (banner) banner.style.display = 'none';
}
function updateLastBackupLabel() {
  const el = document.getElementById('lastBackupLabel');
  if (!el) return;
  const last = parseInt(localStorage.getItem('fc_last_backup') || '0', 10);
  if (!last) { el.textContent = 'Último backup: nunca.'; return; }
  const d = new Date(last);
  el.textContent = `Último backup: ${d.toLocaleDateString('pt-BR')} (${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}).`;
}

// === BACKUP DATA ===
function backupData() {
  const customCats = {};
  Object.entries(CATEGORIES).forEach(([k, v]) => { if (k !== 'Receita') customCats[k] = v; });
  // v4: inclui perfil e planejamentoMedica — necessário pra que o backup seja
  // um plano B completo se o usuário perder a senha (envelope encryption).
  const data = {
    version: 4,
    date: new Date().toISOString(),
    transactions, budgetData, goals, investments,
    customCategories: customCats,
    aiHistory,
    perfil: (typeof perfil !== 'undefined') ? perfil : { casal: '' },
    planejamentoMedica: (typeof planejamentoMedica !== 'undefined') ? planejamentoMedica : null
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'financas-casa-backup-' + new Date().toISOString().split('T')[0] + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// === RESTORE BACKUP ===
function restoreBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.version || !data.transactions) {
        alert('Arquivo de backup inválido!');
        return;
      }
      if (!confirm('Restaurar backup de ' + (data.date ? new Date(data.date).toLocaleDateString('pt-BR') : '?') + '? Isso substituirá todos os dados atuais.')) return;

      // Restore custom categories (v3+)
      if (data.customCategories && Object.keys(data.customCategories).length > 0) {
        Object.keys(CATEGORIES).forEach(k => { if (k !== 'Receita') delete CATEGORIES[k]; });
        Object.entries(data.customCategories).forEach(([k, v]) => { CATEGORIES[k] = v; });
        CATEGORIES['Receita'] = { icon: '💰', color: '#34d399' };
      }
      rebuildBudgetData();

      transactions.length = 0;
      data.transactions.forEach(t => transactions.push(t));

      // Restore budget limits by category name (not index)
      if (data.budgetData) {
        data.budgetData.forEach(b => {
          const existing = budgetData.find(bd => bd.cat === b.cat);
          if (existing) Object.assign(existing, b);
        });
      }
      if (data.goals) {
        goals.length = 0;
        data.goals.forEach(g => goals.push(g));
      }
      if (data.investments) {
        investments.length = 0;
        data.investments.forEach(inv => investments.push(inv));
      }
      if (data.aiHistory) {
        aiHistory.length = 0;
        data.aiHistory.forEach(h => aiHistory.push(h));
      }
      migrateOldInvestments();

      // v4+: perfil (nome do lar) e planejamentoMedica. Espelha loadFromSupabase (js/supabase.js:881-888).
      if (data.perfil && typeof perfil !== 'undefined') {
        perfil = { casal: data.perfil.casal || '' };
        const perfilInput = document.getElementById('perfilCasalInput');
        if (perfilInput) perfilInput.value = perfil.casal || '';
        if (typeof refreshProfileDisplay === 'function') refreshProfileDisplay();
      }
      if (data.planejamentoMedica && typeof planejamentoMedica !== 'undefined') {
        planejamentoMedica = data.planejamentoMedica;
        if (typeof pmRestoreCategorias === 'function') pmRestoreCategorias();
      }

      refreshAll();
      alert('Backup restaurado com sucesso! ' + transactions.length + ' transações carregadas.');

      // Empurra o estado restaurado pra nuvem pra evitar que o cloud sobreponha depois.
      // Silenciosamente skippa em offline ou sem usuário autenticado.
      if (typeof scheduleSyncToSupabase === 'function'
          && typeof _isOfflineMode !== 'undefined' && !_isOfflineMode
          && typeof _currentUser !== 'undefined' && _currentUser) {
        scheduleSyncToSupabase();
      }
    } catch (err) {
      alert('Erro ao ler backup: ' + err.message);
    }
  };
  input.click();
}

// === MODAL EVENT LISTENERS ===
document.addEventListener('DOMContentLoaded', () => {
  ['txModal', 'editModal', 'investModal', 'goalModal', 'receitaModal', 'categoryModal', 'pmPlantaoModal', 'pmDespesaModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => { if (e.target.id === id) el.classList.remove('show'); });
  });
});

// === DATA MIGRATION ===
function migrateOldInvestments() {
  investments.forEach(inv => {
    if (inv.currentValue !== undefined && inv.value === undefined) {
      inv.value = parseFloat(inv.currentValue) || 0;
      delete inv.currentValue;
    }
    if (inv.value === undefined) inv.value = 0;
    if (inv.rate === undefined) inv.rate = 0;
    if (inv.type === undefined) inv.type = 'Outro';
    if (inv.date === undefined) inv.date = '';
    if (inv.liquidity === undefined) inv.liquidity = INVEST_LIQUIDITY_DEFAULTS[inv.type] || 'illiquid';
  });
}

// === INITIALIZATION ===
let _appInitialized = false;

function initApp() {
  if (_appInitialized) return;
  _appInitialized = true;

  loadFromLocalStorage();
  migrateOldInvestments();

  // Restore API key UI (only in offline mode; cloud mode restores via decryption)
  const savedKey = getApiKey();
  if (savedKey) {
    GEMINI_API_KEY = savedKey;
    document.getElementById('apiKeyInput').value = savedKey;
    document.getElementById('apiKeyStatus').innerHTML = '<span style="color:var(--accent3)">Chave salva</span>';
    document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-success">API conectada</div><div style="font-size:13px;color:var(--text2);line-height:1.6"><strong>Funcionalidades ativas:</strong><br>Consultor IA, classificação de extratos e contracheques</div>';
  }

  initMonthSelector();
  renderRecentTx();
  renderDespesas();
  renderBudgetBars();
  renderPatrimonio();
  renderAllocList();
  renderInvSuggestions();
  renderInvestments();
  renderMetas();
  renderReceitas();
  renderCatChips();
  renderCategoryManager();
  renderAiSuggestions();
  updateDashboardCards();

  // Defer chart rendering to next frame for Safari layout compatibility
  requestAnimationFrame(function() {
    renderCashflowChart();
    renderCatChart();
    renderBudgetDonut();
    renderProjecoes();
  });

  if (typeof updateMedicaNavVisibility === 'function') updateMedicaNavVisibility();

  const perfilInput = document.getElementById('perfilCasalInput');
  if (perfilInput && typeof perfil !== 'undefined') perfilInput.value = perfil.casal || '';

  // Popula sidebar (avatar + nome do lar) a partir de perfil.casal
  refreshProfileDisplay();

  // Primeiro acesso? (perfil.casal vazio) — mostra modal de onboarding por cima do app.
  // Chamado depois que loadFromSupabase/loadFromLocalStorage populou perfil, então não dispara
  // para quem já configurou o nome do lar.
  maybeShowOnboarding();

  // Convites (Fase 1.1): só pra usuário autenticado. RLS garante que cada um vê só os próprios.
  // Em modo offline, a seção fica escondida (não tem como falar com a Edge Function nem com o DB).
  const invitesCard = document.getElementById('invitesCard');
  if (invitesCard && typeof _currentUser !== 'undefined' && _currentUser && !_isOfflineMode) {
    invitesCard.style.display = 'block';
    loadInvitesList();
  }

  // Backup reminder (Fase I): "Último backup: X" + banner no topo se 30 dias sem backup.
  updateLastBackupLabel();
  maybeShowBackupReminder();
}

document.addEventListener('DOMContentLoaded', () => {
  // Auth gate: initAuth() will call initApp() after login or offline choice
  if (typeof initAuth === 'function') {
    initAuth();
  } else {
    // Supabase SDK not loaded — go straight to app
    initApp();
  }
});

// === HELPER: Deriva iniciais para o avatar a partir do nome do casal/lar.
// Ignora conectivos comuns em PT-BR: "&", "+", "e", "ou", "y", "da/de/do/das/dos", "a/o/as/os".
// Exemplos:
//   "Júlio & Elaynne"  → "JE"
//   "João e Maria"     → "JM"
//   "Família Silva"    → "FS"
//   "Ana"              → "A"
//   ""                 → "" (caller aplica fallback)
// Função pura, testável isoladamente.
function deriveInitials(name) {
  if (!name || typeof name !== 'string') return '';
  const conectivos = new Set(['&', '+', 'e', 'ou', 'y', 'da', 'de', 'do', 'das', 'dos', 'a', 'o', 'as', 'os']);
  const tokens = name
    .split(/[\s&+]+/)
    .map(t => t.trim())
    .filter(t => t && !conectivos.has(t.toLowerCase()));
  if (tokens.length === 0) return '';
  return tokens.slice(0, 2).map(t => t.charAt(0).toUpperCase()).join('');
}

// === HELPER: Atualiza a sidebar (avatar + nome) a partir de perfil.casal.
// Chamada após: carregar dados (initApp), salvar perfil (savePerfilCasal), sync cloud (supabase.js).
// Fallback quando perfil.casal vazio: "Minha Casa" / "MC" — neutro, permite que qualquer família
// use o app sem ver o nome dos outros.
function refreshProfileDisplay() {
  const nomeConfig = (typeof perfil !== 'undefined' && perfil && perfil.casal) ? perfil.casal.trim() : '';
  const nomeDisplay = nomeConfig || 'Minha Casa';
  const initials = deriveInitials(nomeConfig) || 'MC';
  const avatarEl = document.getElementById('profileAvatar');
  const nameEl = document.getElementById('profileName');
  if (avatarEl) avatarEl.textContent = initials;
  if (nameEl) nameEl.textContent = nomeDisplay;
}

// === ONBOARDING DE PRIMEIRO ACESSO ===
// Dispara no fim de initApp() quando perfil.casal está vazio. Vale tanto para contas novas
// autenticadas (sync trouxe perfil vazio) quanto para modo offline em origem nova.
// Usuário pode "pular" — aí fica "Minha Casa" via fallback de refreshProfileDisplay. Ele pode
// revisitar a qualquer momento em Configurações → Perfil.
function maybeShowOnboarding() {
  const hasName = (typeof perfil !== 'undefined' && perfil && perfil.casal && perfil.casal.trim());
  if (hasName) return;
  const modal = document.getElementById('onboardingModal');
  if (!modal) return;
  modal.classList.add('show');
  // Foco no input pra o usuário já poder digitar
  const input = document.getElementById('onboardingNameInput');
  if (input) setTimeout(() => input.focus(), 100);
}

function completeOnboarding() {
  const input = document.getElementById('onboardingNameInput');
  if (!input) return;
  const valor = input.value.trim().slice(0, 80);
  const err = document.getElementById('onboardingError');
  if (!valor) {
    if (err) { err.textContent = 'Digite um nome ou clique em "Pular".'; err.style.display = 'block'; }
    return;
  }
  if (typeof perfil === 'undefined') return;
  perfil.casal = valor;
  // Espelha no input de Configurações → Perfil para manter a UI coerente se o usuário abrir depois
  const perfilInput = document.getElementById('perfilCasalInput');
  if (perfilInput) perfilInput.value = valor;
  saveToLocalStorage();
  refreshProfileDisplay();
  const modal = document.getElementById('onboardingModal');
  if (modal) modal.classList.remove('show');
}

function skipOnboarding() {
  // Usuário não quis nomear agora — fallback "Minha Casa" / "MC" continua.
  // Pode definir depois em Configurações → Perfil.
  const modal = document.getElementById('onboardingModal');
  if (modal) modal.classList.remove('show');
}

// === CONVITES (Fase 1.1) ===
// Chama Edge Function generate-invite (autenticada) com email + duração escolhida.
// O dono é inferido pelo JWT no backend (created_by = auth.uid()).
async function generateInvite() {
  const email = (document.getElementById('inviteEmailInput') || {}).value || '';
  const durationStr = (document.getElementById('inviteDurationSelect') || {}).value || '24';
  const trimmed = email.trim();
  const errEl = document.getElementById('inviteError');
  if (errEl) errEl.style.display = 'none';

  if (!trimmed) {
    if (errEl) { errEl.textContent = 'Informe o email do convidado.'; errEl.style.display = 'block'; }
    return;
  }

  const client = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  if (!client || typeof _currentUser === 'undefined' || !_currentUser) {
    if (errEl) { errEl.textContent = 'Você precisa estar logado para gerar convites.'; errEl.style.display = 'block'; }
    return;
  }
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token) {
    if (errEl) { errEl.textContent = 'Sessão inválida. Recarregue a página e faça login de novo.'; errEl.style.display = 'block'; }
    return;
  }

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/generate-invite`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email: trimmed, durationHours: parseInt(durationStr, 10) }),
    });
  } catch (e) {
    if (errEl) { errEl.textContent = 'Falha de rede ao chamar a função.'; errEl.style.display = 'block'; }
    return;
  }

  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    if (errEl) {
      errEl.textContent = `Erro ao gerar convite (HTTP ${res.status}): ${data?.error || 'sem detalhes'}`;
      errEl.style.display = 'block';
    }
    return;
  }

  // Sucesso: mostra código e atualiza lista
  const codeEl = document.getElementById('inviteCodeDisplay');
  const expEl = document.getElementById('inviteExpiresDisplay');
  if (codeEl) codeEl.textContent = data.code;
  if (expEl) {
    const exp = new Date(data.expires_at);
    expEl.textContent = `Válido até ${exp.toLocaleString('pt-BR')} · vinculado a ${esc(trimmed)}`;
  }
  const wrap = document.getElementById('inviteGenerated');
  if (wrap) wrap.style.display = 'block';

  // Limpa input pra próxima geração
  const emailInput = document.getElementById('inviteEmailInput');
  if (emailInput) emailInput.value = '';

  loadInvitesList();
}

async function copyInviteCode() {
  const codeEl = document.getElementById('inviteCodeDisplay');
  if (!codeEl) return;
  try {
    await navigator.clipboard.writeText((codeEl.textContent || '').trim());
    const btn = (typeof event !== 'undefined' && event && event.target) ? event.target : null;
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '✓ Copiado!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  } catch (e) {
    // Clipboard API pode falhar em http (não-https) ou contexts antigos — fallback silencioso
  }
}

async function loadInvitesList() {
  const listEl = document.getElementById('invitesPendingList');
  if (!listEl) return;
  const client = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  if (!client || typeof _currentUser === 'undefined' || !_currentUser) {
    listEl.innerHTML = '<span style="color:var(--text3)">—</span>';
    return;
  }
  // RLS filtra automaticamente pelos invites onde created_by = auth.uid()
  const { data, error } = await client
    .from('invites')
    .select('code, email, created_at, expires_at, used_at, used_by')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    listEl.innerHTML = `<span style="color:var(--danger)">Erro ao carregar: ${esc(error.message)}</span>`;
    return;
  }
  if (!data || data.length === 0) {
    listEl.innerHTML = '<span style="color:var(--text3)">Nenhum convite gerado ainda.</span>';
    return;
  }

  const now = Date.now();
  const rows = data.map(i => {
    const usedAt = i.used_at ? new Date(i.used_at) : null;
    const expiresAt = new Date(i.expires_at);
    let statusText, statusColor;
    if (usedAt) {
      statusText = `usado em ${usedAt.toLocaleDateString('pt-BR')}`;
      statusColor = 'var(--text3)';
    } else if (expiresAt.getTime() < now) {
      statusText = 'expirado';
      statusColor = 'var(--danger)';
    } else {
      const diffH = Math.round((expiresAt.getTime() - now) / 3_600_000);
      statusText = diffH < 24 ? `expira em ${diffH}h` : `expira em ${Math.round(diffH / 24)}d`;
      statusColor = 'var(--accent3)';
    }
    const canRevoke = !usedAt;
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
      <div style="min-width:0;flex:1">
        <div style="font-family:DM Mono,monospace;color:${statusColor};font-weight:500">${esc(i.code)}</div>
        <div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.email)} · ${statusText}</div>
      </div>
      ${canRevoke ? `<button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:var(--danger)" onclick="revokeInvite('${esc(i.code)}')" title="Revogar este convite">✕</button>` : ''}
    </div>`;
  }).join('');
  listEl.innerHTML = rows;
}

async function revokeInvite(code) {
  if (!confirm(`Revogar o convite "${code}"? Esta ação é irreversível.`)) return;
  const client = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
  if (!client) return;
  const { error } = await client.from('invites').delete().eq('code', code);
  if (error) {
    alert('Erro ao revogar: ' + error.message);
    return;
  }
  loadInvitesList();
}

function savePerfilCasal() {
  const input = document.getElementById('perfilCasalInput');
  if (!input) return;
  const valor = input.value.trim().slice(0, 80);
  if (typeof perfil === 'undefined') return;
  perfil.casal = valor;
  saveToLocalStorage();
  refreshProfileDisplay();
  const status = document.getElementById('perfilStatus');
  if (status) {
    status.innerHTML = valor
      ? '<span style="color:var(--accent3)">Salvo — o Consultor IA vai usar esse nome.</span>'
      : '<span style="color:var(--text3)">Salvo — respostas neutras (sem nomes).</span>';
  }
}

function onToggleMedica(checkbox) {
  if (checkbox.checked) {
    if (typeof ativarPlanejamentoMedica === 'function') ativarPlanejamentoMedica();
  } else {
    if (typeof desativarPlanejamentoMedica === 'function') desativarPlanejamentoMedica();
  }
}

// === MOBILE SIDEBAR ===
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  if (sb) sb.classList.toggle('open');
  if (ov) ov.classList.toggle('show');
}

// === NAVIGATION ===
function showSection(id, el) {
  if (id === 'planejamentoMedica' && typeof isPlanejamentoMedicaAtivo === 'function' && !isPlanejamentoMedicaAtivo()) {
    id = 'dashboard';
    el = null;
  }
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelector('#section-' + id).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  const titles = { dashboard: 'Visão Geral', extrato: 'Importar', receitas: 'Receitas', despesas: 'Despesas', orcamento: 'Orçamento', planejamentoMedica: 'Planejamento Médica', investimentos: 'Investimentos', metas: 'Metas', projecoes: 'Projeções', ia: 'Consultor IA', config: 'Configurações' };
  // Render lazy de módulos que não estão no refreshAll padrão
  if (id === 'planejamentoMedica' && typeof renderPlanejamentoMedica === 'function') {
    renderPlanejamentoMedica();
  }
  document.getElementById('pageTitle').textContent = titles[id] || '';
  // Close sidebar on mobile after navigation
  if (window.innerWidth <= 768) toggleSidebar();
}

// === RECENT TRANSACTIONS ===
function renderRecentTx() {
  const el = document.getElementById('recentTx');
  if (!el) return;
  const recent = transactions.slice(0, 8);
  if (recent.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:13px">Nenhuma transação. Importe seu extrato ou use o botão +.</div>';
    return;
  }
  el.innerHTML = recent.map(t => {
    const childCount = t.isGroup && t.children ? ` (${t.children.length} itens)` : '';
    return `<div class="tx-item">
      <div class="tx-icon" style="background:${esc(t.color)}22">${esc(t.icon)}</div>
      <div class="tx-info">
        <div class="tx-name">${esc(t.name)}${childCount}</div>
        <div class="tx-cat">${esc(t.cat)} · ${esc(t.method)}${t.isGroup && t.dueDate ? ' · Venc. ' + t.dueDate.split('-').reverse().join('/') : ''}</div>
      </div>
      <div style="text-align:right">
        <div class="tx-amount" style="color:${t.val > 0 ? 'var(--accent3)' : 'var(--text)'}">${t.val > 0 ? '+' : ''}R$ ${Math.abs(t.val).toFixed(2).replace('.', ',')}</div>
        <div class="tx-date">${t.date.split('-').reverse().join('/')}</div>
      </div>
    </div>`;
  }).join('');
}

// === CASHFLOW CHART (real data) ===
function renderCashflowChart() {
  const canvas = document.getElementById('cashflowChart');
  if (!canvas) return;
  if (canvas.parentElement) { canvas.style.width = '100%'; canvas.style.height = '100%'; }

  const now = new Date();
  const labels = [];
  const receitasData = [];
  const despesasData = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(MONTH_NAMES[d.getMonth()]);
    const monthTx = transactions.filter(t => t.date && t.date.startsWith(key));
    receitasData.push(monthTx.filter(t => t.val > 0).reduce((a, t) => a + t.val, 0));
    despesasData.push(monthTx.filter(t => t.val < 0).reduce((a, t) => a + Math.abs(t.val), 0));
  }

  if (_charts.cashflow) {
    _charts.cashflow.data.labels = labels;
    _charts.cashflow.data.datasets[0].data = receitasData;
    _charts.cashflow.data.datasets[1].data = despesasData;
    _charts.cashflow.update();
  } else {
    _charts.cashflow = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Receitas', data: receitasData, backgroundColor: 'rgba(52,211,153,0.7)', borderRadius: 6 },
          { label: 'Despesas', data: despesasData, backgroundColor: 'rgba(248,113,113,0.6)', borderRadius: 6 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { size: 11 } } } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 11 }, callback: v => v >= 1000 ? 'R$' + (v / 1000).toFixed(0) + 'k' : 'R$' + v } }
        }
      }
    });
  }
}

function renderCatChart() {
  const canvas = document.getElementById('catChart');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  if (canvas.parentElement) { canvas.style.width = '100%'; canvas.style.height = '100%'; }
  const monthTx = getFilteredTransactions();
  const catTotals = {};
  monthTx.forEach(t => {
    if (t.isGroup && t.children) {
      t.children.forEach(child => {
        if (child.type === 'receita') return;
        catTotals[child.cat] = (catTotals[child.cat] || 0) + Math.abs(child.val);
      });
    } else if (t.val < 0) {
      catTotals[t.cat] = (catTotals[t.cat] || 0) + Math.abs(t.val);
    }
  });
  const cats = Object.keys(catTotals);
  if (cats.length === 0) {
    new Chart(canvas, { type: 'doughnut', data: { labels: ['Sem dados'], datasets: [{ data: [1], backgroundColor: ['#1a2235'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } } });
    return;
  }
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: cats,
      datasets: [{ data: cats.map(c => catTotals[c]), backgroundColor: cats.map(c => catColor(c) + 'cc'), borderWidth: 0, hoverOffset: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } }
  });
}

// === EXPENSES ===
let currentFilter = 'Todos';
function renderDespesas() {
  const tbody = document.getElementById('despesasTbody');
  if (!tbody) return;

  // For bills, also match if any child matches the filter
  let filtered;
  if (currentFilter === 'Todos') {
    filtered = transactions.filter(t => t.val < 0);
  } else {
    filtered = transactions.filter(t => {
      if (t.isGroup && t.children) return t.children.some(c => c.cat === currentFilter);
      return t.cat === currentFilter;
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px">Nenhuma despesa encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const idx = transactions.indexOf(t);

    // === CREDIT CARD BILL (expandable tree) ===
    if (t.isGroup && t.children) {
      const vencLabel = t.dueDate ? t.dueDate.split('-').reverse().join('/') : '';
      const childrenFiltered = currentFilter === 'Todos' ? t.children : t.children.filter(c => c.cat === currentFilter);
      const childRows = childrenFiltered.map(child => {
        const isReceita = child.type === 'receita';
        const valColor = isReceita ? 'var(--accent3)' : 'var(--text2)';
        const sign = isReceita ? '+' : '-';
        return `<tr class="bill-child bill-children-${idx}" style="display:none;background:var(--bg2)">
          <td style="padding-left:32px;font-size:12px">${child.date.split('-').reverse().join('/')}</td>
          <td style="font-size:12px">${esc(child.icon)} ${esc(child.name)}</td>
          <td><span class="badge badge-blue" style="font-size:10px">${esc(child.cat)}</span></td>
          <td style="color:${valColor};font-size:12px">${sign} R$ ${Math.abs(child.val).toFixed(2).replace('.', ',')}</td>
          <td style="color:var(--text3);font-size:12px">${esc(child.method || 'Crédito')}</td>
          <td></td>
        </tr>`;
      }).join('');

      return `<tr class="bill-parent" style="cursor:pointer;background:var(--bg3)" onclick="toggleBillChildren(${idx})">
        <td>${t.date.split('-').reverse().join('/')}</td>
        <td>
          <span id="billArrow_${idx}" style="display:inline-block;transition:transform .2s;margin-right:4px">▸</span>
          💳 <strong>${esc(t.name)}</strong>
          <span style="font-size:11px;color:var(--text3);margin-left:6px">${t.children.length} itens${vencLabel ? ' · Venc. ' + vencLabel : ''}</span>
        </td>
        <td><span class="badge" style="background:#f8717122;color:#f87171;font-size:10px">Fatura</span></td>
        <td style="color:var(--danger);font-weight:600">- R$ ${Math.abs(t.val).toFixed(2).replace('.', ',')}</td>
        <td style="color:var(--text3)">${esc(t.method)}</td>
        <td>
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:var(--danger)" onclick="event.stopPropagation();deleteTransaction(${idx})" title="Excluir fatura">🗑️</button>
        </td>
      </tr>${childRows}`;
    }

    // === NORMAL TRANSACTION ===
    return `<tr>
      <td>${t.date.split('-').reverse().join('/')}</td>
      <td><span>${esc(t.icon)} ${esc(t.name)}</span></td>
      <td><span class="badge badge-blue">${esc(t.cat)}</span></td>
      <td style="color:var(--danger);font-weight:500">- R$ ${Math.abs(t.val).toFixed(2).replace('.', ',')}</td>
      <td style="color:var(--text3)">${esc(t.method)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="editTransaction(${idx})" title="Editar">✏️</button>
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:var(--danger)" onclick="deleteTransaction(${idx})" title="Excluir">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function toggleBillChildren(idx) {
  const rows = document.querySelectorAll(`.bill-children-${idx}`);
  const arrow = document.getElementById(`billArrow_${idx}`);
  const isVisible = rows.length > 0 && rows[0].style.display !== 'none';
  rows.forEach(r => r.style.display = isVisible ? 'none' : 'table-row');
  if (arrow) arrow.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(90deg)';
}

function filterCat(cat, el) {
  currentFilter = cat;
  document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderDespesas();
}

// === EDIT TRANSACTION ===
function editTransaction(idx) {
  const t = transactions[idx];
  if (!t) return;
  document.getElementById('editTxIdx').value = idx;
  document.getElementById('editTxDate').value = t.date;
  document.getElementById('editTxName').value = t.name;
  document.getElementById('editTxVal').value = Math.abs(t.val);
  document.getElementById('editTxMethod').value = t.method;
  document.getElementById('editTxTipo').value = t.val > 0 ? 'receita' : 'despesa';
  updateEditCategories();
  document.getElementById('editTxCat').value = t.cat;
  document.getElementById('editModal').classList.add('show');
}

function updateEditCategories() {
  const tipo = document.getElementById('editTxTipo').value;
  const catSelect = document.getElementById('editTxCat');
  if (tipo === 'receita') {
    catSelect.innerHTML = '<option value="Receita">Receita</option>';
    catSelect.disabled = true;
  } else {
    catSelect.innerHTML = Object.keys(CATEGORIES)
      .filter(c => c !== 'Receita')
      .map(c => `<option value="${c}">${c}</option>`).join('');
    catSelect.disabled = false;
  }
}

function saveEditTx() {
  const idx = parseInt(document.getElementById('editTxIdx').value);
  const tipo = document.getElementById('editTxTipo').value;
  const cat = document.getElementById('editTxCat').value;
  const val = parseFloat(document.getElementById('editTxVal').value);
  if (!val || val <= 0) return alert('Valor inválido!');

  const finalCat = tipo === 'receita' ? 'Receita' : cat;
  transactions[idx] = {
    date: document.getElementById('editTxDate').value,
    name: document.getElementById('editTxName').value.trim(),
    cat: finalCat,
    val: roundCents(tipo === 'receita' ? Math.abs(val) : -Math.abs(val)),
    method: document.getElementById('editTxMethod').value,
    icon: catIcon(finalCat),
    color: catColor(finalCat)
  };
  closeEditModal();
  updateBudgetFromTransactions();
  refreshAll();
}

function closeEditModal() { document.getElementById('editModal').classList.remove('show'); }

function deleteTransaction(idx) {
  const t = transactions[idx];
  if (!t) return;
  const msg = t.isGroup && t.children
    ? `Excluir fatura "${t.name}" com ${t.children.length} transações (R$ ${Math.abs(t.val).toFixed(2).replace('.', ',')})?`
    : `Excluir "${t.name}" (R$ ${Math.abs(t.val).toFixed(2).replace('.', ',')})?`;
  if (!confirm(msg)) return;
  transactions.splice(idx, 1);
  updateBudgetFromTransactions();
  refreshAll();
}

// === BUDGET ===
function renderBudgetBars() {
  const el = document.getElementById('budgetBars');
  if (!el) return;
  el.innerHTML = budgetData.map((b, i) => {
    const pct = b.limit > 0 ? Math.min((b.spent / b.limit) * 100, 100) : 0;
    const over = b.limit > 0 && b.spent > b.limit;
    const warn = pct > 80;
    const col = over ? '#f87171' : warn ? '#fbbf24' : b.color;
    return `<div class="progress-wrap">
      <div class="progress-header">
        <div class="progress-label">${b.icon} ${b.cat}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--text3)">R$ ${b.spent.toFixed(0)}</span>
          <span style="font-size:12px;color:var(--text3)">/</span>
          <input type="number" value="${b.limit}" min="0" step="100"
            style="width:80px;padding:3px 6px;font-size:12px;background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px;text-align:right"
            onchange="updateBudgetLimit(${i}, parseFloat(this.value)||0)">
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%;background:${col}"></div>
      </div>
      ${over ? '<div style="font-size:11px;color:var(--danger);margin-top:2px">Acima do limite!</div>' : ''}
    </div>`;
  }).join('');
}

function updateBudgetLimit(index, value) {
  budgetData[index].limit = value;
  refreshAll();
}

function renderBudgetDonut() {
  const canvas = document.getElementById('budgetDonut');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  if (canvas.parentElement) { canvas.style.width = '100%'; canvas.style.height = '100%'; }
  const hasData = budgetData.some(b => b.spent > 0);
  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: budgetData.map(b => b.cat),
      datasets: [{ data: hasData ? budgetData.map(b => b.spent) : budgetData.map(b => b.limit), backgroundColor: budgetData.map(b => b.color + '88'), borderWidth: 0 }]
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: false } } }
  });
}

// === INVESTMENTS ===

const INVEST_RATES = {
  'Tesouro Selic': 14.25, 'Tesouro IPCA+': 10.50, 'CDB': 13.00,
  'LCI/LCA': 11.50, 'Poupança': 7.50, 'Fundo Imobiliário': 10.00,
  'Ações': 12.00, 'ETF': 11.00, 'Criptoativo': 0, 'Outro': 0
};

const INVEST_TYPE_COLORS = {
  'Tesouro Selic': '#38bdf8', 'Tesouro IPCA+': '#818cf8', 'CDB': '#34d399',
  'LCI/LCA': '#60a5fa', 'Poupança': '#fbbf24', 'Fundo Imobiliário': '#fb923c',
  'Ações': '#f87171', 'ETF': '#c084fc', 'Criptoativo': '#facc15', 'Outro': '#64748b'
};

const INVEST_LIQUIDITY_DEFAULTS = {
  'Tesouro Selic': 'liquid', 'CDB': 'liquid', 'Poupança': 'liquid', 'LCI/LCA': 'liquid',
  'Tesouro IPCA+': 'illiquid', 'Fundo Imobiliário': 'illiquid',
  'Ações': 'illiquid', 'ETF': 'illiquid', 'Criptoativo': 'illiquid', 'Outro': 'illiquid'
};

function getLiquidTotal() {
  return investments
    .filter(i => i.liquidity === 'liquid')
    .reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
}

function updateInvestRate() {
  const type = document.getElementById('investType').value;
  document.getElementById('investRate').value = INVEST_RATES[type] || 0;
  const liqEl = document.getElementById('investLiquidity');
  if (liqEl) liqEl.value = INVEST_LIQUIDITY_DEFAULTS[type] || 'illiquid';
}

function updateInvestCards() {
  const totalInvested = investments.reduce((a, i) => a + (parseFloat(i.value) || 0), 0);

  // Monthly return using compound interest: V * ((1 + r)^(1/12) - 1)
  const rentMes = investments.reduce((a, i) => {
    const val = parseFloat(i.value) || 0;
    const rate = parseFloat(i.rate) || 0;
    return a + val * (Math.pow(1 + rate / 100, 1 / 12) - 1);
  }, 0);

  // Annual return: V * r
  const rentAno = investments.reduce((a, i) => {
    const val = parseFloat(i.value) || 0;
    const rate = parseFloat(i.rate) || 0;
    return a + val * (rate / 100);
  }, 0);

  // 12-month projection with compound interest
  const projecao12m = investments.reduce((a, i) => {
    const val = parseFloat(i.value) || 0;
    const rate = parseFloat(i.rate) || 0;
    const monthlyRate = Math.pow(1 + rate / 100, 1 / 12) - 1;
    return a + val * Math.pow(1 + monthlyRate, 12);
  }, 0);

  document.getElementById('invPatrimonioTotal').textContent = formatBRL(totalInvested);
  document.getElementById('invPatrimonioDelta').textContent = investments.length > 0
    ? investments.length + ' investimento(s)' : 'Vamos começar!';

  document.getElementById('invRentMes').textContent = investments.length > 0 ? '+ ' + formatBRL(rentMes) : 'R$ 0';
  document.getElementById('invRentMesDelta').textContent = investments.length > 0
    ? (totalInvested > 0 ? (rentMes / totalInvested * 100).toFixed(2) + '% ao mês' : '—') : '—';

  document.getElementById('invRentAno').textContent = investments.length > 0 ? '+ ' + formatBRL(rentAno) : 'R$ 0';
  document.getElementById('invRentAnoDelta').textContent = investments.length > 0
    ? (totalInvested > 0 ? (rentAno / totalInvested * 100).toFixed(2) + '% ao ano' : '—') : '—';

  document.getElementById('invEvolucao').textContent = investments.length > 0 ? formatBRL(projecao12m) : 'R$ 0';
  document.getElementById('invEvolucaoDelta').textContent = investments.length > 0
    ? 'Projeção em 12 meses (+' + formatBRL(projecao12m - totalInvested) + ')' : 'Projeção 12 meses';

  // Update dashboard card
  document.getElementById('dashInvest').textContent = formatBRL(totalInvested);
  const deltaEl = document.getElementById('dashInvestDelta');
  if (deltaEl) {
    deltaEl.textContent = investments.length > 0 ? '+' + formatBRL(rentMes) + '/mês' : 'Comece a investir!';
    deltaEl.style.color = investments.length > 0 ? 'var(--accent3)' : 'var(--text3)';
  }
}

function renderPatrimonio() { updateInvestCards(); }

function renderAllocList() {
  const el = document.getElementById('allocList');
  if (!el) return;
  const totalInvested = investments.reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
  el.innerHTML = allocations.map(a => {
    const sugVal = totalInvested > 0 ? formatBRL(totalInvested * a.pct / 100) : 'Sugestão';
    return `<div class="alloc-item">
      <div class="alloc-dot" style="background:${a.color}"></div>
      <div class="alloc-name">${a.name}</div>
      <div style="flex:1"></div>
      <div class="alloc-pct">${a.pct}%</div>
      <div class="alloc-val">${sugVal}</div>
    </div>`;
  }).join('');
}

function renderInvSuggestions() {
  const el = document.getElementById('invSuggestions');
  if (!el) return;
  el.innerHTML = `
    <div class="inv-card">
      <div class="inv-ticker">SELIC</div>
      <div class="inv-name">Tesouro Selic</div>
      <div class="inv-price" style="color:var(--accent)">${INVEST_RATES['Tesouro Selic']}% a.a.</div>
      <div class="inv-rec rec-comprar">Ideal para reserva de emergência</div>
    </div>
    <div class="inv-card">
      <div class="inv-ticker">CDB</div>
      <div class="inv-name">CDB Liquidez Diária</div>
      <div class="inv-price" style="color:var(--accent3)">${INVEST_RATES['CDB']}% a.a.</div>
      <div class="inv-rec rec-comprar">Rendimento + segurança</div>
    </div>
    <div class="inv-card">
      <div class="inv-ticker">IPCA+</div>
      <div class="inv-name">Tesouro IPCA+ 2035</div>
      <div class="inv-price" style="color:var(--accent2)">~${INVEST_RATES['Tesouro IPCA+']}% a.a.</div>
      <div class="inv-rec rec-comprar">Longo prazo + proteção inflacionária</div>
    </div>`;
}

function renderInvestments() {
  const el = document.getElementById('investmentsList');
  if (!el) return;
  if (investments.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Nenhum investimento adicionado ainda</div>';
  } else {
    el.innerHTML = investments.map((inv, idx) => {
      const val = parseFloat(inv.value) || 0;
      const rate = parseFloat(inv.rate) || 0;
      const monthlyReturn = val * (Math.pow(1 + rate / 100, 1 / 12) - 1);
      const typeColor = INVEST_TYPE_COLORS[inv.type] || '#64748b';
      const dateStr = inv.date ? inv.date.split('-').reverse().join('/') : '';
      return `<div style="padding:12px;background:var(--bg3);border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:8px;height:8px;border-radius:50%;background:${typeColor};flex-shrink:0"></div>
          <div>
            <div style="font-weight:500">${esc(inv.name)}</div>
            <div style="font-size:12px;color:var(--text3)">${esc(inv.type || '')} ${dateStr ? '· ' + dateStr : ''} ${rate > 0 ? '· ' + rate.toFixed(2) + '% a.a.' : ''} · <span style="color:${inv.liquidity === 'liquid' ? 'var(--accent3)' : 'var(--text3)'}">${inv.liquidity === 'liquid' ? 'Líquido' : 'Ilíquido'}</span></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="text-align:right">
            <div style="font-weight:500">${formatBRL(val)}</div>
            ${rate > 0 ? '<div style="font-size:11px;color:var(--accent3)">+' + formatBRL(monthlyReturn) + '/mês</div>' : ''}
          </div>
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:var(--danger)" onclick="deleteInvestment(${idx})">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }
  updateInvestCards();
}

function openInvestModal() {
  document.getElementById('investModal').classList.add('show');
  document.getElementById('investDate').value = new Date().toISOString().split('T')[0];
  updateInvestRate();
}

function closeInvestModal() {
  document.getElementById('investModal').classList.remove('show');
  document.getElementById('investName').value = '';
  document.getElementById('investValue').value = '';
}

function saveInvestment() {
  const name = document.getElementById('investName').value.trim();
  const type = document.getElementById('investType').value;
  const val = parseFloat(document.getElementById('investValue').value);
  const rate = parseFloat(document.getElementById('investRate').value) || 0;
  const date = document.getElementById('investDate').value;
  const liquidity = document.getElementById('investLiquidity').value || 'illiquid';
  if (!name || !val || val <= 0) { alert('Preencha nome e valor!'); return; }
  investments.push({ name, type, value: roundCents(val), rate, date, liquidity });
  closeInvestModal();
  refreshAll();
}

function deleteInvestment(idx) {
  if (confirm('Remover investimento "' + (investments[idx]?.name || '') + '"?')) {
    investments.splice(idx, 1);
    refreshAll();
  }
}

// === GOALS ===
function renderMetas() {
  const el = document.getElementById('metasList');
  if (!el) return;
  if (goals.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Nenhuma meta adicionada</div>';
    return;
  }
  el.innerHTML = goals.map((g, idx) => {
    const target = parseFloat(g.target) || 0;
    const current = parseFloat(g.current) || 0;
    const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    let deadlineInfo = '';
    if (g.deadline) {
      const now = new Date();
      const dl = new Date(g.deadline + 'T00:00:00');
      const diffMs = dl - now;
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const remaining = target - current;
      if (pct >= 100) {
        deadlineInfo = '<div style="font-size:11px;color:var(--accent3);margin-top:4px">Meta alcançada!</div>';
      } else if (diffDays > 0 && remaining > 0) {
        const months = Math.max(1, Math.ceil(diffDays / 30));
        deadlineInfo = `<div style="font-size:11px;color:var(--accent);margin-top:4px">Economizar ${formatBRL(remaining / months)}/mês por ${months} mês(es)</div>`;
      } else if (diffDays <= 0) {
        deadlineInfo = '<div style="font-size:11px;color:var(--danger);margin-top:4px">Prazo expirado!</div>';
      }
    }
    return `<div class="goal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-weight:500">${esc(g.name)}</div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="editGoal(${idx})">✏️</button>
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:var(--danger)" onclick="deleteGoal(${idx})">🗑️</button>
        </div>
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:4px">${formatBRL(current)} de ${formatBRL(target)} ${g.deadline ? '· até ' + g.deadline.split('-').reverse().join('/') : ''}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%;background:${pct >= 100 ? 'var(--accent3)' : 'var(--accent)'}"></div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">${pct.toFixed(0)}% concluído</div>
      ${deadlineInfo}
      <div style="display:flex;gap:6px;margin-top:8px;font-size:11px;color:var(--text3)">
        <input type="number" placeholder="Valor a adicionar" value="" style="flex:1;padding:4px 6px;font-size:11px" id="goalAdd_${idx}">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;background:var(--accent);color:#fff;border-radius:6px" onclick="updateGoalCurrent(${idx}, parseFloat(document.getElementById('goalAdd_${idx}').value||0))">+ Adicionar</button>
      </div>
    </div>`;
  }).join('');
}

function updateGoalCurrent(idx, amount) {
  if (!amount || amount <= 0) return;
  goals[idx].current = (parseFloat(goals[idx].current || 0) + amount).toString();
  refreshAll();
}

function editGoal(idx) {
  const g = goals[idx];
  document.getElementById('goalName').value = g.name;
  document.getElementById('goalTarget').value = parseFloat(g.target) || '';
  document.getElementById('goalCurrent').value = parseFloat(g.current) || 0;
  document.getElementById('goalDeadline').value = g.deadline || '';
  document.getElementById('goalModal').classList.add('show');
  document.getElementById('goalModal').dataset.editIdx = idx;
}

function deleteGoal(idx) {
  if (confirm('Remover meta "' + (goals[idx]?.name || '') + '"?')) {
    goals.splice(idx, 1);
    refreshAll();
  }
}

function addGoal() { openGoalModal(); }

function openGoalModal() {
  document.getElementById('goalModal').classList.add('show');
  document.getElementById('goalModal').dataset.editIdx = '';
  document.getElementById('goalName').value = '';
  document.getElementById('goalTarget').value = '';
  document.getElementById('goalCurrent').value = '0';
  document.getElementById('goalDeadline').value = '';
}

function closeGoalModal() { document.getElementById('goalModal').classList.remove('show'); }

function saveGoal() {
  const name = document.getElementById('goalName').value.trim();
  const target = parseFloat(document.getElementById('goalTarget').value);
  const current = parseFloat(document.getElementById('goalCurrent').value) || 0;
  const deadline = document.getElementById('goalDeadline').value;

  if (!name || !target || target <= 0) { alert('Preencha nome e valor alvo!'); return; }

  const editIdx = document.getElementById('goalModal').dataset.editIdx;
  if (editIdx !== '' && editIdx !== undefined) {
    const idx = parseInt(editIdx);
    goals[idx] = { name, target: target.toString(), current: current.toString(), deadline };
  } else {
    goals.push({ name, target: target.toString(), current: current.toString(), deadline });
  }
  closeGoalModal();
  refreshAll();
}

// === RECEITAS (INCOME) ===
let currentReceitaFilter = 'Todos';

function renderReceitaChips() {
  const el = document.getElementById('receitaChips');
  if (!el) return;
  const chips = ['Todos', ...Object.keys(RECEITA_CATEGORIES)];
  el.innerHTML = chips.map(c => {
    const icon = c === 'Todos' ? '🔎' : (RECEITA_CATEGORIES[c]?.icon || '📦');
    const active = c === currentReceitaFilter ? ' active' : '';
    return `<div class="cat-chip${active}" onclick="filterReceita('${esc(c)}',this)">${icon} ${esc(c)}</div>`;
  }).join('');
}

function filterReceita(fonte, el) {
  currentReceitaFilter = fonte;
  document.querySelectorAll('#receitaChips .cat-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderReceitas();
}

function renderReceitas() {
  renderReceitaChips();
  renderReceitaCards();
  renderReceitaTable();
}

function renderReceitaCards() {
  const monthTx = getFilteredTransactions().filter(t => t.val > 0);
  const total = monthTx.reduce((a, t) => a + t.val, 0);

  // Average over last 6 months
  const now = new Date();
  let totalAll6 = 0;
  let monthsWithData = 0;
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mTx = transactions.filter(t => t.date && t.date.startsWith(key) && t.val > 0);
    const mTotal = mTx.reduce((a, t) => a + t.val, 0);
    totalAll6 += mTotal;
    if (mTotal > 0) monthsWithData++;
  }
  const avg = monthsWithData > 0 ? totalAll6 / monthsWithData : 0;

  // Biggest
  const biggest = monthTx.length > 0 ? monthTx.reduce((a, b) => a.val > b.val ? a : b) : null;

  document.getElementById('recTotalMes').textContent = formatBRL(total);
  document.getElementById('recTotalMesDelta').textContent = monthTx.length + ' entrada(s) no mês';
  document.getElementById('recMediaMensal').textContent = formatBRL(avg);
  document.getElementById('recMaior').textContent = biggest ? formatBRL(biggest.val) : 'R$ 0';
  document.getElementById('recMaiorDesc').textContent = biggest ? esc(biggest.name) : '—';
  document.getElementById('recQtd').textContent = monthTx.length;
}

function renderReceitaTable() {
  const tbody = document.getElementById('receitasTbody');
  if (!tbody) return;
  const allReceitas = transactions.filter(t => t.val > 0);
  const filtered = currentReceitaFilter === 'Todos'
    ? allReceitas
    : allReceitas.filter(t => t.fonte === currentReceitaFilter);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:20px">Nenhuma receita encontrada</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const idx = transactions.indexOf(t);
    const fonteLabel = t.fonte || 'Receita';
    const fonteIcon = RECEITA_CATEGORIES[fonteLabel]?.icon || '💰';
    const fonteColor = RECEITA_CATEGORIES[fonteLabel]?.color || '#34d399';
    return `<tr>
      <td>${t.date.split('-').reverse().join('/')}</td>
      <td>${esc(t.icon)} ${esc(t.name)}</td>
      <td><span class="badge" style="background:${fonteColor}22;color:${fonteColor}">${fonteIcon} ${esc(fonteLabel)}</span></td>
      <td style="color:var(--accent3);font-weight:500">+ R$ ${Math.abs(t.val).toFixed(2).replace('.', ',')} <span class="badge ${t.recurrence === 'fixed' ? 'badge-green' : 'badge-orange'}" style="font-size:9px;padding:1px 5px">${t.recurrence === 'fixed' ? 'Fixa' : 'Variável'}</span></td>
      <td style="color:var(--text3)">${esc(t.method)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="editReceita(${idx})" title="Editar">✏️</button>
          <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:var(--danger)" onclick="deleteReceita(${idx})" title="Excluir">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function populateReceitaFontes() {
  const sel = document.getElementById('recFonte');
  if (!sel) return;
  sel.innerHTML = Object.keys(RECEITA_CATEGORIES).map(f =>
    `<option value="${esc(f)}">${esc(f)}</option>`
  ).join('');
}

function openReceitaModal(editIdx) {
  populateReceitaFontes();
  document.getElementById('recDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('recName').value = '';
  document.getElementById('recVal').value = '';
  document.getElementById('recEditIdx').value = editIdx !== undefined ? editIdx : '';
  if (editIdx !== undefined) {
    const t = transactions[editIdx];
    if (t) {
      document.getElementById('recDate').value = t.date;
      document.getElementById('recName').value = t.name;
      document.getElementById('recVal').value = Math.abs(t.val);
      document.getElementById('recMethod').value = t.method || 'Transferência';
      document.getElementById('recFonte').value = t.fonte || 'Salário';
      document.getElementById('recRecurrence').value = t.recurrence || 'fixed';
    }
  }
  document.getElementById('receitaModal').classList.add('show');
}

function closeReceitaModal() {
  document.getElementById('receitaModal').classList.remove('show');
}

function saveReceita() {
  const date = document.getElementById('recDate').value;
  const name = document.getElementById('recName').value.trim();
  const val = parseFloat(document.getElementById('recVal').value);
  const method = document.getElementById('recMethod').value;
  const fonte = document.getElementById('recFonte').value;
  const recurrence = document.getElementById('recRecurrence').value || 'fixed';
  const editIdx = document.getElementById('recEditIdx').value;

  if (!name || !val || val <= 0 || !date) {
    alert('Preencha todos os campos corretamente!');
    return;
  }

  const fonteIcon = RECEITA_CATEGORIES[fonte]?.icon || '💰';
  const fonteColor = RECEITA_CATEGORIES[fonte]?.color || '#34d399';

  const tx = {
    date, name,
    cat: 'Receita',
    val: roundCents(Math.abs(val)),
    method, fonte, recurrence,
    icon: fonteIcon,
    color: fonteColor
  };

  if (editIdx !== '') {
    transactions[parseInt(editIdx)] = tx;
  } else {
    transactions.unshift(tx);
  }
  closeReceitaModal();
  refreshAll();
}

function editReceita(idx) {
  openReceitaModal(idx);
}

function deleteReceita(idx) {
  const t = transactions[idx];
  if (!t) return;
  if (!confirm(`Excluir "${t.name}" (R$ ${Math.abs(t.val).toFixed(2).replace('.', ',')})?`)) return;
  transactions.splice(idx, 1);
  refreshAll();
}

// === DYNAMIC CATEGORY CHIPS (DESPESAS) ===
function renderCatChips() {
  const el = document.getElementById('catChips');
  if (!el) return;
  const cats = getExpenseCategories();
  el.innerHTML = `<div class="cat-chip${currentFilter === 'Todos' ? ' active' : ''}" onclick="filterCat('Todos',this)">🔎 Todos</div>` +
    cats.map(c => {
      const icon = catIcon(c);
      const active = c === currentFilter ? ' active' : '';
      return `<div class="cat-chip${active}" onclick="filterCat('${esc(c)}',this)">${icon} ${esc(c)}</div>`;
    }).join('');
}

// === CATEGORY MANAGER (CONFIG) ===
function renderCategoryManager() {
  const el = document.getElementById('categoryManagerList');
  if (!el) return;
  const cats = getExpenseCategories();
  if (cats.length === 0) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px">Nenhuma categoria</div>';
    return;
  }
  el.innerHTML = cats.map(name => {
    const c = CATEGORIES[name];
    const usedCount = transactions.filter(t => t.cat === name).length;
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--bg3);border-radius:10px;margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:${c.color};flex-shrink:0"></div>
        <span style="font-size:18px">${c.icon}</span>
        <span style="font-weight:500">${esc(name)}</span>
        <span style="font-size:11px;color:var(--text3)">${usedCount} transação(ões)</span>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="editCategory('${esc(name)}')">✏️</button>
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 8px;color:var(--danger)" onclick="deleteCategory('${esc(name)}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function openCategoryModal(editName) {
  document.getElementById('catEditOriginalName').value = editName || '';
  if (editName && CATEGORIES[editName]) {
    document.getElementById('catModalTitle').textContent = 'Editar Categoria';
    document.getElementById('catEditName').value = editName;
    document.getElementById('catEditIcon').value = CATEGORIES[editName].icon;
    document.getElementById('catEditColor').value = CATEGORIES[editName].color;
  } else {
    document.getElementById('catModalTitle').textContent = 'Nova Categoria';
    document.getElementById('catEditName').value = '';
    document.getElementById('catEditIcon').value = '';
    document.getElementById('catEditColor').value = '#818cf8';
  }
  document.getElementById('categoryModal').classList.add('show');
}

function closeCategoryModal() {
  document.getElementById('categoryModal').classList.remove('show');
}

function saveCategory() {
  const name = document.getElementById('catEditName').value.trim();
  const icon = document.getElementById('catEditIcon').value.trim() || '📦';
  const color = document.getElementById('catEditColor').value;
  const original = document.getElementById('catEditOriginalName').value;

  if (!name) { alert('Preencha o nome da categoria!'); return; }
  if (name === 'Receita') { alert('Nome reservado pelo sistema!'); return; }

  // If renaming, update existing transactions
  if (original && original !== name) {
    transactions.forEach(t => { if (t.cat === original) { t.cat = name; t.icon = icon; t.color = color; } });
    delete CATEGORIES[original];
  }

  CATEGORIES[name] = { icon, color };
  CATEGORIES['Receita'] = { icon: '💰', color: '#34d399' }; // keep system cat
  rebuildBudgetData();
  closeCategoryModal();
  refreshAll();
}

function editCategory(name) {
  openCategoryModal(name);
}

function deleteCategory(name) {
  const usedCount = transactions.filter(t => t.cat === name).length;
  if (usedCount > 0) {
    if (!confirm(`A categoria "${name}" tem ${usedCount} transação(ões). Ao excluir, elas serão movidas para "Outros". Continuar?`)) return;
    transactions.forEach(t => {
      if (t.cat === name) {
        t.cat = 'Outros';
        t.icon = catIcon('Outros');
        t.color = catColor('Outros');
      }
    });
  } else {
    if (!confirm(`Excluir a categoria "${name}"?`)) return;
  }
  delete CATEGORIES[name];
  // Ensure 'Outros' exists
  if (!CATEGORIES['Outros']) CATEGORIES['Outros'] = { icon: '📦', color: '#64748b' };
  CATEGORIES['Receita'] = { icon: '💰', color: '#34d399' };
  rebuildBudgetData();
  refreshAll();
}

function restoreDefaultCategories() {
  if (!confirm('Restaurar categorias padrão? Categorias customizadas serão removidas (transações existentes serão movidas para "Outros").')) return;
  // Move transactions from custom categories to Outros
  const defaultNames = Object.keys(DEFAULT_CATEGORIES);
  transactions.forEach(t => {
    if (t.val < 0 && !defaultNames.includes(t.cat) && t.cat !== 'Receita') {
      t.cat = 'Outros';
      t.icon = DEFAULT_CATEGORIES['Outros'].icon;
      t.color = DEFAULT_CATEGORIES['Outros'].color;
    }
  });
  // Reset categories
  Object.keys(CATEGORIES).forEach(k => delete CATEGORIES[k]);
  Object.entries(DEFAULT_CATEGORIES).forEach(([k, v]) => { CATEGORIES[k] = JSON.parse(JSON.stringify(v)); });
  CATEGORIES['Receita'] = { icon: '💰', color: '#34d399' };
  rebuildBudgetData();
  refreshAll();
}

// =============================================
// PROJEÇÕES — FORWARD-LOOKING FINANCIAL ENGINE
// =============================================

let currentScenario = 'moderado';

const SCENARIOS = {
  conservador: { incomeMultiplier: 0.90, expenseMultiplier: 1.10, label: 'Conservador' },
  moderado:    { incomeMultiplier: 1.00, expenseMultiplier: 1.00, label: 'Moderado' },
  otimista:    { incomeMultiplier: 1.10, expenseMultiplier: 0.90, label: 'Otimista' },
};

function selectScenario(s, el) {
  currentScenario = s;
  document.querySelectorAll('#scenarioChips .cat-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderProjecoes();
}

function computeProjections(scenario) {
  const sc = SCENARIOS[scenario] || SCENARIOS.moderado;
  const now = new Date();

  // 1. Weighted average: recent months count more (exponential decay)
  // Weights: month-1=6, month-2=5, month-3=4, month-4=3, month-5=2, month-6=1
  // Income split: fixed (100% confidence) vs variable (50% confidence)
  let wFixedInc = 0, wVarInc = 0, weightedExpense = 0, totalWeight = 0, monthsWithData = 0;
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const mTx = transactions.filter(t => t.date && t.date.startsWith(key));
    const fixedInc = mTx.filter(t => t.val > 0 && t.recurrence === 'fixed').reduce((a, t) => a + t.val, 0);
    const varInc = mTx.filter(t => t.val > 0 && t.recurrence !== 'fixed').reduce((a, t) => a + t.val, 0);
    const exp = mTx.filter(t => t.val < 0).reduce((a, t) => a + Math.abs(t.val), 0);
    if (fixedInc > 0 || varInc > 0 || exp > 0) {
      const weight = 7 - i; // 6,5,4,3,2,1
      wFixedInc += fixedInc * weight;
      wVarInc += varInc * weight;
      weightedExpense += exp * weight;
      totalWeight += weight;
      monthsWithData++;
    }
  }

  const avgFixedIncome = totalWeight > 0 ? wFixedInc / totalWeight : 0;
  const avgVarIncome = totalWeight > 0 ? wVarInc / totalWeight : 0;
  // Fixed income at 100%, variable at 50% (conservative for planning)
  const avgIncome = avgFixedIncome + avgVarIncome * 0.5;
  const avgExpense = totalWeight > 0 ? weightedExpense / totalWeight : 0;
  const projIncome = avgIncome * sc.incomeMultiplier;
  const projExpense = avgExpense * sc.expenseMultiplier;
  const monthlySavings = projIncome - projExpense;

  // 2. Investment growth
  const totalInvested = investments.reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
  const weightedRate = totalInvested > 0
    ? investments.reduce((a, i) => {
        const v = parseFloat(i.value) || 0;
        const r = parseFloat(i.rate) || 0;
        return a + (v / totalInvested) * r;
      }, 0)
    : 0;
  const monthlyInvestRate = Math.pow(1 + weightedRate / 100, 1 / 12) - 1;

  // Estimate monthly contribution as 40% of savings (if positive)
  const monthlyContribution = Math.max(0, monthlySavings * 0.4);

  // 3. Build 12-month projection arrays
  const months = [];
  const incomeArr = [];
  const expenseArr = [];
  const savingsArr = [];
  const patrimonioArr = [];
  let cumSavings = 0;
  let patrimonio = totalInvested;

  for (let i = 1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(MONTH_NAMES[d.getMonth()] + '/' + String(d.getFullYear()).slice(2));
    incomeArr.push(projIncome);
    expenseArr.push(projExpense);
    cumSavings += monthlySavings;
    savingsArr.push(cumSavings);
    patrimonio = patrimonio * (1 + monthlyInvestRate) + monthlyContribution;
    patrimonioArr.push(patrimonio);
  }

  // 4. Goal projections
  const goalProjections = goals.map(g => {
    const target = parseFloat(g.target) || 0;
    const current = parseFloat(g.current) || 0;
    const remaining = Math.max(0, target - current);
    if (remaining <= 0) return { ...g, monthsToGoal: 0, date: 'Concluída', status: 'done' };
    if (monthlySavings <= 0) return { ...g, monthsToGoal: Infinity, date: 'Impossível', status: 'danger' };
    // Assume proportional allocation of savings across goals
    const totalGoalRemaining = goals.reduce((a, gg) => a + Math.max(0, (parseFloat(gg.target) || 0) - (parseFloat(gg.current) || 0)), 0);
    const share = totalGoalRemaining > 0 ? remaining / totalGoalRemaining : 1;
    const monthlyForGoal = monthlySavings * share;
    const mths = monthlyForGoal > 0 ? Math.ceil(remaining / monthlyForGoal) : Infinity;
    const estDate = new Date(now.getFullYear(), now.getMonth() + mths, 1);
    const dateStr = MONTH_NAMES[estDate.getMonth()] + '/' + estDate.getFullYear();
    const status = mths <= 6 ? 'good' : mths <= 12 ? 'warn' : mths <= 24 ? 'late' : 'danger';
    return { ...g, monthsToGoal: mths, date: dateStr, status };
  });

  // 5. Emergency fund estimate (6x monthly expenses, liquid investments only)
  const emergencyTarget = avgExpense * 6;
  const emergencyCurrent = getLiquidTotal();
  const emergencyRemaining = Math.max(0, emergencyTarget - emergencyCurrent);
  const monthsToEmergency = monthlyContribution > 0 ? Math.ceil(emergencyRemaining / monthlyContribution) : Infinity;

  return {
    months, incomeArr, expenseArr, savingsArr, patrimonioArr,
    projIncome, projExpense, monthlySavings, monthlyContribution,
    totalInvested, patrimonio12m: patrimonioArr[11] || totalInvested,
    cumSavings12m: cumSavings,
    goalProjections, monthsToEmergency, emergencyTarget, emergencyCurrent,
    hasData: monthsWithData > 0,
    avgIncome, avgExpense, weightedRate
  };
}

function renderProjecoes() {
  const proj = computeProjections(currentScenario);

  // Cards
  if (!proj.hasData) {
    document.getElementById('projSaldo12m').textContent = '—';
    document.getElementById('projSaldo12mDelta').textContent = 'Importe transações para projetar';
    document.getElementById('projPatrimonio12m').textContent = '—';
    document.getElementById('projEconomiaMensal').textContent = '—';
    document.getElementById('projReserva').textContent = '—';
  } else {
    document.getElementById('projSaldo12m').textContent = (proj.cumSavings12m >= 0 ? '+' : '') + formatBRL(proj.cumSavings12m);
    document.getElementById('projSaldo12m').style.color = proj.cumSavings12m >= 0 ? 'var(--accent3)' : 'var(--danger)';
    document.getElementById('projSaldo12mDelta').textContent = 'acumulado em 12 meses (' + SCENARIOS[currentScenario].label + ')';

    document.getElementById('projPatrimonio12m').textContent = formatBRL(proj.patrimonio12m);
    document.getElementById('projPatrimonio12mDelta').textContent = '+' + formatBRL(proj.patrimonio12m - proj.totalInvested) + ' de crescimento';

    document.getElementById('projEconomiaMensal').textContent = (proj.monthlySavings >= 0 ? '+' : '') + formatBRL(proj.monthlySavings);
    document.getElementById('projEconomiaMensal').style.color = proj.monthlySavings >= 0 ? 'var(--accent2)' : 'var(--danger)';
    document.getElementById('projEconomiaMensalDelta').textContent = formatBRL(proj.projIncome) + ' receita - ' + formatBRL(proj.projExpense) + ' despesa';

    if (proj.emergencyCurrent >= proj.emergencyTarget) {
      document.getElementById('projReserva').textContent = 'Atingida!';
      document.getElementById('projReserva').style.color = 'var(--accent3)';
      document.getElementById('projReservaDelta').textContent = formatBRL(proj.emergencyCurrent) + ' líquido de ' + formatBRL(proj.emergencyTarget) + ' (6x despesas)';
    } else if (proj.monthsToEmergency === Infinity) {
      document.getElementById('projReserva').textContent = '—';
      document.getElementById('projReservaDelta').textContent = formatBRL(proj.emergencyCurrent) + ' líquido — sem economia para construir';
    } else {
      document.getElementById('projReserva').textContent = proj.monthsToEmergency + ' meses';
      document.getElementById('projReserva').style.color = proj.monthsToEmergency <= 6 ? 'var(--accent3)' : proj.monthsToEmergency <= 12 ? 'var(--gold)' : 'var(--danger)';
      document.getElementById('projReservaDelta').textContent = formatBRL(proj.emergencyCurrent) + ' líquido de ' + formatBRL(proj.emergencyTarget) + ' (6x despesas)';
    }
  }

  renderProjCashflowChart(proj);
  renderProjPatrimonioChart(proj);
  renderProjGoals(proj);
}

function renderProjCashflowChart(proj) {
  const canvas = document.getElementById('projCashflowChart');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  if (canvas.parentElement) { canvas.style.width = '100%'; canvas.style.height = '100%'; }

  if (!proj.hasData) {
    new Chart(canvas, { type: 'bar', data: { labels: ['Sem dados'], datasets: [{ data: [0], backgroundColor: '#1a2235' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    return;
  }

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: proj.months,
      datasets: [
        { label: 'Receita Projetada', data: proj.incomeArr, backgroundColor: 'rgba(52,211,153,0.5)', borderColor: 'rgba(52,211,153,0.8)', borderWidth: 2, borderDash: [5, 3], borderRadius: 4 },
        { label: 'Despesa Projetada', data: proj.expenseArr, backgroundColor: 'rgba(248,113,113,0.4)', borderColor: 'rgba(248,113,113,0.8)', borderWidth: 2, borderDash: [5, 3], borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 }, callback: v => v >= 1000 ? 'R$' + (v / 1000).toFixed(0) + 'k' : 'R$' + v } }
      }
    }
  });
}

function renderProjPatrimonioChart(proj) {
  const canvas = document.getElementById('projPatrimonioChart');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  if (canvas.parentElement) { canvas.style.width = '100%'; canvas.style.height = '100%'; }

  if (!proj.hasData && proj.totalInvested === 0) {
    new Chart(canvas, { type: 'line', data: { labels: ['Sem dados'], datasets: [{ data: [0] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } });
    return;
  }

  // Build historical + projected
  const now = new Date();
  const histLabels = [];
  const histData = [];
  // Simple: show invested total as flat line for past 3 months
  for (let i = 3; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    histLabels.push(MONTH_NAMES[d.getMonth()] + '/' + String(d.getFullYear()).slice(2));
    histData.push(proj.totalInvested);
  }
  // Current month
  histLabels.push(MONTH_NAMES[now.getMonth()] + '/' + String(now.getFullYear()).slice(2));
  histData.push(proj.totalInvested);

  const allLabels = [...histLabels, ...proj.months];
  const realLine = [...histData, ...Array(12).fill(null)];
  const projLine = [...Array(histLabels.length - 1).fill(null), proj.totalInvested, ...proj.patrimonioArr];

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        { label: 'Patrimônio Real', data: realLine, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.1)', fill: true, tension: 0.3, pointRadius: 3 },
        { label: 'Projeção', data: projLine, borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.1)', fill: true, borderDash: [6, 4], tension: 0.3, pointRadius: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#64748b', font: { size: 10 }, callback: v => v >= 1000 ? 'R$' + (v / 1000).toFixed(0) + 'k' : 'R$' + v } }
      }
    }
  });
}

function renderProjGoals(proj) {
  const el = document.getElementById('projGoalsList');
  if (!el) return;
  if (proj.goalProjections.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Crie metas na aba Metas para ver projeções aqui</div>';
    return;
  }

  const statusColors = { done: 'var(--accent3)', good: 'var(--accent3)', warn: 'var(--gold)', late: 'var(--accent4)', danger: 'var(--danger)' };
  const statusLabels = { done: 'Concluída', good: 'No prazo', warn: 'Possível', late: 'Difícil', danger: 'Improvável' };

  el.innerHTML = proj.goalProjections.map(g => {
    const target = parseFloat(g.target) || 0;
    const current = parseFloat(g.current) || 0;
    const pct = target > 0 ? Math.min((current / target) * 100, 100) : 0;
    const col = statusColors[g.status] || 'var(--text3)';
    return `<div style="padding:14px;background:var(--bg3);border-radius:10px;margin-bottom:8px;border-left:4px solid ${col}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-weight:500">${esc(g.name)}</div>
        <span class="badge" style="background:${col}22;color:${col};font-size:11px">${statusLabels[g.status] || '—'}</span>
      </div>
      <div style="font-size:13px;color:var(--text2);margin-bottom:6px">${formatBRL(current)} de ${formatBRL(target)} · Previsão: <strong style="color:${col}">${esc(g.date)}</strong>${g.monthsToGoal > 0 && g.monthsToGoal < Infinity ? ' (' + g.monthsToGoal + ' meses)' : ''}</div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%;background:${col}"></div>
      </div>
    </div>`;
  }).join('');
}
