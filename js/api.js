// ========================================
// API.JS - API and AI integration
// ========================================

let GEMINI_API_KEY = '';

// === GEMINI ADAPTER ===
// Encapsula a chamada ao Google Gemini. Recebe a mesma forma de mensagens que
// o app usa internamente ({role: 'user'|'assistant', content: string}) e
// converte para o formato do Gemini ('user'|'model', parts).
//
// Resiliência (Fase 0):
//   1. Classifica erros HTTP em 'transient'/'invalid_key'/'quota'/'bad_request'/'unknown'.
//   2. Em transientes (503/429/5xx/UNAVAILABLE), faz retry com backoff exponencial 1s/2s/4s (+ jitter).
//   3. Se todos os retries falharem no modelo atual, tenta o próximo de GEMINI_MODELS.
//   4. Erros permanentes (401/403/400 de chave, cota esgotada) falham rápido sem retry.
// O Error propagado traz: err.kind, err.friendlyMessage, err.rawMsg, err.status, err.allModelsFailed.

function classifyGeminiError(status, errBody) {
  const rawMsg = (errBody && errBody.error && errBody.error.message || '').toString();
  const lowerMsg = rawMsg.toLowerCase();
  const gStatus = (errBody && errBody.error && errBody.error.status || '').toString();

  // Cota gratuita diária esgotada — 429 com "quota"/"exceeded" OU RESOURCE_EXHAUSTED com menção a quota
  if ((status === 429 && (lowerMsg.includes('quota') || lowerMsg.includes('exceeded'))) ||
      (gStatus === 'RESOURCE_EXHAUSTED' && lowerMsg.includes('quota'))) {
    return {
      kind: 'quota',
      retryable: false,
      friendlyMessage: 'Você atingiu o limite gratuito diário do Gemini. Tente novamente amanhã ou gere uma nova chave no Google AI Studio.',
      rawMsg
    };
  }

  // Chave inválida ou não autorizada
  if (status === 401 || status === 403 ||
      (status === 400 && (lowerMsg.includes('api key') || lowerMsg.includes('api_key') || lowerMsg.includes('invalid key') || lowerMsg.includes('api-key')))) {
    return {
      kind: 'invalid_key',
      retryable: false,
      friendlyMessage: 'Sua chave de API parece inválida ou expirou. Verifique em Configurações.',
      rawMsg
    };
  }

  // Transitórios — vale retry (sobrecarga do modelo, erro interno, gateway timeout)
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504 ||
      gStatus === 'UNAVAILABLE' || gStatus === 'RESOURCE_EXHAUSTED' || gStatus === 'INTERNAL' || gStatus === 'DEADLINE_EXCEEDED') {
    return {
      kind: 'transient',
      retryable: true,
      friendlyMessage: 'A IA do Google está sobrecarregada agora. Tente de novo em 1-2 minutos — não é problema com sua chave.',
      rawMsg
    };
  }

  // 400 que não é de chave — provavelmente payload inválido
  if (status === 400) {
    return {
      kind: 'bad_request',
      retryable: false,
      friendlyMessage: rawMsg ? `A IA recusou o pedido: ${rawMsg}` : 'A IA recusou o pedido por payload inválido.',
      rawMsg
    };
  }

  return {
    kind: 'unknown',
    retryable: false,
    friendlyMessage: rawMsg ? `Erro inesperado da IA: ${rawMsg}` : 'Erro inesperado ao contatar a IA.',
    rawMsg
  };
}

function _aiSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callAI({ system, messages, maxTokens = 1000, jsonMode = false }) {
  const contents = (messages || []).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content || '') }]
  }));
  const body = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens }
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (jsonMode) body.generationConfig.responseMimeType = 'application/json';
  const payload = JSON.stringify(body);

  const models = (typeof GEMINI_MODELS !== 'undefined' && Array.isArray(GEMINI_MODELS) && GEMINI_MODELS.length)
    ? GEMINI_MODELS
    : [GEMINI_MODEL];
  const MAX_RETRIES_PER_MODEL = 3;
  const BACKOFF_MS = [1000, 2000, 4000]; // jitter ±20% aplicado em runtime
  let lastClassified = null;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES_PER_MODEL; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
      } catch (netErr) {
        // Falha de rede (offline, DNS, CORS bloqueado) — tratado como transitório
        lastClassified = {
          kind: 'transient',
          retryable: true,
          friendlyMessage: 'Falha de rede ao contatar a IA. Verifique sua conexão e tente de novo.',
          rawMsg: (netErr && netErr.message) || 'network error'
        };
        if (attempt < MAX_RETRIES_PER_MODEL - 1) {
          const base = BACKOFF_MS[attempt] || 4000;
          const jitter = base * 0.2 * (Math.random() * 2 - 1);
          await _aiSleep(Math.max(0, base + jitter));
          continue;
        }
        break; // esgotou retries: tenta próximo modelo
      }
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { text, raw: data, modelUsed: model };
      }
      let errBody = null;
      try { errBody = await res.json(); } catch (e) {}
      const classified = classifyGeminiError(res.status, errBody);
      lastClassified = classified;
      if (!classified.retryable) {
        // Erro permanente: falhar rápido, sem tentar outros modelos (não adiantaria)
        const err = new Error(classified.friendlyMessage);
        err.kind = classified.kind;
        err.friendlyMessage = classified.friendlyMessage;
        err.rawMsg = classified.rawMsg;
        err.status = res.status;
        throw err;
      }
      // Transitório: backoff + retry no mesmo modelo; se esgotou retries, cai para o próximo modelo
      if (attempt < MAX_RETRIES_PER_MODEL - 1) {
        const base = BACKOFF_MS[attempt] || 4000;
        const jitter = base * 0.2 * (Math.random() * 2 - 1);
        await _aiSleep(Math.max(0, base + jitter));
      }
    }
  }

  // Todos os modelos esgotaram retries — erro transitório persistente
  const finalMsg = (lastClassified && lastClassified.friendlyMessage)
    || 'A IA do Google está indisponível no momento. Tente novamente em alguns minutos.';
  const err = new Error(finalMsg);
  err.kind = (lastClassified && lastClassified.kind) || 'transient';
  err.friendlyMessage = finalMsg;
  err.rawMsg = (lastClassified && lastClassified.rawMsg) || '';
  err.allModelsFailed = true;
  throw err;
}

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
  if (!key || !key.startsWith('AIza')) {
    document.getElementById('apiKeyStatus').innerHTML = '<span style="color:var(--danger)">Chave inválida. Deve começar com "AIza" (chave do Google AI Studio)</span>';
    return;
  }
  GEMINI_API_KEY = key;
  try { saveApiKeyToStorage(key); } catch (e) {}
  document.getElementById('apiKeyStatus').innerHTML = '<span style="color:var(--accent3)">Chave salva com sucesso!</span>';
  document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-success">API conectada — IA pronta para uso!</div><div style="font-size:13px;color:var(--text2);line-height:1.6"><strong>Funcionalidades ativas:</strong><br>Consultor IA (chat), classificação de extratos e contracheques</div>';
  testApiConnection(key);
}

async function testApiConnection(key) {
  const previous = GEMINI_API_KEY;
  GEMINI_API_KEY = key;
  try {
    await callAI({ messages: [{ role: 'user', content: 'oi' }], maxTokens: 10 });
    document.getElementById('apiKeyStatus').innerHTML = '<span style="color:var(--accent3)">Conexão testada com sucesso!</span>';
    document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-success">API conectada e funcionando!</div><div style="font-size:13px;color:var(--text2);line-height:1.6"><strong>Funcionalidades ativas:</strong><br>Consultor IA, classificação de extratos e contracheques</div>';
  } catch (e) {
    // Só reverter a chave se o erro for de chave inválida. Se for sobrecarga transitória,
    // manter a chave nova — ela pode estar correta, o Gemini que está fora do ar agora.
    const friendly = e.friendlyMessage || e.message || 'Erro desconhecido';
    if (e.kind === 'invalid_key') {
      GEMINI_API_KEY = previous;
      document.getElementById('apiKeyStatus').innerHTML = `<span style="color:var(--danger)">${esc(friendly)}</span>`;
      document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-danger">Falha na conexão — chave inválida</div>';
    } else {
      // Chave provavelmente OK, mas IA inacessível agora
      document.getElementById('apiKeyStatus').innerHTML = `<span style="color:var(--warn, #fbbf24)">Chave salva, mas o teste falhou: ${esc(friendly)}</span>`;
      document.getElementById('connectionStatus').innerHTML = '<div class="alert alert-warning">Chave salva. Teste automático não concluiu — tente enviar uma pergunta na tela do Consultor IA.</div>';
    }
  }
}

function checkApiKey() {
  if (!GEMINI_API_KEY) {
    const stored = getApiKey();
    if (stored) GEMINI_API_KEY = stored;
  }
  if (!GEMINI_API_KEY) {
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
  const nomes = (perfil && perfil.casal && perfil.casal.trim()) ? perfil.casal.trim() : null;
  const apresentacao = nomes
    ? `O casal chama-se ${nomes}.`
    : `Trate o(s) usuário(s) de forma neutra, sem assumir nomes.`;
  return `Você é um consultor financeiro pessoal especializado em finanças domésticas brasileiras.
${apresentacao} Dados financeiros do mês ${monthLabel}:
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
  // Iniciais dinâmicas do casal/lar (derivadas de perfil.casal); fallback "MC" pra Minha Casa
  const userInitials = (typeof deriveInitials === 'function' && typeof perfil !== 'undefined')
    ? (deriveInitials(perfil.casal || '') || 'MC')
    : 'MC';
  msgs.innerHTML += `<div class="msg user fade-in"><div class="msg-avatar">${esc(userInitials)}</div><div class="msg-bubble">${esc(msg)}</div></div>`;

  const typingId = 'typing_' + Date.now();
  msgs.innerHTML += `<div class="msg ai fade-in" id="${typingId}"><div class="msg-avatar">✦</div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div></div>`;
  msgs.scrollTop = msgs.scrollHeight;

  aiHistory.push({ role: 'user', content: msg });

  try {
    const { text } = await callAI({
      system: buildSystemPrompt(),
      messages: aiHistory,
      maxTokens: 1000
    });
    const reply = text || 'Não consegui processar. Tente novamente.';
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
    // Mensagem amigável classificada por tipo (transient/invalid_key/quota/bad_request/unknown).
    // Só sugerimos "verificar chave em Configurações" quando o erro realmente é de chave.
    const friendly = e.friendlyMessage || e.message || 'Erro inesperado.';
    const showConfigHint = e.kind === 'invalid_key';
    const hintHtml = showConfigHint
      ? ' <a href="#" onclick="showSection(\'config\', null); return false" style="color:var(--danger);text-decoration:underline">Abrir Configurações</a>'
      : '';
    msgs.innerHTML += `<div class="msg ai fade-in"><div class="msg-avatar">✦</div><div class="msg-bubble" style="color:var(--danger)">${esc(friendly)}${hintHtml}</div></div>`;
    msgs.scrollTop = msgs.scrollHeight;
  } finally {
    aiProcessing = false;
  }
}

// === IMPORT / AI CLASSIFY ===
// Stores parsed data for the current import session
let _pendingBill = null;
let _pendingPayslip = null;
let _pendingTransactions = [];

async function processarExtrato() {
  if (!checkApiKey()) return;
  const text = document.getElementById('pasteArea').value.trim();
  if (!text) { alert('Cole o conteúdo do extrato primeiro!'); return; }
  _pendingBill = null;
  _pendingPayslip = null;
  _pendingTransactions = [];

  const res = document.getElementById('analiseResult');
  res.style.justifyContent = 'flex-start';
  res.style.alignItems = 'flex-start';
  const textLen = text.length;
  const estTx = textLen > 5000 ? '(documento grande — pode levar 15-30s)' : '';
  res.innerHTML = `<div style="padding:20px;text-align:center"><div class="spinner"></div><div style="margin-top:12px;font-size:13px;color:var(--text3)">IA analisando e classificando transações... ${estTx}</div><div style="margin-top:6px;font-size:11px;color:var(--text3)">${textLen.toLocaleString()} caracteres extraídos</div></div>`;

  const validCats = Object.keys(CATEGORIES).join(', ');

  try {
    const systemPrompt = `Você é um sistema inteligente de classificação financeira brasileira. Extraia TODOS os lançamentos do documento.

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

- Se o documento for um CONTRACHEQUE / HOLERITE / DEMONSTRATIVO DE PAGAMENTO (contém termos como "contracheque", "holerite", "folha de pagamento", "proventos", "descontos", "líquido a receber", "salário base", "competência", "INSS", "IRRF"), retorne:
{
  "tipo": "contracheque",
  "empregador": "nome da empresa/empregador (string vazia se não encontrado)",
  "competencia": "YYYY-MM (mês de referência do contracheque)",
  "bruto": numero_positivo_total_proventos,
  "liquido": numero_positivo_total_liquido,
  "lancamentos": [
    { "date": "YYYY-MM-DD", "name": "Salário base", "category": "Receita", "type": "receita", "value": numero_positivo },
    { "date": "YYYY-MM-DD", "name": "INSS", "category": "Impostos", "type": "despesa", "value": numero_positivo },
    { "date": "YYYY-MM-DD", "name": "IRRF", "category": "Impostos", "type": "despesa", "value": numero_positivo }
  ]
}

REGRAS DE CATEGORIZAÇÃO PARA CONTRACHEQUE:
* Proventos (salário base, horas extras, adicional noturno, insalubridade, periculosidade, comissões, bonificações, 13º, férias, PLR) → category "Receita", type "receita".
* INSS, IRRF, IR, contribuição previdenciária → category "Impostos", type "despesa".
* Plano de saúde, convênio médico, odontológico → category "Saúde", type "despesa".
* Vale transporte (desconto) → category "Transporte", type "despesa".
* Vale refeição / vale alimentação (se aparecer como desconto) → category "Alimentação", type "despesa".
* Contribuição sindical, mensalidade associativa → category "Outros", type "despesa".
* Empréstimo consignado, adiantamento → category "Outros", type "despesa".
Use a data do pagamento (ou primeiro dia do mês de competência se a data não estiver explícita) em todos os lançamentos.

- Para QUALQUER OUTRO tipo de documento, retorne:
{
  "tipo": "extrato",
  "transacoes": [ { "date": "YYYY-MM-DD", "name": "descrição", "category": "categoria", "value": numero_positivo, "type": "receita|despesa" } ]
}

Categorias válidas para despesas: ${validCats}
Para receitas use category "Receita" com type "receita".

IMPORTANTE: Datas em YYYY-MM-DD. Value SEMPRE positivo (o sinal é inferido pelo type). Em fatura de cartão todas as transações são despesa (não precisa do campo type). Extraia TODAS as transações, não resuma. Responda APENAS com o JSON, sem texto antes ou depois.`;

    const { text: responseText } = await callAI({
      system: systemPrompt,
      messages: [{ role: 'user', content: `Analise e classifique TODAS as transações deste documento:\n\n${text}` }],
      maxTokens: 8000,
      jsonMode: true
    });
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      const jsonMatch = responseText.match(/\{[\s\S]*("tipo"|"transacoes")[\s\S]*\}/);
      if (!jsonMatch) throw new Error('IA não retornou JSON válido');
      parsed = JSON.parse(jsonMatch[0]);
    }

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

    // === CONTRACHEQUE (grouped payslip) ===
    if (parsed.tipo === 'contracheque') {
      _pendingPayslip = buildPendingPayslip(parsed);
      if (!_pendingPayslip) {
        res.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)"><div style="font-size:48px;margin-bottom:8px">🤔</div><div>Nenhum lançamento encontrado no contracheque.</div></div>';
        return;
      }
      renderPayslipPreview();
      return;
    }

    // === EXTRATO (flat transactions) ===
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
    // Usa mensagem amigável classificada (setada por callAI). Fallback para e.message para
    // outros erros (ex: "IA não retornou JSON válido" jogado acima).
    const friendly = e.friendlyMessage || e.message || 'Erro inesperado.';
    res.innerHTML = `<div style="padding:20px;text-align:center"><div style="font-size:48px;margin-bottom:8px">❌</div><div style="font-size:15px;color:var(--danger);margin-bottom:6px">Erro na análise</div><div style="font-size:13px;color:var(--text3)">${esc(friendly)}</div></div>`;
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
  const existingBill = transactions.find(t => t.isGroup && t.groupType === 'invoice' && t.cardDigits === bill.cartao && t.billMonth === bill.mesReferencia);
  if (existingBill && !confirm('Fatura do cartão ****' + bill.cartao + ' referente a ' + bill.mesReferencia + ' já foi importada. Importar novamente?')) return;
  const children = bill.transacoes.map(t => ({
    date: t.date || bill.mesReferencia + '-01',
    name: t.name || '—',
    cat: Object.keys(CATEGORIES).find(c => c === t.category) || 'Outros',
    val: roundCents(-(parseFloat(t.value) || 0)),
    method: 'Crédito',
    icon: catIcon(t.category),
    color: catColor(t.category),
    type: 'despesa'
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
    isGroup: true,
    groupType: 'invoice',
    groupMeta: {
      dueDate: bill.vencimento,
      billMonth: bill.mesReferencia,
      cardDigits: bill.cartao
    },
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

// === CONTRACHEQUE: preview, edição e salvamento ===

function renderPayslipPreview() {
  if (!_pendingPayslip) return;
  const p = _pendingPayslip;
  const totals = calcPayslipTotals(p.lancamentos);
  const mesLabel = p.competencia ? p.competencia.split('-').reverse().join('/') : '';
  const empLabel = p.empregador || '—';

  document.getElementById('importedTxSection').style.display = 'block';
  document.getElementById('importedTxSection').innerHTML = `
    <div class="divider"></div>
    <div class="card" style="border-left:4px solid var(--accent3);margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-size:16px;font-weight:600">💼 Contracheque — ${esc(empLabel)}</div>
          <div style="font-size:13px;color:var(--text2);margin-top:4px">Competência: <strong>${esc(mesLabel)}</strong></div>
        </div>
        <div style="text-align:right;display:flex;flex-direction:column;gap:2px">
          <div style="font-size:12px;color:var(--text3)">Bruto: <span style="color:var(--accent3)">R$ ${totals.bruto.toFixed(2).replace('.', ',')}</span></div>
          <div style="font-size:12px;color:var(--text3)">Descontos: <span style="color:var(--danger)">R$ ${totals.descontos.toFixed(2).replace('.', ',')}</span></div>
          <div style="font-size:20px;font-weight:600;color:var(--accent3);margin-top:4px">Líquido R$ ${totals.liquido.toFixed(2).replace('.', ',')}</div>
          <div style="font-size:12px;color:var(--text3)">${p.lancamentos.length} lançamentos</div>
        </div>
      </div>
    </div>
    <div class="card-header" style="margin-bottom:12px">
      <div style="font-size:14px;font-weight:500">Detalhamento do Contracheque</div>
      <button class="btn btn-success" onclick="salvarContracheque()">Salvar Contracheque</button>
    </div>
    <div class="card">
      <table class="data-table"><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Ação</th></tr></thead>
      <tbody id="payslipPreviewTbody">${p.lancamentos.map((l, i) => {
        const isReceita = l.type === 'receita';
        const icon = catIcon(l.category || 'Outros');
        const valColor = isReceita ? 'var(--accent3)' : 'var(--danger)';
        const sign = isReceita ? '+' : '-';
        return `<tr data-payslip-idx="${i}">
          <td>${esc(l.date || '—')}</td>
          <td>${esc(icon)} ${esc(l.name || '—')}</td>
          <td><span class="badge badge-blue">${esc(l.category || 'Outros')}</span></td>
          <td style="color:${valColor};font-weight:500">${sign} R$ ${(parseFloat(l.value) || 0).toFixed(2).replace('.', ',')}</td>
          <td><button class="btn btn-ghost" style="font-size:11px;padding:3px 8px" onclick="removePayslipItem(${i})" title="Remover">✕</button></td>
        </tr>`;
      }).join('')}</tbody></table>
    </div>`;

  const res = document.getElementById('analiseResult');
  if (res) {
    res.innerHTML = `<div style="padding:20px;text-align:center"><div style="font-size:48px;margin-bottom:8px">💼</div><div style="font-size:15px;margin-bottom:6px">Contracheque detectado!</div><div style="font-size:13px;color:var(--text3)">${p.lancamentos.length} lançamentos · Líquido R$ ${totals.liquido.toFixed(2).replace('.', ',')}</div></div>`;
  }
}

function removePayslipItem(idx) {
  if (!_pendingPayslip) return;
  _pendingPayslip.lancamentos.splice(idx, 1);
  const totals = calcPayslipTotals(_pendingPayslip.lancamentos);
  _pendingPayslip.bruto = totals.bruto;
  _pendingPayslip.liquido = totals.liquido;
  if (_pendingPayslip.lancamentos.length === 0) {
    _pendingPayslip = null;
    const section = document.getElementById('importedTxSection');
    if (section) { section.style.display = 'none'; section.innerHTML = ''; }
    const res = document.getElementById('analiseResult');
    if (res) res.innerHTML = '<div style="text-align:center;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">🤖</div><div style="font-size:15px;margin-bottom:6px">Aguardando documento</div><div style="font-size:13px">Faça upload ou cole seu extrato para que a IA analise e classifique.</div></div>';
    return;
  }
  renderPayslipPreview();
}

function salvarContracheque() {
  if (!_pendingPayslip || _pendingPayslip.lancamentos.length === 0) {
    alert('Nenhum lançamento no contracheque!');
    return;
  }
  const p = _pendingPayslip;
  const existing = transactions.find(t =>
    t.isGroup &&
    t.groupType === 'payslip' &&
    t.groupMeta &&
    t.groupMeta.competencia === p.competencia &&
    t.groupMeta.empregador === p.empregador
  );
  if (existing) {
    const empLabel = p.empregador || '(sem empregador)';
    const mesLabel = p.competencia ? p.competencia.split('-').reverse().join('/') : '(sem competência)';
    if (!confirm(`Contracheque de ${empLabel} referente a ${mesLabel} já foi importado. Importar novamente?`)) return;
  }

  const parentTx = buildPayslipTransaction(p);
  if (!parentTx) { alert('Erro ao montar contracheque!'); return; }

  transactions.unshift(parentTx);
  _pendingPayslip = null;
  updateBudgetFromTransactions();
  refreshAll();
  document.getElementById('pasteArea').value = '';
  document.getElementById('analiseResult').innerHTML = '<div style="text-align:center;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">🤖</div><div style="font-size:15px;margin-bottom:6px">Aguardando documento</div><div style="font-size:13px">Faça upload ou cole seu extrato para que a IA analise e classifique.</div></div>';
  document.getElementById('importedTxSection').style.display = 'none';
  document.getElementById('importedTxSection').innerHTML = '';
  alert(`Contracheque salvo com ${parentTx.children.length} lançamentos!`);
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
