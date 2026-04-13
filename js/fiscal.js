// ========================================
// FISCAL.JS - Módulo Planejamento Médica (PJ-PF)
// Carnê-Leão, Livro Caixa, PGBL, Projeção DIRPF
// Base legal: Lei 15.270/2025, Portaria MPS/MF 13/2026,
//             Decreto 12.797/2025
// ========================================

// ============================================================
// 1. ESTADO GLOBAL (persistido no user_data blob)
// ============================================================

let planejamentoMedica = null;

// ============================================================
// 2. CATEGORIAS MÉDICAS (dedutíveis em Livro Caixa)
// ============================================================

const CATEGORIAS_MEDICAS = {
  'CRM — Anuidade': {
    icon: '🩺', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Anuidade obrigatória do conselho para exercer a profissão médica.' }
  },
  'Curso/Congresso Médico': {
    icon: '🎓', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Capacitação e atualização profissional (presencial ou online).' }
  },
  'Seguro RC Profissional': {
    icon: '🛡️', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Seguro de responsabilidade civil específico para médicos.' }
  },
  'Material Médico / EPI': {
    icon: '🧰', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Estetoscópio, oxímetro, jaleco, EPIs e afins.' }
  },
  'Livros / Assinaturas Técnicas': {
    icon: '📚', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'UpToDate, revistas médicas, livros de conduta.' }
  },
  'Celular Profissional': {
    icon: '📱', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 0.5, proporcional: true,
              criterio: 'Proporcional ao uso profissional. Documentar base de rateio.' }
  },
  'Transporte p/ Plantão': {
    icon: '🚗', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Combustível, pedágio, estacionamento e transporte para plantão.' }
  },
  'Aluguel de Consultório': {
    icon: '🏥', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Aluguel mensal de espaço para atendimento.' }
  },
  'Honorários de Contador': {
    icon: '🧾', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Honorários do contador (quando contratado).' }
  },
  'Software / Prontuário': {
    icon: '💻', color: '#0ea5e9', _medica: true,
    fiscal: { dedutivelLC: true, fatorPadrao: 1.0, proporcional: false,
              criterio: 'Prontuário eletrônico, software clínico, UpToDate.' }
  },
};

// ============================================================
// 3. PARÂMETROS FISCAIS 2026 (fallback local — Supabase-first)
// ============================================================

const PARAMETROS_FISCAIS_FALLBACK = {
  tabela_irpf_mensal: {
    vigencia: '2026-01-01',
    faixas: [
      { ate: 2428.80, aliquota: 0.000, deducao:   0.00 },
      { ate: 2826.65, aliquota: 0.075, deducao: 182.16 },
      { ate: 3751.05, aliquota: 0.150, deducao: 394.16 },
      { ate: 4664.68, aliquota: 0.225, deducao: 675.49 },
      { ate: null,    aliquota: 0.275, deducao: 908.73 },
    ],
    descontoSimplificadoMensal: 607.20,
  },
  tabela_irpf_anual: {
    vigencia: '2026-01-01',
    faixas: [
      { ate: 29145.60, aliquota: 0.000, deducao:     0.00 },
      { ate: 33919.80, aliquota: 0.075, deducao:  2185.92 },
      { ate: 45012.60, aliquota: 0.150, deducao:  4729.91 },
      { ate: 55976.16, aliquota: 0.225, deducao:  8105.85 },
      { ate: null,     aliquota: 0.275, deducao: 10904.66 },
    ],
    descontoSimplificadoAnualLimite: 17640.00,
  },
  redutor_irpf_lei_15270_mensal: {
    vigencia: '2026-01-01',
    faixas: [
      { rendaAte: 5000.00, modo: 'fixo', redutor: 312.89 },
      { rendaAte: 7350.00, modo: 'formula_linear', formula: { a: 978.62, b: 0.133145 } },
      { rendaAte: null, modo: 'nenhum', redutor: 0 },
    ],
  },
  redutor_irpf_lei_15270_anual: {
    vigencia: '2026-01-01',
    faixas: [
      { rendaAte: 60000.00, modo: 'fixo', redutor: 2694.15 },
      { rendaAte: 88200.00, modo: 'formula_linear', formula: { a: 8429.73, b: 0.095575 } },
      { rendaAte: null, modo: 'nenhum', redutor: 0 },
    ],
  },
  tetoInss: 8475.55,
  salarioMinimo: 1621.00,
  deducaoDependenteMensal: 189.59,
  deducaoDependenteAnual: 2275.08,
  limitePgblPct: 0.12,
};

// Cache da consulta a Supabase parametros_fiscais
let _cacheParametrosFiscais = null;
let _cacheParametrosFiscaisPromise = null;

async function loadParametrosFiscais() {
  if (_cacheParametrosFiscais) return _cacheParametrosFiscais;
  if (_cacheParametrosFiscaisPromise) return _cacheParametrosFiscaisPromise;

  _cacheParametrosFiscaisPromise = (async () => {
    try {
      const client = (typeof getSupabaseClient === 'function') ? getSupabaseClient() : null;
      if (client && typeof _currentUser !== 'undefined' && _currentUser) {
        const hoje = new Date().toISOString().split('T')[0];
        const { data, error } = await client
          .from('parametros_fiscais')
          .select('chave, valor_json, vigencia_inicio, vigencia_fim')
          .lte('vigencia_inicio', hoje);
        if (!error && data && data.length > 0) {
          const params = JSON.parse(JSON.stringify(PARAMETROS_FISCAIS_FALLBACK));
          // Pega a linha mais recente vigente para cada chave
          const porChave = {};
          data.forEach(row => {
            if (row.vigencia_fim && row.vigencia_fim < hoje) return;
            if (!porChave[row.chave] || row.vigencia_inicio > porChave[row.chave].vigencia_inicio) {
              porChave[row.chave] = row;
            }
          });
          Object.entries(porChave).forEach(([chave, row]) => {
            params[chave] = row.valor_json;
          });
          _cacheParametrosFiscais = params;
          return params;
        }
      }
    } catch (e) {
      console.warn('loadParametrosFiscais — usando fallback local:', e && e.message);
    }
    _cacheParametrosFiscais = PARAMETROS_FISCAIS_FALLBACK;
    return PARAMETROS_FISCAIS_FALLBACK;
  })();
  return _cacheParametrosFiscaisPromise;
}

// ============================================================
// 4. FUNÇÕES PURAS DE CÁLCULO FISCAL
// ============================================================

function aplicaTabelaProgressiva(base, tabela) {
  if (!tabela || !tabela.faixas) return 0;
  if (base <= 0) return 0;
  for (const faixa of tabela.faixas) {
    if (faixa.ate === null || base <= faixa.ate) {
      return roundCents(Math.max(0, base * faixa.aliquota - faixa.deducao));
    }
  }
  return 0;
}

function calcularRedutorLei15270(bruto, redutor) {
  if (!redutor || !redutor.faixas) return { valor: 0, faixa: 'nenhum' };
  if (bruto <= 0) return { valor: 0, faixa: 'nenhum' };
  for (const faixa of redutor.faixas) {
    if (faixa.rendaAte === null || bruto <= faixa.rendaAte) {
      if (faixa.modo === 'fixo') {
        return { valor: roundCents(faixa.redutor), faixa: 'fixo' };
      }
      if (faixa.modo === 'formula_linear') {
        const v = faixa.formula.a - faixa.formula.b * bruto;
        return { valor: roundCents(Math.max(0, v)), faixa: 'linear' };
      }
      return { valor: 0, faixa: 'nenhum' };
    }
  }
  return { valor: 0, faixa: 'nenhum' };
}

function calcularCarneLeaoMes(input) {
  const params = input.parametros || PARAMETROS_FISCAIS_FALLBACK;
  const bruto = roundCents(input.rendimentosPfMes || 0);
  const lcMes = roundCents(input.livroCaixaMes || 0);
  const carryIn = roundCents(input.carryForwardIn || 0);
  const aplicarRedutor = input.aplicarRedutor !== false;

  const lcDisponivel = roundCents(lcMes + carryIn);
  const lcUtilizado = roundCents(Math.min(lcDisponivel, bruto));
  const carryForwardOut = roundCents(lcDisponivel - lcUtilizado);
  const baseCalculo = roundCents(bruto - lcUtilizado);

  const impostoTabela = aplicaTabelaProgressiva(baseCalculo, params.tabela_irpf_mensal);

  let redutorInfo = { valor: 0, faixa: 'nenhum' };
  if (aplicarRedutor) {
    redutorInfo = calcularRedutorLei15270(bruto, params.redutor_irpf_lei_15270_mensal);
  }
  const redutorAplicado = roundCents(Math.min(redutorInfo.valor, impostoTabela));
  const impostoFinal = roundCents(Math.max(0, impostoTabela - redutorAplicado));

  return {
    competencia: input.competencia || null,
    bruto, lcUtilizado, carryForwardOut, baseCalculo,
    impostoTabela, redutorAplicado, impostoFinal,
    faixaRedutor: redutorInfo.faixa,
  };
}

function calcularProjecaoDIRPF(input) {
  const params = input.parametros || PARAMETROS_FISCAIS_FALLBACK;
  const brutoAnual = roundCents(input.brutoAnual || 0);
  const inssPagoAnual = roundCents(input.inssPagoAnual || 0);
  const livroCaixaAnual = roundCents(input.livroCaixaAnual || 0);
  const pgblAportadoAnual = roundCents(input.pgblAportadoAnual || 0);
  const dependentes = parseInt(input.dependentes || 0);
  const outrasDeducoes = roundCents(input.outrasDeducoes || 0);
  const irrfPago = roundCents(input.irrfPagoAnual || 0);
  const carneLeaoPago = roundCents(input.carneLeaoPagoAnual || 0);
  const aplicarRedutor = input.aplicarRedutor !== false;

  const limitePgbl = roundCents(brutoAnual * (params.limitePgblPct || 0.12));
  const pgblDedutivel = roundCents(Math.min(pgblAportadoAnual, limitePgbl));
  const deducaoDependentes = roundCents(dependentes * (params.deducaoDependenteAnual || 2275.08));

  const baseCalculo = roundCents(Math.max(0,
    brutoAnual - inssPagoAnual - livroCaixaAnual - pgblDedutivel - deducaoDependentes - outrasDeducoes
  ));

  const impostoTabela = aplicaTabelaProgressiva(baseCalculo, params.tabela_irpf_anual);

  let redutorInfo = { valor: 0, faixa: 'nenhum' };
  if (aplicarRedutor) {
    redutorInfo = calcularRedutorLei15270(brutoAnual, params.redutor_irpf_lei_15270_anual);
  }
  const redutorAplicado = roundCents(Math.min(redutorInfo.valor, impostoTabela));
  const impostoDevido = roundCents(Math.max(0, impostoTabela - redutorAplicado));

  const totalPago = roundCents(irrfPago + carneLeaoPago);
  const ajuste = roundCents(impostoDevido - totalPago); // + = a pagar; - = restituir

  return {
    brutoAnual, inssPagoAnual, livroCaixaAnual,
    pgblAportadoAnual, pgblDedutivel, limitePgbl,
    deducaoDependentes, baseCalculo,
    impostoTabela, redutorAplicado, impostoDevido,
    irrfPago, carneLeaoPago, totalPago,
    ajuste, faixaRedutor: redutorInfo.faixa,
  };
}

// ============================================================
// 5. BOOTSTRAP E PREFERÊNCIAS
// ============================================================

function pmDefaults() {
  return {
    bootstrap: true,
    ativado: true,
    vinculosRenda: [],
    carneLeao: [],
    reservaFiscal: [],
    aportesPGBL: [],
    projecaoDIRPF: null,
    preferencias: {
      aplicarRedutorNoCarneLeao: true,
      percentualReservaFiscal: 0.275,
      aportePgblAlvoMensal: 0,
      dependentes: 0,
    },
  };
}

function ensurePlanejamentoMedicaState() {
  if (!planejamentoMedica) planejamentoMedica = {};
  if (!planejamentoMedica.bootstrap) Object.assign(planejamentoMedica, pmDefaults());
  if (!planejamentoMedica.preferencias) planejamentoMedica.preferencias = pmDefaults().preferencias;
  ['vinculosRenda', 'carneLeao', 'reservaFiscal', 'aportesPGBL'].forEach(k => {
    if (!Array.isArray(planejamentoMedica[k])) planejamentoMedica[k] = [];
  });
  return planejamentoMedica;
}

function ativarPlanejamentoMedica() {
  const pm = ensurePlanejamentoMedicaState();
  pm.ativado = true;
  // Injeta categorias médicas no dict global
  Object.entries(CATEGORIAS_MEDICAS).forEach(([nome, def]) => {
    if (!CATEGORIES[nome]) CATEGORIES[nome] = def;
  });
  if (typeof rebuildBudgetData === 'function') rebuildBudgetData();
  saveToLocalStorage();
  if (typeof refreshAll === 'function') refreshAll();
}

function desativarPlanejamentoMedica() {
  if (planejamentoMedica) planejamentoMedica.ativado = false;
  saveToLocalStorage();
  if (typeof refreshAll === 'function') refreshAll();
}

function isPlanejamentoMedicaAtivo() {
  return !!(planejamentoMedica && planejamentoMedica.ativado);
}

// Injeta categorias médicas no CATEGORIES quando o módulo já foi ativado
// (chamado no bootstrap da aplicação)
function pmRestoreCategorias() {
  if (!isPlanejamentoMedicaAtivo()) return;
  Object.entries(CATEGORIAS_MEDICAS).forEach(([nome, def]) => {
    if (!CATEGORIES[nome]) CATEGORIES[nome] = def;
  });
}

// ============================================================
// 6. AGREGAÇÃO DE DADOS A PARTIR DE transactions[]
// ============================================================

function getTransacoesMedicasMes(monthKey) {
  if (!monthKey) monthKey = (new Date()).toISOString().slice(0, 7);
  const [ano, mes] = monthKey.split('-').map(Number);
  return transactions.filter(t => {
    if (!t.fiscal || t.fiscal.contexto !== 'medica_pf') return false;
    if (!t.date) return false;
    const d = new Date(t.date + 'T00:00:00');
    return d.getFullYear() === ano && d.getMonth() === (mes - 1);
  });
}

function getRendimentosPlantaoPfMes(monthKey) {
  return getTransacoesMedicasMes(monthKey)
    .filter(t => t.val > 0 && t.fiscal && t.fiscal.vinculoTipo === 'plantao_pf')
    .reduce((s, t) => s + roundCents(t.fiscal.valorBruto || t.val), 0);
}

function getDespesasLivroCaixaMes(monthKey) {
  return getTransacoesMedicasMes(monthKey)
    .filter(t => t.val < 0 && t.fiscal && t.fiscal.dedutivelLC)
    .reduce((s, t) => s + roundCents(t.fiscal.valorDedutivel || Math.abs(t.val)), 0);
}

function getCarryForwardDoMes(monthKey) {
  const [ano, mes] = monthKey.split('-').map(Number);
  const d = new Date(ano, mes - 2, 1);
  const mesAnterior = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const pm = ensurePlanejamentoMedicaState();
  const registro = pm.carneLeao.find(c => c.competencia === mesAnterior);
  return registro ? roundCents(registro.carryForwardOut || 0) : 0;
}

async function calcularCarneLeaoDoMes(monthKey) {
  const params = await loadParametrosFiscais();
  const pm = ensurePlanejamentoMedicaState();
  const rendimentosPfMes = getRendimentosPlantaoPfMes(monthKey);
  const livroCaixaMes = getDespesasLivroCaixaMes(monthKey);
  const carryForwardIn = getCarryForwardDoMes(monthKey);

  const resultado = calcularCarneLeaoMes({
    rendimentosPfMes, livroCaixaMes, carryForwardIn,
    competencia: monthKey,
    aplicarRedutor: pm.preferencias.aplicarRedutorNoCarneLeao !== false,
    parametros: params,
  });

  // Persiste histórico (upsert do mês)
  const idx = pm.carneLeao.findIndex(c => c.competencia === monthKey);
  const registro = {
    competencia: monthKey,
    bruto: resultado.bruto,
    livroCaixaMes: resultado.lcUtilizado,
    carryForwardIn,
    carryForwardOut: resultado.carryForwardOut,
    baseCalculo: resultado.baseCalculo,
    impostoTabela: resultado.impostoTabela,
    redutorAplicado: resultado.redutorAplicado,
    impostoFinal: resultado.impostoFinal,
    faixaRedutor: resultado.faixaRedutor,
    status: resultado.impostoFinal === 0 ? 'isento' : 'pendente',
    recalculadoEm: new Date().toISOString(),
  };
  if (idx >= 0) pm.carneLeao[idx] = registro;
  else pm.carneLeao.push(registro);

  return resultado;
}

async function calcularProjecaoDIRPFAno(ano) {
  const params = await loadParametrosFiscais();
  const pm = ensurePlanejamentoMedicaState();

  let brutoAnual = 0, inssPagoAnual = 0, irrfPagoAnual = 0, livroCaixaAnual = 0;
  transactions.forEach(t => {
    if (!t.fiscal || t.fiscal.contexto !== 'medica_pf') return;
    if (!t.date) return;
    const d = new Date(t.date + 'T00:00:00');
    if (d.getFullYear() !== ano) return;
    if (t.val > 0) {
      brutoAnual += roundCents(t.fiscal.valorBruto || t.val);
      inssPagoAnual += roundCents(t.fiscal.inssRetido || 0);
      irrfPagoAnual += roundCents(t.fiscal.irrfRetido || 0);
    } else if (t.val < 0 && t.fiscal.dedutivelLC) {
      livroCaixaAnual += roundCents(t.fiscal.valorDedutivel || Math.abs(t.val));
    }
  });

  const carneLeaoPagoAnual = pm.carneLeao
    .filter(c => c.competencia && c.competencia.startsWith(String(ano)) && c.status === 'pago')
    .reduce((s, c) => s + roundCents(c.valorPago || 0), 0);

  const pgblAportadoAnual = pm.aportesPGBL
    .filter(a => a.data && a.data.startsWith(String(ano)))
    .reduce((s, a) => s + roundCents(a.valor || 0), 0);

  const projecao = calcularProjecaoDIRPF({
    brutoAnual, inssPagoAnual, livroCaixaAnual, pgblAportadoAnual,
    dependentes: pm.preferencias.dependentes || 0,
    irrfPagoAnual, carneLeaoPagoAnual,
    aplicarRedutor: pm.preferencias.aplicarRedutorNoCarneLeao !== false,
    parametros: params,
  });
  projecao.ano = ano;
  projecao.recalculadoEm = new Date().toISOString();
  pm.projecaoDIRPF = projecao;
  return projecao;
}

// ============================================================
// 7. FORMATAÇÃO
// ============================================================

function pmFmtBRL(v) {
  if (v === null || v === undefined || isNaN(v)) return 'R$ 0,00';
  return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pmFormatMesExtenso(monthKey) {
  if (!monthKey) return '—';
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const [y, m] = monthKey.split('-').map(Number);
  return `${nomes[m - 1]}/${y}`;
}

// ============================================================
// 8. RENDER DA ABA PLANEJAMENTO MÉDICA
// ============================================================

let _pmSelectedMonth = null;

async function renderPlanejamentoMedica() {
  const root = document.getElementById('section-planejamentoMedica');
  if (!root) return;

  ensurePlanejamentoMedicaState();

  if (!isPlanejamentoMedicaAtivo()) {
    root.innerHTML = pmRenderOff();
    return;
  }

  const hoje = new Date();
  const monthKey = _pmSelectedMonth || `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  try {
    const cl = await calcularCarneLeaoDoMes(monthKey);
    const projecao = await calcularProjecaoDIRPFAno(hoje.getFullYear());

    root.innerHTML = `
      <div class="pm-header">
        <div class="month-tabs" id="pmMonthSelector">
          ${pmRenderMonthSelector(monthKey)}
        </div>
        <button class="btn btn-ghost" onclick="pmShowPreferencias()" style="font-size:11px;padding:5px 10px">⚙ Preferências</button>
      </div>
      <div class="grid-2">
        ${pmRenderBlocoCarneLeao(cl)}
        ${pmRenderBlocoImpostoFantasma(projecao, hoje)}
      </div>
      <div class="grid-2" style="margin-top:18px">
        ${pmRenderBlocoPGBL(projecao, planejamentoMedica, hoje)}
        ${pmRenderBlocoAtividade(monthKey)}
      </div>
      <div style="margin-top:18px">
        ${pmRenderBlocoAtalhos()}
      </div>
      <div class="alert alert-info" style="margin-top:18px;font-size:12px">
        📘 <b>Base legal:</b> cálculos seguem Lei 15.270/2025, tabela IRPF 2026, teto INSS R$ 8.475,55
        e Decreto 12.797/2025 (salário mínimo). Parâmetros fiscais versionados em
        <code>parametros_fiscais</code> (Supabase). Use esta projeção como apoio — valide com
        contador antes de tomar decisões.
      </div>
    `;

    saveToLocalStorage();
  } catch (e) {
    console.error('renderPlanejamentoMedica:', e);
    root.innerHTML = `<div class="alert alert-danger">Erro ao renderizar módulo: ${esc(e.message || e)}</div>`;
  }
}

function pmRenderOff() {
  return `
    <div class="card" style="max-width:720px;margin:40px auto;text-align:center">
      <div style="font-size:56px;margin-bottom:12px">🩺</div>
      <div class="card-title" style="margin-bottom:12px;font-size:18px">Planejamento Médica (PJ-PF)</div>
      <p style="color:var(--text2);font-size:14px;line-height:1.7;margin-bottom:20px;max-width:560px;margin-left:auto;margin-right:auto">
        Módulo de planejamento tributário para médicos e profissionais da saúde
        que recebem plantões como pessoa física. Inclui cálculo automático de
        <b>Carnê-Leão 2026</b> (com a nova Lei 15.270/2025), <b>Livro Caixa</b> digital,
        <b>reserva fiscal</b> automática, projeção da <b>DIRPF</b> e alertas de <b>PGBL</b>.
      </p>
      <div style="background:var(--bg3);border-radius:12px;padding:14px;margin:16px auto;max-width:520px;text-align:left;font-size:12px;color:var(--text2);line-height:1.6">
        <b>O que este módulo faz:</b><br>
        • Calcula o Carnê-Leão mensal aplicando o redutor da Lei 15.270/2025<br>
        • Mantém Livro Caixa digital com categorias pré-definidas<br>
        • Projeta o ajuste da DIRPF do ano seguinte em tempo real<br>
        • Recomenda reserva fiscal mês a mês<br>
        • Alerta sobre meta de aporte PGBL (12% da renda tributável)
      </div>
      <button class="btn btn-primary" onclick="ativarPlanejamentoMedica()" style="margin-top:8px">
        Ativar módulo
      </button>
      <p style="color:var(--text3);font-size:11px;margin-top:14px">
        Você pode desativar a qualquer momento. Seus dados não serão apagados.
      </p>
    </div>
  `;
}

function pmRenderMonthSelector(active) {
  const hoje = new Date();
  let html = '';
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = nomes[d.getMonth()];
    html += `<div class="month-tab ${key === active ? 'active' : ''}" onclick="pmSelectMonth('${key}')">${label}</div>`;
  }
  return html;
}

async function pmSelectMonth(key) {
  _pmSelectedMonth = key;
  await renderPlanejamentoMedica();
}

function pmRenderBlocoCarneLeao(cl) {
  let badge, badgeColor, badgeText;
  if (cl.bruto === 0) {
    badge = '—'; badgeColor = 'var(--text3)'; badgeText = 'Sem plantões no mês';
  } else if (cl.impostoFinal === 0 && cl.faixaRedutor === 'fixo') {
    badge = '✅'; badgeColor = 'var(--accent3)'; badgeText = 'Isento pelo Redutor';
  } else if (cl.impostoFinal === 0) {
    badge = '✅'; badgeColor = 'var(--accent3)'; badgeText = 'Zerado';
  } else if (cl.faixaRedutor === 'linear') {
    badge = '🟡'; badgeColor = 'var(--gold)'; badgeText = 'Redutor parcial';
  } else if (cl.faixaRedutor === 'nenhum') {
    badge = '🟠'; badgeColor = '#fb923c'; badgeText = 'Sem redutor (bruto > R$ 7.350)';
  } else {
    badge = '•'; badgeColor = 'var(--text3)'; badgeText = '';
  }

  return `
    <div class="card pm-bloco">
      <div class="card-header">
        <div class="card-title">🏦 Carnê-Leão — ${pmFormatMesExtenso(cl.competencia)}</div>
      </div>
      <div class="pm-valor-destaque" style="color:${cl.impostoFinal === 0 ? 'var(--accent3)' : 'var(--text)'}">
        ${pmFmtBRL(cl.impostoFinal)}
      </div>
      <div class="pm-badge" style="color:${badgeColor}">${badge} ${badgeText}</div>
      <div class="pm-stats">
        <div class="pm-stat"><span>Bruto (plantões PF)</span><b>${pmFmtBRL(cl.bruto)}</b></div>
        <div class="pm-stat"><span>Livro Caixa aplicado</span><b>${pmFmtBRL(cl.lcUtilizado)}</b></div>
        <div class="pm-stat"><span>Base de cálculo</span><b>${pmFmtBRL(cl.baseCalculo)}</b></div>
        <div class="pm-stat"><span>Imposto pela tabela</span><b>${pmFmtBRL(cl.impostoTabela)}</b></div>
        <div class="pm-stat"><span>Redutor Lei 15.270</span><b style="color:var(--accent3)">− ${pmFmtBRL(cl.redutorAplicado)}</b></div>
        ${cl.carryForwardOut > 0 ? `<div class="pm-stat"><span>Carry-forward p/ próximo mês</span><b>${pmFmtBRL(cl.carryForwardOut)}</b></div>` : ''}
      </div>
    </div>
  `;
}

function pmRenderBlocoImpostoFantasma(proj, hoje) {
  const ajuste = proj.ajuste || 0;
  const mesesRestantes = 12 - hoje.getMonth();
  const reservaRecomendada = ajuste > 0 ? roundCents(ajuste / Math.max(1, mesesRestantes)) : 0;
  const cor = ajuste > 0 ? 'var(--danger)' : (ajuste < 0 ? 'var(--accent3)' : 'var(--text)');
  const texto = ajuste > 0 ? 'a PAGAR' : (ajuste < 0 ? 'de RESTITUIÇÃO' : 'neutro');
  const pct = proj.brutoAnual > 0 ? ((proj.impostoDevido / proj.brutoAnual) * 100).toFixed(1) : '0.0';

  return `
    <div class="card pm-bloco">
      <div class="card-header">
        <div class="card-title">⚠️ Ajuste DIRPF ${hoje.getFullYear() + 1}</div>
      </div>
      <div class="pm-valor-destaque" style="color:${cor}">
        ${pmFmtBRL(Math.abs(ajuste))}
      </div>
      <div class="pm-badge" style="color:${cor}">${texto}</div>
      <div class="pm-stats">
        <div class="pm-stat"><span>Bruto projetado ${hoje.getFullYear()}</span><b>${pmFmtBRL(proj.brutoAnual)}</b></div>
        <div class="pm-stat"><span>Base de cálculo anual</span><b>${pmFmtBRL(proj.baseCalculo)}</b></div>
        <div class="pm-stat"><span>Imposto devido no ano</span><b>${pmFmtBRL(proj.impostoDevido)}</b></div>
        <div class="pm-stat"><span>Já pago (IRRF + C. Leão)</span><b>${pmFmtBRL(proj.totalPago)}</b></div>
        <div class="pm-stat"><span>Carga efetiva sobre bruto</span><b>${pct}%</b></div>
      </div>
      ${ajuste > 0 ? `
        <div class="alert alert-warn" style="margin-top:14px;font-size:12px;line-height:1.5">
          💰 <b>Reserva fiscal deste mês:</b> ${pmFmtBRL(reservaRecomendada)}<br>
          <span style="color:var(--text3)">${pmFmtBRL(ajuste)} ÷ ${mesesRestantes} ${mesesRestantes === 1 ? 'mês' : 'meses'} restante(s)</span>
        </div>
      ` : ''}
    </div>
  `;
}

function pmRenderBlocoPGBL(proj, pm, hoje) {
  const aportado = proj.pgblAportadoAnual || 0;
  const limite = proj.limitePgbl || 0;
  const pct = limite > 0 ? Math.min(100, Math.round((aportado / limite) * 100)) : 0;
  const falta = roundCents(Math.max(0, limite - aportado));
  const mesesRestantes = 12 - hoje.getMonth();
  const mensal = mesesRestantes > 0 ? roundCents(falta / mesesRestantes) : 0;
  const economia = roundCents(aportado * 0.275);
  const ano = hoje.getFullYear();

  return `
    <div class="card pm-bloco">
      <div class="card-header">
        <div class="card-title">🎯 Meta PGBL ${ano}</div>
      </div>
      ${limite === 0 ? `
        <div style="color:var(--text3);font-size:13px;margin:14px 0;padding:14px;background:var(--bg3);border-radius:8px">
          Cadastre seus plantões/rendimentos médicos para calcular a meta de 12% da renda tributável.
        </div>
      ` : `
        <div class="pm-valor-destaque" style="color:var(--accent2);font-size:24px">${pmFmtBRL(aportado)}</div>
        <div class="pm-badge" style="color:var(--text3)">${pct}% da meta (${pmFmtBRL(limite)})</div>
        <div class="pm-pgbl-bar" style="margin:14px 0">
          <div class="pm-pgbl-fill" style="width:${pct}%"></div>
        </div>
        <div class="pm-stats">
          <div class="pm-stat"><span>Falta aportar até dez/${ano}</span><b>${pmFmtBRL(falta)}</b></div>
          <div class="pm-stat"><span>Mensal para atingir meta</span><b>${pmFmtBRL(mensal)}</b></div>
          <div class="pm-stat"><span>💡 Economia IR (27,5% × aportado)</span><b style="color:var(--accent3)">${pmFmtBRL(economia)}</b></div>
        </div>
      `}
      <button class="btn btn-ghost" onclick="pmOpenAporteForm()" style="width:100%;margin-top:12px">
        + Registrar aporte PGBL
      </button>
    </div>
  `;
}

function pmRenderBlocoAtividade(monthKey) {
  const txs = getTransacoesMedicasMes(monthKey);
  const rendimentos = txs.filter(t => t.val > 0);
  const despesas = txs.filter(t => t.val < 0);
  const totalRend = rendimentos.reduce((s, t) => s + t.val, 0);
  const totalDesp = despesas.reduce((s, t) => s + Math.abs(t.val), 0);

  return `
    <div class="card pm-bloco">
      <div class="card-header">
        <div class="card-title">📋 Atividade — ${pmFormatMesExtenso(monthKey)}</div>
      </div>
      <div class="pm-stats" style="margin-top:8px">
        <div class="pm-stat"><span>Plantões / rendimentos médicos</span><b>${rendimentos.length} lanç. · ${pmFmtBRL(totalRend)}</b></div>
        <div class="pm-stat"><span>Despesas Livro Caixa</span><b>${despesas.length} lanç. · ${pmFmtBRL(totalDesp)}</b></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="pmOpenNovoPlantao()" style="flex:1;min-width:120px">+ Plantão</button>
        <button class="btn btn-ghost" onclick="pmOpenNovaDespesaLC()" style="flex:1;min-width:120px">+ Despesa LC</button>
      </div>
    </div>
  `;
}

function pmRenderBlocoAtalhos() {
  return `
    <div class="card">
      <div class="card-title" style="margin-bottom:12px">🩺 Atalhos</div>
      <div class="pm-atalhos-list">
        <div class="pm-atalho" onclick="pmShowHistoricoCarneLeao()">🏦 Histórico Carnê-Leão</div>
        <div class="pm-atalho" onclick="pmShowVinculos()">💼 Vínculos e fontes</div>
        <div class="pm-atalho" onclick="pmShowDeclaracaoInss()">📄 Declaração múltiplas fontes INSS</div>
        <div class="pm-atalho" onclick="pmShowRelatorioLC()">📚 Relatório Livro Caixa anual</div>
        <div class="pm-atalho" onclick="pmShowPreferencias()">⚙️ Preferências do módulo</div>
        <div class="pm-atalho" onclick="desativarPlanejamentoMedica()">🔌 Desativar módulo</div>
      </div>
    </div>
  `;
}

// ============================================================
// 9. FORMULÁRIOS — PLANTÃO E DESPESA LC
// ============================================================

function pmOpenNovoPlantao() {
  const pm = ensurePlanejamentoMedicaState();
  const modal = document.getElementById('pmPlantaoModal');
  if (!modal) return;
  document.getElementById('pmPlantaoDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('pmPlantaoValor').value = '';
  document.getElementById('pmPlantaoDescricao').value = '';
  const sel = document.getElementById('pmPlantaoVinculo');
  const opts = pm.vinculosRenda.filter(v => v.ativo !== false && v.tipo === 'plantao_pf');
  if (opts.length === 0) {
    sel.innerHTML = '<option value="__novo__">+ Cadastrar nova fonte pagadora</option>';
  } else {
    sel.innerHTML = opts.map(v => `<option value="${esc(v.id)}">${esc(v.nome)}</option>`).join('')
      + '<option value="__novo__">+ Nova fonte pagadora</option>';
  }
  modal.classList.add('show');
}

function pmClosePlantaoModal() {
  const modal = document.getElementById('pmPlantaoModal');
  if (modal) modal.classList.remove('show');
}

function pmSavePlantao() {
  const pm = ensurePlanejamentoMedicaState();
  const date = document.getElementById('pmPlantaoDate').value;
  const valor = parseFloat(document.getElementById('pmPlantaoValor').value);
  const nome = document.getElementById('pmPlantaoDescricao').value.trim() || 'Plantão';
  let vinculoId = document.getElementById('pmPlantaoVinculo').value;

  if (!date || !valor || valor <= 0) {
    alert('Preencha data e valor corretamente.');
    return;
  }

  if (vinculoId === '__novo__') {
    const nomeNovo = prompt('Nome da fonte pagadora (hospital, clínica, cooperativa, paciente):');
    if (!nomeNovo || !nomeNovo.trim()) return;
    const novo = {
      id: 'v_' + Date.now(),
      nome: nomeNovo.trim(),
      tipo: 'plantao_pf',
      cnpjCpfFonte: '',
      retemIrrf: false,
      retemInss: false,
      tetoInssAtingido: true,
      ativo: true,
    };
    pm.vinculosRenda.push(novo);
    vinculoId = novo.id;
  }

  const vinculo = pm.vinculosRenda.find(v => v.id === vinculoId) || { id: null, nome: 'Fonte PF', tipo: 'plantao_pf' };

  const tx = {
    date,
    name: nome + (vinculo.nome ? ' — ' + vinculo.nome : ''),
    cat: 'Receita',
    val: roundCents(Math.abs(valor)),
    method: 'PIX',
    icon: '🩺',
    color: '#0ea5e9',
    fiscal: {
      contexto: 'medica_pf',
      vinculoId: vinculo.id,
      vinculoNome: vinculo.nome,
      vinculoTipo: 'plantao_pf',
      valorBruto: roundCents(Math.abs(valor)),
      irrfRetido: 0,
      inssRetido: 0,
      competencia: date.slice(0, 7),
    },
  };

  transactions.unshift(tx);
  if (typeof updateBudgetFromTransactions === 'function') updateBudgetFromTransactions();
  saveToLocalStorage();
  if (typeof refreshAll === 'function') refreshAll();
  pmClosePlantaoModal();
}

function pmOpenNovaDespesaLC() {
  const modal = document.getElementById('pmDespesaModal');
  if (!modal) return;
  document.getElementById('pmDespesaDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('pmDespesaValor').value = '';
  document.getElementById('pmDespesaDescricao').value = '';
  const sel = document.getElementById('pmDespesaCategoria');
  const medicas = Object.entries(CATEGORIES).filter(([k, v]) => v && v._medica && v.fiscal && v.fiscal.dedutivelLC);
  if (medicas.length === 0) {
    // Garante que categorias foram injetadas
    pmRestoreCategorias();
  }
  const lista = Object.entries(CATEGORIES).filter(([k, v]) => v && v._medica && v.fiscal && v.fiscal.dedutivelLC);
  sel.innerHTML = lista.map(([k, v]) => {
    const proporcional = v.fiscal.proporcional ? ' (' + Math.round(v.fiscal.fatorPadrao * 100) + '%)' : '';
    return `<option value="${esc(k)}">${esc(v.icon)} ${esc(k)}${proporcional}</option>`;
  }).join('');
  modal.classList.add('show');
}

function pmCloseDespesaModal() {
  const modal = document.getElementById('pmDespesaModal');
  if (modal) modal.classList.remove('show');
}

function pmSaveDespesaLC() {
  const date = document.getElementById('pmDespesaDate').value;
  const valor = parseFloat(document.getElementById('pmDespesaValor').value);
  const nome = document.getElementById('pmDespesaDescricao').value.trim();
  const cat = document.getElementById('pmDespesaCategoria').value;

  if (!date || !valor || valor <= 0 || !cat || !nome) {
    alert('Preencha todos os campos.');
    return;
  }

  const catDef = CATEGORIES[cat] || {};
  const fator = (catDef.fiscal && catDef.fiscal.fatorPadrao) || 1;
  const valorDedutivel = roundCents(Math.abs(valor) * fator);

  const tx = {
    date,
    name: nome,
    cat,
    val: roundCents(-Math.abs(valor)),
    method: 'Débito',
    icon: catDef.icon || '🩺',
    color: catDef.color || '#0ea5e9',
    fiscal: {
      contexto: 'medica_pf',
      dedutivelLC: true,
      fatorAplicado: fator,
      valorDedutivel,
      competencia: date.slice(0, 7),
    },
  };

  transactions.unshift(tx);
  if (typeof updateBudgetFromTransactions === 'function') updateBudgetFromTransactions();
  saveToLocalStorage();
  if (typeof refreshAll === 'function') refreshAll();
  pmCloseDespesaModal();
}

// ============================================================
// 10. AÇÕES SECUNDÁRIAS (aportes, atalhos)
// ============================================================

function pmOpenAporteForm() {
  const pm = ensurePlanejamentoMedicaState();
  const dataStr = prompt('Data do aporte (AAAA-MM-DD):', new Date().toISOString().split('T')[0]);
  if (!dataStr) return;
  const valorStr = prompt('Valor do aporte (R$):');
  if (!valorStr) return;
  const valor = parseFloat(String(valorStr).replace(',', '.'));
  if (!valor || valor <= 0) { alert('Valor inválido.'); return; }
  const instituicao = prompt('Instituição (opcional):') || '';

  pm.aportesPGBL.push({
    id: 'p_' + Date.now(),
    data: dataStr,
    valor: roundCents(valor),
    instituicao,
    plano: '',
    modeloTributacao: 'regressiva',
  });
  saveToLocalStorage();
  renderPlanejamentoMedica();
}

function pmShowHistoricoCarneLeao() {
  const pm = ensurePlanejamentoMedicaState();
  if (pm.carneLeao.length === 0) {
    alert('Nenhum mês calculado ainda. Lance um plantão para gerar o histórico.');
    return;
  }
  const linhas = pm.carneLeao
    .slice()
    .sort((a, b) => (b.competencia || '').localeCompare(a.competencia || ''))
    .slice(0, 12)
    .map(c => `${pmFormatMesExtenso(c.competencia)}: bruto ${pmFmtBRL(c.bruto)} → imposto ${pmFmtBRL(c.impostoFinal)} (${c.status})`)
    .join('\n');
  alert('Histórico Carnê-Leão (últimos 12 meses):\n\n' + linhas);
}

function pmShowVinculos() {
  const pm = ensurePlanejamentoMedicaState();
  if (pm.vinculosRenda.length === 0) {
    alert('Nenhum vínculo cadastrado. Eles são criados automaticamente ao lançar o primeiro plantão com nova fonte.');
    return;
  }
  const linhas = pm.vinculosRenda.map(v => `• ${v.nome} (${v.tipo})${v.ativo === false ? ' [arquivado]' : ''}`).join('\n');
  alert('Vínculos cadastrados:\n\n' + linhas);
}

function pmShowDeclaracaoInss() {
  const pm = ensurePlanejamentoMedicaState();
  const params = _cacheParametrosFiscais || PARAMETROS_FISCAIS_FALLBACK;
  const teto = params.tetoInss || 8475.55;
  const texto = `DECLARAÇÃO DE CONTRIBUIÇÃO AO REGIME GERAL DE PREVIDÊNCIA SOCIAL

Eu, [NOME COMPLETO], inscrito(a) no CPF nº [CPF], DECLARO para os devidos fins que já contribuo ao Regime Geral de Previdência Social (RGPS) sobre o teto máximo do salário-de-contribuição, vigente em ${new Date().getFullYear()} no valor de ${pmFmtBRL(teto)}, através do vínculo com [NOME DA FONTE PAGADORA PRINCIPAL].

Nos termos do art. 216, §26 do Decreto 3.048/1999, SOLICITO que Vossa Senhoria NÃO EFETUE a retenção de contribuição previdenciária (INSS) sobre os valores a mim pagos, uma vez que a soma dos descontos em todas as fontes pagadoras já atinge o limite máximo legal.

Comprometo-me a apresentar, quando solicitado, comprovante de rendimentos da fonte pagadora principal que demonstre o recolhimento integral ao teto.

[LOCAL], ____ de __________ de ${new Date().getFullYear()}.

______________________________________
Assinatura do(a) contribuinte`;

  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'declaracao-multiplas-fontes-inss.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pmShowRelatorioLC() {
  const ano = new Date().getFullYear();
  const porCategoria = {};
  let total = 0;
  transactions.forEach(t => {
    if (!t.fiscal || t.fiscal.contexto !== 'medica_pf' || !t.fiscal.dedutivelLC) return;
    if (!t.date || !t.date.startsWith(String(ano))) return;
    const v = roundCents(t.fiscal.valorDedutivel || Math.abs(t.val));
    porCategoria[t.cat] = (porCategoria[t.cat] || 0) + v;
    total += v;
  });

  if (total === 0) {
    alert(`Nenhuma despesa dedutível lançada em ${ano}.`);
    return;
  }
  const linhas = Object.entries(porCategoria)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${pmFmtBRL(v)}`)
    .join('\n');
  alert(`Relatório Livro Caixa ${ano}\n\n${linhas}\n\nTotal: ${pmFmtBRL(total)}`);
}

function pmShowPreferencias() {
  const pm = ensurePlanejamentoMedicaState();
  const atualRedutor = pm.preferencias.aplicarRedutorNoCarneLeao !== false;
  const novoRedutor = confirm(
    'Aplicar redutor Lei 15.270/2025 no cálculo do Carnê-Leão?\n\n' +
    'OK = SIM (default — segue a lei; pode zerar o imposto mensal)\n' +
    'Cancelar = NÃO (modo conservador — recolhe imposto todo mês, evita surpresa no ajuste)\n\n' +
    'Atual: ' + (atualRedutor ? 'SIM' : 'NÃO')
  );
  pm.preferencias.aplicarRedutorNoCarneLeao = novoRedutor;

  const deps = prompt('Número de dependentes na DIRPF (0 se nenhum):', String(pm.preferencias.dependentes || 0));
  if (deps !== null) pm.preferencias.dependentes = parseInt(deps) || 0;

  // Invalida cache de parâmetros para forçar reload no próximo cálculo
  _cacheParametrosFiscais = null;
  _cacheParametrosFiscaisPromise = null;

  saveToLocalStorage();
  renderPlanejamentoMedica();
}
