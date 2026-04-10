// ========================================
// API.JS - API and AI integration
// ========================================

let ANTHROPIC_API_KEY = '';

// === AI SUGGESTIONS ===
const aiSuggestions = [
  'Como está minha saúde financeira?',
  'Onde estou gastando mais que deveria?',
  'Quanto posso investir por mês?',
  'Qual investimento é melhor para mim agora?',
  'Quando vou atingir minha reserva de emergência?',
  'Me dê dicas para reduzir gastos.',
];

function renderAiSuggestions() {
  const el = document.getElementById('aiSuggestions');
  if (!el) return;
  el.innerHTML = aiSuggestions.map(s =>
    `<div style="padding:8px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text2);cursor:pointer;margin-bottom:6px;transition:all .15s" onclick="askAI('${esc(s)}')" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text2)'">${esc(s)}</div>`
  ).join('');
}

// === API KEY MANAGEMENT ===
function saveApiKey() {
  const input = document.getElementById('apiKeyInput');
  const key = input.value.trim();
  if (!key || !key.startsWith('sk-')) {
    document.getElementById('apiKeyStatus').innerHTML = '<span style="color:var(--danger)">Chave inválida. Deve começar com "sk-"</span>';
    return;
  }
  ANTHROPIC_API_KEY = key;
  try { saveApiKeyToStorage(key); } catch (e) {}
  document.getElementById('apiKeyStatus').innerHTML = '<span style="color:var(--accent3)">Chave salva com sucesso!</span>';
  document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-success">API conectada — IA pronta para uso!</div><div style="font-size:13px;color:var(--text2);line-height:1.6"><strong>Funcionalidades ativas:</strong><br>Consultor IA (chat), classificação de extratos e contracheques</div>';
  testApiConnection(key);
}

async function testApiConnection(key) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 10, messages: [{ role: 'user', content: 'oi' }] })
    });
    if (res.ok) {
      document.getElementById('apiKeyStatus').innerHTML = '<span style="color:var(--accent3)">Conexão testada com sucesso!</span>';
      document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-success">API conectada e funcionando!</div><div style="font-size:13px;color:var(--text2);line-height:1.6"><strong>Funcionalidades ativas:</strong><br>Consultor IA, classificação de extratos e contracheques</div>';
    } else {
      const err = await res.json();
      document.getElementById('apiKeyStatus').innerHTML = `<span style="color:var(--danger)">Erro: ${esc(err.error?.message || 'Chave inválida')}</span>`;
      document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-danger">Falha na conexão — verifique a chave</div>';
    }
  } catch (e) {
    document.getElementById('apiKeyStatus').innerHTML = `<span style="color:var(--danger)">Erro de rede: ${esc(e.message)}</span>`;
  }
}

function checkApiKey() {
  if (!ANTHROPIC_API_KEY) {
    const stored = getApiKey();
    if (stored) ANTHROPIC_API_KEY = stored;
  }
  if (!ANTHROPIC_API_KEY) {
    alert('Configure sua chave API primeiro! Vá em Configurações no menu lateral.');
    showSection('config', null);
    return false;
  }
  return true;
}

// === DYNAMIC SYSTEM PROMPT ===
function buildSystemPrompt() {
  const summary = getFinancialSummary(selectedMonth);
  const totalInvested = investments.reduce((a, i) => a + (parseFloat(i.value) || 0), 0);
  const liquidTotal = getLiquidTotal();
  const catLines = Object.entries(summary.catBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, val]) => `  - ${cat}: R$ ${val.toFixed(0)}`)
    .join('\n');

  const goalLines = goals.map(g => {
    const pct = parseFloat(g.target) > 0 ? ((parseFloat(g.current || 0) / parseFloat(g.target)) * 100).toFixed(0) : 0;
    return `  - ${g.name}: ${pct}% (R$ ${parseFloat(g.current || 0).toFixed(0)} de R$ ${parseFloat(g.target).toFixed(0)})`;
  }).join('\n');

  const invLines = investments.map(i =>
    `  - ${i.name} (${i.type}): R$ ${parseFloat(i.value).toFixed(0)} a ${parseFloat(i.rate).toFixed(1)}% a.a.`
  ).join('\n');

  // Projection data for forward-looking advice
  let projContext = '';
  try {
    const proj = computeProjections('moderado');
    if (proj.hasData) {
      projContext = `
PROJEÇÕES (cenário moderado, 12 meses):
- Receita mensal projetada: R$ ${proj.projIncome.toFixed(0)}
- Despesa mensal projetada: R$ ${proj.projExpense.toFixed(0)}
- Economia mensal projetada: R$ ${proj.monthlySavings.toFixed(0)}
- Patrimônio projetado em 12 meses: R$ ${proj.patrimonio12m.toFixed(0)}
- Meses para reserva de emergência (6x despesas, só investimentos líquidos): ${proj.monthsToEmergency === Infinity ? 'impossível no ritmo atual' : proj.monthsToEmergency}
- Investimentos líquidos: R$ ${proj.emergencyCurrent.toFixed(0)} de R$ ${proj.emergencyTarget.toFixed(0)} necessários`;
    }
  } catch (e) {}

  const monthLabel = selectedMonth || new Date().toISOString().slice(0, 7);
  return `Você é um consultor financeiro pessoal especializado em finanças domésticas brasileiras.
O casal chama-se Júlio e Elaynne. Dados financeiros do mês ${monthLabel}:
- Receitas: R$ ${summary.receitas.toFixed(0)}
- Despesas: R$ ${summary.despesas.toFixed(0)}
- Saldo do mês: R$ ${summary.saldo.toFixed(0)}
- Patrimônio investido total: R$ ${totalInvested.toFixed(0)} (líquido: R$ ${liquidTotal.toFixed(0)})
${catLines ? '- Gastos por categoria:\n' + catLines : ''}
${goalLines ? '- Metas financeiras:\n' + goalLines : '- Sem metas financeiras definidas'}
${invLines ? '- Investimentos:\n' + invLines : '- Sem investimentos'}
${projContext}

Responda de forma direta, objetiva e personalizada. Use linguagem amigável e brasileira. Dê conselhos práticos e orientados para o futuro quando possível. Máximo 3 parágrafos. Não use markdown, escreva em texto corrido.`;
}

// === AI CHAT ===
let aiProcessing = false;

async function sendAI() {
  const input = document.getElementById('aiInputField');
  const msg = input.value.trim();
  if (!msg) return;
  askAI(msg);
  input.value = '';
}

async function askAI(msg) {
  if (!checkApiKey()) return;
  if (aiProcessing) return;
  aiProcessing = true;

  const msgs = document.getElementById('aiMessages');
  msgs.innerHTML += `<div class="msg user fade-in"><div class="msg-avatar">JE</div><div class="msg-bubble">${esc(msg)}</div></div>`;

  const typingId = 'typing_' + Date.now();
  msgs.innerHTML += `<div class="msg ai fade-in" id="${typingId}"><div class="msg-avatar">✦</div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div></div>`;
  msgs.scrollTop = msgs.scrollHeight;

  aiHistory.push({ role: 'user', content: msg });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1000,
        system: buildSystemPrompt(),
        messages: aiHistory
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Erro na API');
    }
    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Não consegui processar. Tente novamente.';
    aiHistory.push({ role: 'assistant', content: reply });
    // Keep only last 20 messages to avoid localStorage bloat and API cost
    const AI_HISTORY_LIMIT = 20;
    if (aiHistory.length > AI_HISTORY_LIMIT) {
      aiHistory.splice(0, aiHistory.length - AI_HISTORY_LIMIT);
    }
    document.getElementById(typingId)?.remove();
    msgs.innerHTML += `<div class="msg ai fade-in"><div class="msg-avatar">✦</div><div class="msg-bubble">${esc(reply)}</div></div>`;
    msgs.scrollTop = msgs.scrollHeight;
    saveToLocalStorage();
  } catch (e) {
    aiHistory.pop();
    document.getElementById(typingId)?.remove();
    msgs.innerHTML += `<div class="msg ai fade-in"><div class="msg-avatar">✦</div><div class="msg-bubble" style="color:var(--danger)">Erro: ${esc(e.message)}. Verifique sua chave API em Configurações.</div></div>`;
    msgs.scrollTop = msgs.scrollHeight;
  } finally {
    aiProcessing = false;
  }
}

// === IMPORT / AI CLASSIFY ===
// Stores parsed data for the current import session
let _pendingBill = null;
let _pendingTransactions = [];

async function processarExtrato() {
  if (!checkApiKey()) return;
  const text = document.getElementById('pasteArea').value.trim();
  if (!text) { alert('Cole o conteúdo do extrato primeiro!'); return; }
  _pendingBill = null;
  _pendingTransactions = [];

  const res = document.getElementById('analiseResult');
  res.style.justifyContent = 'flex-start';
  res.style.alignItems = 'flex-start';
  const textLen = text.length;
  const estTx = textLen > 5000 ? '(documento grande — pode levar 15-30s)' : '';
  res.innerHTML = `<div style="padding:20px;text-align:center"><div class="spinner"></div><div style="margin-top:12px;font-size:13px;color:var(--text3)">IA analisando e classificando transações... ${estTx}</div><div style="margin-top:6px;font-size:11px;color:var(--text3)">${textLen.toLocaleString()} caracteres extraídos</div></div>`;

  const validCats = Object.keys(CATEGORIES).join(', ');

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: `Você é um sistema inteligente de classificação financeira brasileira. Extraia TODAS as transações do documento.

TIPOS DE DOCUMENTOS SUPORTADOS: Extrato bancário, Fatura de cartão de crédito, Contracheque/Holerite, Documento de investimento.

DETECÇÃO DE TIPO:
- Se o documento for uma FATURA DE CARTÃO DE CRÉDITO (contém termos como "fatura", "cartão final", "vencimento", "limite", "crédito"), retorne:
{
  "tipo": "fatura_cartao",
  "cartao": "últimos 4 dígitos ou nome do cartão",
  "mesReferencia": "YYYY-MM",
  "vencimento": "YYYY-MM-DD",
  "totalFatura": numero_positivo,
  "transacoes": [ { "date": "YYYY-MM-DD", "name": "descrição", "category": "categoria", "value": numero_positivo } ]
}

- Para QUALQUER OUTRO tipo de documento, retorne:
{
  "tipo": "extrato",
  "transacoes": [ { "date": "YYYY-MM-DD", "name": "descrição", "category": "categoria", "value": numero_positivo, "type": "receita|despesa" } ]
}

Categorias válidas para despesas: ${validCats}
Para receitas use category "Receita" com type "receita".

IMPORTANTE: Datas em YYYY-MM-DD. Value SEMPRE positivo. Em fatura de cartão todas as transações são despesa (não precisa do campo type). Extraia TODAS as transações, não resuma.`,
        messages: [{ role: 'user', content: `Analise e classifique TODAS as transações deste documento:\n\n${text}` }]
      })
    });
    if (!apiRes.ok) {
      const err = await apiRes.json();
      throw new Error(err.error?.message || 'Erro na análise');
    }
    const data = await apiRes.json();
    const responseText = data.content?.[0]?.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*("tipo"|"transacoes")[\s\S]*\}/);
    if (!jsonMatch) throw new Error('IA não retornou JSON válido');
    const parsed = JSON.parse(jsonMatch[0]);

    // === FATURA DE CARTÃO (grouped bill) ===
    if (parsed.tipo === 'fatura_cartao') {
      const txList = parsed.transacoes || [];
      if (txList.length === 0) {
        res.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)"><div style="font-size:48px;margin-bottom:8px">🤔</div><div>Nenhuma transação na fatura.</div></div>';
        return;
      }
      const total = parsed.totalFatura || txList.reduce((a, t) => a + (parseFloat(t.value) || 0), 0);
      _pendingBill = {
        cartao: parsed.cartao || '****',
        mesReferencia: parsed.mesReferencia || '',
        vencimento: parsed.vencimento || '',
        totalFatura: total,
        transacoes: txList
      };

      // Render bill preview
      const mesLabel = parsed.mesReferencia ? parsed.mesReferencia.split('-').reverse().join('/') : '';
      const vencLabel = parsed.vencimento ? parsed.vencimento.split('-').reverse().join('/') : '';
      document.getElementById('importedTxSection').style.display = 'block';
      document.getElementById('importedTxSection').innerHTML = `
        <div class="divider"></div>
        <div class="card" style="border-left:4px solid var(--danger);margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
            <div>
              <div style="font-size:16px;font-weight:600">💳 Fatura Cartão ****${esc(_pendingBill.cartao)}</div>
              <div style="font-size:13px;color:var(--text2);margin-top:4px">Referência: ${esc(mesLabel)} · Vencimento: <strong>${esc(vencLabel)}</strong></div>
            </div>
            <div style="text-align:right">
              <div style="font-size:20px;font-weight:600;color:var(--danger)">R$ ${total.toFixed(2).replace('.', ',')}</div>
              <div style="font-size:12px;color:var(--text3)">${txList.length} transações</div>
            </div>
          </div>
        </div>
        <div class="card-header" style="margin-bottom:12px">
          <div style="font-size:14px;font-weight:500">Detalhamento da Fatura</div>
          <button class="btn btn-success" onclick="salvarFatura()">Salvar Fatura</button>
        </div>
        <div class="card">
          <table class="data-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Ação</th></tr></thead>
          <tbody id="billPreviewTbody">${txList.map((t, i) => {
            const icon = catIcon(t.category);
            return `<tr data-bill-idx="${i}">
              <td>${esc(t.date || '—')}</td>
              <td>${esc(icon)} ${esc(t.name || '—')}</td>
              <td><span class="badge badge-blue">${esc(t.category || 'Outros')}</span></td>
              <td style="color:var(--text);font-weight:500">- R$ ${parseFloat(t.value || 0).toFixed(2).replace('.', ',')}</td>
              <td><button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="removeBillItem(${i})" title="Remover">✕</button></td>
            </tr>`;
          }).join('')}</tbody></table>
        </div>`;

      res.innerHTML = `<div style="padding:20px;text-align:center"><div style="font-size:48px;margin-bottom:8px">💳</div><div style="font-size:15px;margin-bottom:6px">Fatura de cartão detectada!</div><div style="font-size:13px;color:var(--text3)">${txList.length} compras · Total R$ ${total.toFixed(2).replace('.', ',')}</div></div>`;
      return;
    }

    // === EXTRATO / CONTRACHEQUE (flat transactions) ===
    const txList = parsed.transacoes || [];
    if (txList.length === 0) {
      res.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)"><div style="font-size:48px;margin-bottom:8px">🤔</div><div>Nenhuma transação identificada.</div></div>';
      return;
    }
    // Store parsed data in JS variable (not DOM) for reliable saving
    _pendingTransactions = txList.map((t, i) => ({
      idx: i,
      date: t.date || '',
      name: t.name || '—',
      category: Object.keys(CATEGORIES).find(c => c === t.category) || 'Outros',
      value: parseFloat(t.value) || 0,
      type: t.type === 'receita' ? 'receita' : 'despesa'
    }));
    document.getElementById('importedTxSection').style.display = 'block';
    document.getElementById('importedTxSection').innerHTML = `
      <div class="divider"></div>
      <div class="card-header" style="margin-bottom:16px">
        <div style="font-size:16px;font-weight:600">Transações Identificadas</div>
        <button class="btn btn-success" onclick="salvarTransacoes()">Salvar Todas</button>
      </div>
      <div class="card">
        <table class="data-table" id="importedTable"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria IA</th><th>Valor</th><th>Tipo</th><th>Ação</th></tr></thead>
        <tbody id="importedTbody"></tbody></table>
      </div>`;
    const tbody = document.getElementById('importedTbody');
    _pendingTransactions.forEach((t, i) => {
      const icon = catIcon(t.category);
      const row = tbody.insertRow();
      row.setAttribute('data-tx-idx', i);
      row.innerHTML = `
        <td>${esc(t.date || '—')}</td>
        <td>${esc(icon)} ${esc(t.name)}</td>
        <td><span class="badge badge-blue">${esc(t.category)}</span></td>
        <td style="color:${t.type === 'receita' ? 'var(--accent3)' : 'var(--text)'}; font-weight:500">
          ${t.type === 'receita' ? '+' : '-'} R$ ${t.value.toFixed(2).replace('.', ',')}
        </td>
        <td style="color:var(--text3)">${esc(t.type === 'receita' ? 'Receita' : 'Despesa')}</td>
        <td><button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="removePendingTx(${i})" title="Remover">✕</button></td>`;
    });
    res.innerHTML = `<div style="padding:20px;text-align:center"><div style="font-size:48px;margin-bottom:8px">✅</div><div style="font-size:15px;margin-bottom:6px">Análise concluída!</div><div style="font-size:13px;color:var(--text3)">${txList.length} transações identificadas</div></div>`;
  } catch (e) {
    res.innerHTML = `<div style="padding:20px;text-align:center"><div style="font-size:48px;margin-bottom:8px">❌</div><div style="font-size:15px;color:var(--danger);margin-bottom:6px">Erro na análise</div><div style="font-size:13px;color:var(--text3)">${esc(e.message)}</div></div>`;
  }
}

function removeBillItem(idx) {
  if (!_pendingBill) return;
  _pendingBill.transacoes.splice(idx, 1);
  _pendingBill.totalFatura = _pendingBill.transacoes.reduce((a, t) => a + (parseFloat(t.value) || 0), 0);
  // Re-render by triggering the bill preview again
  const row = document.querySelector(`tr[data-bill-idx="${idx}"]`);
  if (row) row.remove();
  // Re-index remaining rows
  document.querySelectorAll('#billPreviewTbody tr').forEach((r, i) => {
    r.setAttribute('data-bill-idx', i);
    const btn = r.querySelector('button');
    if (btn) btn.setAttribute('onclick', `removeBillItem(${i})`);
  });
}

function salvarFatura() {
  if (!_pendingBill || _pendingBill.transacoes.length === 0) {
    alert('Nenhuma transação na fatura!');
    return;
  }
  const bill = _pendingBill;
  // Check if a bill for the same card/month already exists
  const existingBill = transactions.find(t => t.isBill && t.cardDigits === bill.cartao && t.billMonth === bill.mesReferencia);
  if (existingBill && !confirm('Fatura do cartão ****' + bill.cartao + ' referente a ' + bill.mesReferencia + ' já foi importada. Importar novamente?')) return;
  const children = bill.transacoes.map(t => ({
    date: t.date || bill.mesReferencia + '-01',
    name: t.name || '—',
    cat: Object.keys(CATEGORIES).find(c => c === t.category) || 'Outros',
    val: roundCents(-(parseFloat(t.value) || 0)),
    method: 'Crédito',
    icon: catIcon(t.category),
    color: catColor(t.category)
  }));

  const mesLabel = bill.mesReferencia || '';
  const parentTx = {
    date: bill.vencimento || bill.mesReferencia + '-01',
    name: `Fatura Cartão ****${bill.cartao} — ${mesLabel}`,
    cat: 'Outros',
    val: roundCents(-bill.totalFatura),
    method: 'Crédito',
    icon: '💳',
    color: '#f87171',
    isBill: true,
    dueDate: bill.vencimento,
    billMonth: bill.mesReferencia,
    cardDigits: bill.cartao,
    children: children
  };

  transactions.unshift(parentTx);
  _pendingBill = null;
  updateBudgetFromTransactions();
  refreshAll();
  document.getElementById('pasteArea').value = '';
  document.getElementById('analiseResult').innerHTML = '<div style="text-align:center;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">🤖</div><div style="font-size:15px;margin-bottom:6px">Aguardando documento</div><div style="font-size:13px">Faça upload ou cole seu extrato para que a IA analise e classifique.</div></div>';
  document.getElementById('importedTxSection').style.display = 'none';
  document.getElementById('importedTxSection').innerHTML = '';
  alert(`Fatura salva com ${children.length} transações!`);
}

function removePendingTx(idx) {
  _pendingTransactions = _pendingTransactions.filter(t => t.idx !== idx);
  const row = document.querySelector(`tr[data-tx-idx="${idx}"]`);
  if (row) row.remove();
}

function salvarTransacoes() {
  if (_pendingTransactions.length === 0) { alert('Nenhuma transação para salvar!'); return; }

  // Check for duplicates
  const dupeItems = findDuplicates(_pendingTransactions.map(t => ({ date: t.date, val: t.type === 'receita' ? t.value : -t.value, name: t.name })));
  let toSave = _pendingTransactions;
  if (dupeItems.length > 0) {
    const action = confirm(dupeItems.length + ' transação(ões) duplicada(s) encontrada(s). OK = importar todas, Cancelar = pular duplicadas.');
    if (!action) {
      const dupeHashes = new Set(dupeItems.map(d => txHash(d.date, d.val, d.name)));
      toSave = _pendingTransactions.filter(t => !dupeHashes.has(txHash(t.date, t.type === 'receita' ? t.value : -t.value, t.name)));
      if (toSave.length === 0) { alert('Todas as transações já existem!'); return; }
    }
  }

  const count = toSave.length;
  toSave.forEach(t => {
    const catStr = t.category;
    transactions.unshift({
      date: t.date || new Date().toISOString().split('T')[0],
      name: t.name,
      cat: catStr,
      val: roundCents(t.type === 'receita' ? t.value : -t.value),
      method: 'Importado IA',
      icon: catIcon(catStr),
      color: catColor(catStr)
    });
  });
  _pendingTransactions = [];
  updateBudgetFromTransactions();
  refreshAll();
  document.getElementById('pasteArea').value = '';
  document.getElementById('analiseResult').innerHTML = '<div style="text-align:center;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">🤖</div><div style="font-size:15px;margin-bottom:6px">Aguardando documento</div><div style="font-size:13px">Faça upload ou cole seu extrato para que a IA analise e classifique.</div></div>';
  document.getElementById('importedTxSection').style.display = 'none';
  document.getElementById('importedTxSection').innerHTML = '';
  alert(count + ' transações importadas com sucesso!');
}
