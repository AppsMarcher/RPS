const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const AREAS = [
  { id:'comercial',  nome:'COMERCIAL',        icon:'ti-chart-bar',         cor:'#378ADD' },
  { id:'industrial', nome:'INDUSTRIAL',       icon:'ti-building-factory',  cor:'#639922' },
  { id:'supply',     nome:'SUPPLY',           icon:'ti-truck',             cor:'#BA7517' },
  { id:'rh',         nome:'RECURSOS HUMANOS', icon:'ti-users',             cor:'#D4537E' },
  { id:'financeiro', nome:'FINANCEIRO',       icon:'ti-cash',              cor:'#7F77DD' },
  { id:'sac',        nome:'SAC . GARANTIAS',  icon:'ti-headset',           cor:'#378ADD' },
  { id:'engenharia', nome:'ENGENHARIA',       icon:'ti-tools',             cor:'#1D9E75' },
];

const INDICADORES_DEFAULT = {
  comercial:   [
    { id:'faturamento', label:'Faturamento' },
    { id:'nacional', label:'Nacional' },
    { id:'exportacao', label:'Exportação' },
    { id:'graneleiro', label:'Graneleiro' },
    { id:'pedidos_carteira', label:'Pedidos em carteira' },
    { id:'novos_clientes', label:'Novos clientes' },
    { id:'meta_atingida', label:'Meta atingida' },
  ],
  industrial:  ['Produção total','Eficiência OEE','Retrabalho','Paradas planejadas'],
  supply:      ['Nível de estoque','OTIF','Lead time médio','Custo de frete'],
  rh:          ['Headcount ativo','Absenteísmo','Horas extras','Treinamentos'],
  financeiro:  ['Receita líquida','DRE - EBITDA','Inadimplência','Fluxo de caixa'],
  sac:         ['Chamados abertos','Tempo médio resposta','NPS','Garantias acionadas'],
  engenharia:  ['Projetos em andamento','Horas de projeto','Homologações','Desvios técnicos'],
};

const UNIDADES = ['R$','%','h','un','dias','-'];

// Modos da coluna Mês (antigo Consolidado) — mesma lógica para Meta
const MES_MODOS = [
  { id:'soma',   icon:'ti-math-function',      label:'Soma das semanas'            },
  { id:'media',  icon:'ti-math-avg',           label:'Média das semanas'           },
  { id:'ultima', icon:'ti-arrow-bar-to-right', label:'Última semana preenchida'    },
  { id:'manual', icon:'ti-pencil',             label:'Valor digitado manualmente'  },
];

let state = {
  mesIdx:     new Date().getMonth(),
  ano:        new Date().getFullYear(),
  semanas:    ['S1','S2','S3','S4','S5'],
  focusIdx:   null,
  presentIdx: 0,
  columnWidths: {},
  sync: {
    enabled: false,
    dirty: false,
    status: 'offline',
    message: 'Supabase não configurado',
  },
  areas:      JSON.parse(JSON.stringify(AREAS)),
  indicadores: {},
  unidades:    {},
  dados:       {},
  dadosMes:    {},
  dadosMeta:   {},
  anexos:      {},
  modoMes:     {},
  modoMeta:    {},
};

let lbKey = null;
let lbLabel = '';
let lbImageIdx = 0;
let resizeState = null;
let supabaseClient = null;
let saveTimer = null;
let syncMessageTimer = null;

const COLUMN_WIDTH_DEFAULTS = {
  area: 620,
  S1: 110,
  S2: 110,
  S3: 110,
  S4: 110,
  S5: 110,
  mes: 120,
  meta: 120,
  var: 120,
};

const SUPABASE_TABLE = 'rps_snapshots';

const key        = (a,i,c)  => `${a}|${i}|${c}`;
const anexoKey   = (a,i,c)  => `anx:${a}|${i}|${c}`;
const modoMesK   = (a,i)    => `mes:${a}|${i}`;
const modoMetaK  = (a,i)    => `meta:${a}|${i}`;
const dadosMesK  = (a,i)    => `vmes:${a}|${i}`;
const dadosMetaK = (a,i)    => `vmeta:${a}|${i}`;

function slugifyLabel(label) {
  return String(label || 'indicador')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'indicador';
}

function normalizeIndicator(ind, idx = 0) {
  if (typeof ind === 'string') {
    return { id: `${slugifyLabel(ind)}_${idx}`, label: ind, parentId: null, aggregate: null, type: 'item' };
  }
  return {
    id: ind.id || `${slugifyLabel(ind.label)}_${idx}`,
    label: ind.label || 'Indicador',
    parentId: ind.parentId || null,
    aggregate: ind.aggregate || null,
    type: ind.type || 'item',
  };
}

function ensureAreaIndicators(areaId) {
  const current = state.indicadores[areaId] || [];
  state.indicadores[areaId] = current.map((ind, idx) => normalizeIndicator(ind, idx));
  return state.indicadores[areaId];
}

function getIndicators(areaId) {
  return ensureAreaIndicators(areaId);
}

function getIndicatorId(ind) {
  return typeof ind === 'string' ? slugifyLabel(ind) : ind.id;
}

function getIndicatorLabel(ind) {
  return typeof ind === 'string' ? ind : ind.label;
}

function isAggregateIndicator(ind) {
  return !!ind && ind.aggregate === 'sum-children';
}

function isSpacerIndicator(ind) {
  return !!ind && ind.type === 'spacer';
}

function getChildIndicators(areaId, parentId) {
  return getIndicators(areaId).filter(ind => ind.parentId === parentId);
}

function getColumnKeys() {
  return ['area', ...state.semanas, 'mes', 'meta', 'var'];
}

function ensureColumnWidths() {
  getColumnKeys().forEach(colKey => {
    if (!state.columnWidths[colKey]) {
      state.columnWidths[colKey] = COLUMN_WIDTH_DEFAULTS[colKey] || 110;
    }
  });
}

function saveColumnWidths() {
  try {
    localStorage.setItem('rps_column_widths', JSON.stringify(state.columnWidths));
  } catch (_) {}
}

function loadColumnWidths() {
  try {
    const raw = localStorage.getItem('rps_column_widths');
    if (raw) {
      state.columnWidths = { ...state.columnWidths, ...JSON.parse(raw) };
    }
  } catch (_) {}
  ensureColumnWidths();
}

function renderColgroup(targetId) {
  const colgroup = document.getElementById(targetId);
  if (!colgroup) return;
  ensureColumnWidths();
  colgroup.innerHTML = getColumnKeys()
    .map(colKey => `<col style="width:${state.columnWidths[colKey]}px">`)
    .join('');
}

function syncColumnWidths() {
  renderColgroup('main-colgroup');
  renderColgroup('present-colgroup');
}

function getPeriodoLabel() {
  return `${MESES[state.mesIdx]} ${state.ano}`;
}

function renderSyncStatus() {
  const badge = document.getElementById('sync-badge');
  const label = document.getElementById('sync-label');
  const saveBtn = document.getElementById('save-btn');
  const reloadBtn = document.getElementById('reload-btn');
  if (!badge || !label) return;

  badge.className = 'sync-badge';
  label.textContent = state.sync.message;

  if (state.sync.status === 'ready') badge.classList.add('is-ready');
  if (state.sync.status === 'dirty') badge.classList.add('is-dirty');
  if (state.sync.status === 'saving') badge.classList.add('is-saving');
  if (state.sync.status === 'error') badge.classList.add('is-error');

  const disabled = !state.sync.enabled || state.sync.status === 'saving';
  if (saveBtn) saveBtn.disabled = disabled;
  if (reloadBtn) reloadBtn.disabled = disabled;
}

function setSyncStatus(status, message, dirty = state.sync.dirty) {
  state.sync.status = status;
  state.sync.message = message;
  state.sync.dirty = dirty;
  renderSyncStatus();
}

function scheduleSyncMessageReset() {
  clearTimeout(syncMessageTimer);
  syncMessageTimer = setTimeout(() => {
    if (!state.sync.enabled) {
      setSyncStatus('offline', 'Supabase não configurado', false);
      return;
    }
    if (state.sync.dirty) {
      setSyncStatus('dirty', `Alterações locais em ${getPeriodoLabel()}`, true);
      return;
    }
    setSyncStatus('ready', `Sincronizado com ${getPeriodoLabel()}`, false);
  }, 2200);
}

function hasSupabaseConfig() {
  const cfg = window.SUPABASE_CONFIG || {};
  return !!(cfg.url && cfg.anonKey && window.supabase && window.supabase.createClient);
}

function initSupabase() {
  if (!hasSupabaseConfig()) {
    state.sync.enabled = false;
    setSyncStatus('offline', 'Sincronização automática indisponível', false);
    return;
  }

  const cfg = window.SUPABASE_CONFIG;
  supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
  state.sync.enabled = true;
  setSyncStatus('ready', `Sincronização automática pronta para ${getPeriodoLabel()}`, false);
}

function resetStateData() {
  state.areas = JSON.parse(JSON.stringify(AREAS));
  state.indicadores = {};
  state.unidades = {};
  state.dados = {};
  state.dadosMes = {};
  state.dadosMeta = {};
  state.anexos = {};
  state.modoMes = {};
  state.modoMeta = {};
  state.focusIdx = null;
  state.presentIdx = 0;
}

function buildSnapshotPayload() {
  return {
    version: 1,
    areas: state.areas,
    indicadores: state.indicadores,
    unidades: state.unidades,
    dados: state.dados,
    dadosMes: state.dadosMes,
    dadosMeta: state.dadosMeta,
    anexos: state.anexos,
    modoMes: state.modoMes,
    modoMeta: state.modoMeta,
  };
}

function applySnapshotPayload(payload) {
  resetStateData();
  if (!payload || typeof payload !== 'object') {
    initData();
    return;
  }
  state.areas = Array.isArray(payload.areas) ? payload.areas : JSON.parse(JSON.stringify(AREAS));
  state.indicadores = payload.indicadores || {};
  state.unidades = payload.unidades || {};
  state.dados = payload.dados || {};
  state.dadosMes = payload.dadosMes || {};
  state.dadosMeta = payload.dadosMeta || {};
  state.anexos = payload.anexos || {};
  state.modoMes = payload.modoMes || {};
  state.modoMeta = payload.modoMeta || {};
  initData();
}

function renderAll() {
  updateMonthLabel();
  updateFocusBadge();
  const pMonth = document.getElementById('p-month-label');
  if (pMonth) pMonth.textContent = getPeriodoLabel();
  renderHeader();
  renderBody();
  if (document.getElementById('present-overlay').classList.contains('open')) {
    renderPresentBody();
  }
  renderSyncStatus();
}

function markDirty() {
  if (!state.sync.enabled) return;
  state.sync.dirty = true;
  setSyncStatus('dirty', `Alterações locais em ${getPeriodoLabel()}`, true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToCloud(true);
  }, 1200);
}

async function saveToCloud(silent = false) {
  if (!supabaseClient) return false;

  clearTimeout(saveTimer);
  setSyncStatus('saving', `Salvando ${getPeriodoLabel()}...`, state.sync.dirty);

  const payload = buildSnapshotPayload();
  const { error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .upsert({
      ano: state.ano,
      mes: state.mesIdx + 1,
      payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'ano,mes' });

  if (error) {
    setSyncStatus('error', 'Falha ao salvar no Supabase', true);
    return false;
  }

  setSyncStatus('ready', `Salvo em nuvem: ${getPeriodoLabel()}`, false);
  if (!silent) scheduleSyncMessageReset();
  else scheduleSyncMessageReset();
  return true;
}

async function reloadFromCloud(silent = false) {
  if (!supabaseClient) return false;

  clearTimeout(saveTimer);
  setSyncStatus('saving', `Carregando ${getPeriodoLabel()}...`, false);

  const { data, error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .select('payload')
    .eq('ano', state.ano)
    .eq('mes', state.mesIdx + 1)
    .maybeSingle();

  if (error) {
    setSyncStatus('error', 'Falha ao carregar do Supabase', state.sync.dirty);
    return false;
  }

  if (!data || !data.payload) {
    resetStateData();
    initData();
    renderAll();
    setSyncStatus('ready', `Sem dados salvos para ${getPeriodoLabel()}`, false);
    if (!silent) scheduleSyncMessageReset();
    return true;
  }

  applySnapshotPayload(data.payload);
  renderAll();
  setSyncStatus('ready', `Dados carregados: ${getPeriodoLabel()}`, false);
  if (!silent) scheduleSyncMessageReset();
  return true;
}

function makeHeaderContent(labelHtml, colKey, clickable = false, clickJs = '') {
  const clickAttr = clickable ? ` onclick="${clickJs}"` : '';
  return `<div class="th-inner"${clickAttr}>${labelHtml}<span class="resize-handle" onmousedown="startColumnResize(event, '${colKey}')"></span></div>`;
}

function initData() {
  state.areas.forEach(a => {
    if (!state.indicadores[a.id]) {
      state.indicadores[a.id] = [...(INDICADORES_DEFAULT[a.id] || ['Indicador 1'])];
    }
    getIndicators(a.id).forEach(ind => {
      state.semanas.forEach(col => {
        const k = key(a.id, ind.id, col);
        if (state.dados[k] === undefined) state.dados[k] = '';
        if (!state.unidades[k]) state.unidades[k] = 'R$';
      });
      if (!state.modoMes[modoMesK(a.id, ind.id)]) state.modoMes[modoMesK(a.id, ind.id)] = isAggregateIndicator(ind) ? 'soma' : 'soma';
      if (!state.modoMeta[modoMetaK(a.id, ind.id)]) state.modoMeta[modoMetaK(a.id, ind.id)] = isAggregateIndicator(ind) ? 'soma' : 'manual';
      if (!state.dadosMes[dadosMesK(a.id, ind.id)]) state.dadosMes[dadosMesK(a.id, ind.id)] = '';
      if (!state.dadosMeta[dadosMetaK(a.id, ind.id)]) state.dadosMeta[dadosMetaK(a.id, ind.id)] = '';
    });
  });
}

function getUnit(aId, ind) {
  const indId = getIndicatorId(ind);
  const children = typeof ind === 'object' ? getChildIndicators(aId, ind.id) : [];
  if (children.length) {
    return getUnit(aId, children[0]);
  }
  return state.unidades[key(aId, indId, state.semanas[0])] || 'R$';
}

function formatVal(raw, unit) {
  if (raw === '' || raw === null || raw === undefined) return '-';
  if (unit === 'h') {
    const n = parseFloat(raw);
    if (isNaN(n)) return raw;
    const h = Math.floor(Math.abs(n));
    const m = Math.round((Math.abs(n) - h) * 60);
    const sign = n < 0 ? '-' : '';
    return `${sign}${h}:${String(m).padStart(2,'0')}`;
  }
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  if (unit === '%') {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  if (unit === 'R$') {
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return n % 1 === 0
    ? n.toLocaleString('pt-BR')
    : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatNum(n, unit) {
  if (n === null || isNaN(n)) return '-';
  return formatVal(String(n), unit || 'un');
}

function findIndicatorByRef(areaId, refName) {
  const refSlug = slugifyLabel(refName);
  return getIndicators(areaId).find(ind => slugifyLabel(ind.label) === refSlug) || null;
}

function evaluateFormula(raw, areaId, semana, stack) {
  let expr = String(raw || '').trim();
  if (!expr.startsWith('=')) return null;
  expr = expr.slice(1);

  expr = expr.replace(/\{([^}]+)\}/g, (_, refName) => {
    const refInd = findIndicatorByRef(areaId, refName);
    if (!refInd) return '0';
    const val = calcWeekValue(areaId, refInd, semana, stack);
    return String(val ?? 0);
  });

  expr = expr.replace(/\b[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*\b/g, token => {
    const refInd = findIndicatorByRef(areaId, token);
    if (!refInd) return token;
    const val = calcWeekValue(areaId, refInd, semana, stack);
    return String(val ?? 0);
  });

  if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

  try {
    const val = Function(`"use strict"; return (${expr});`)();
    return Number.isFinite(val) ? val : null;
  } catch (_) {
    return null;
  }
}

function calcWeekValue(aId, ind, semana, stack = new Set()) {
  const stackKey = `${aId}|${ind.id}|${semana}`;
  if (stack.has(stackKey)) return null;
  stack.add(stackKey);

  if (isAggregateIndicator(ind)) {
    const vals = getChildIndicators(aId, ind.id)
      .map(child => calcWeekValue(aId, child, semana, stack))
      .filter(v => v !== null);
    stack.delete(stackKey);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0);
  }

  const raw = state.dados[key(aId, ind.id, semana)];
  if (typeof raw === 'string' && raw.trim().startsWith('=')) {
    const formulaVal = evaluateFormula(raw, aId, semana, stack);
    stack.delete(stackKey);
    return formulaVal;
  }

  const v = parseFloat(raw);
  stack.delete(stackKey);
  return isNaN(v) ? null : v;
}

function getVals(aId, ind) {
  return state.semanas
    .map(s => calcWeekValue(aId, ind, s))
    .filter(v => v !== null);
}

function calcMes(aId, ind) {
  if (isAggregateIndicator(ind)) {
    const vals = getChildIndicators(aId, ind.id)
      .map(child => calcMes(aId, child))
      .filter(v => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  const modo = state.modoMes[modoMesK(aId, ind.id)] || 'soma';
  if (modo === 'manual') {
    const v = parseFloat(state.dadosMes[dadosMesK(aId, ind.id)]);
    return isNaN(v) ? null : v;
  }
  const vals = getVals(aId, ind);
  if (!vals.length) return null;
  if (modo === 'soma') return vals.reduce((a,b) => a + b, 0);
  if (modo === 'media') return vals.reduce((a,b) => a + b, 0) / vals.length;
  if (modo === 'ultima') return vals[vals.length - 1];
  return null;
}

function calcMeta(aId, ind) {
  if (isAggregateIndicator(ind)) {
    const vals = getChildIndicators(aId, ind.id)
      .map(child => calcMeta(aId, child))
      .filter(v => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  const modo = state.modoMeta[modoMetaK(aId, ind.id)] || 'manual';
  if (modo === 'manual') {
    const v = parseFloat(state.dadosMeta[dadosMetaK(aId, ind.id)]);
    return isNaN(v) ? null : v;
  }
  const vals = getVals(aId, ind);
  if (!vals.length) return null;
  if (modo === 'soma') return vals.reduce((a,b) => a + b, 0);
  if (modo === 'media') return vals.reduce((a,b) => a + b, 0) / vals.length;
  if (modo === 'ultima') return vals[vals.length - 1];
  return null;
}

function calcVar(ref, meta) {
  if (ref === null || meta === null || meta === 0) return null;
  return ((ref - meta) / Math.abs(meta)) * 100;
}

function getModoMesObj(aId, ind) {
  if (isAggregateIndicator(ind)) return MES_MODOS[0];
  const id = state.modoMes[modoMesK(aId, ind.id)] || 'soma';
  return MES_MODOS.find(m => m.id === id) || MES_MODOS[0];
}

function getModoMetaObj(aId, ind) {
  if (isAggregateIndicator(ind)) return MES_MODOS[0];
  const id = state.modoMeta[modoMetaK(aId, ind.id)] || 'manual';
  return MES_MODOS.find(m => m.id === id) || MES_MODOS[3];
}

function cycleModoMes(aId, ind) {
  if (isAggregateIndicator(ind)) return;
  const cur = state.modoMes[modoMesK(aId, ind.id)] || 'soma';
  const idx = MES_MODOS.findIndex(m => m.id === cur);
  state.modoMes[modoMesK(aId, ind.id)] = MES_MODOS[(idx + 1) % MES_MODOS.length].id;
  renderBody();
  markDirty();
}

function cycleModoMeta(aId, ind) {
  if (isAggregateIndicator(ind)) return;
  const cur = state.modoMeta[modoMetaK(aId, ind.id)] || 'manual';
  const idx = MES_MODOS.findIndex(m => m.id === cur);
  state.modoMeta[modoMetaK(aId, ind.id)] = MES_MODOS[(idx + 1) % MES_MODOS.length].id;
  renderBody();
  markDirty();
}

let ttTimer = null;
const tt = document.getElementById('img-tooltip');

function getAttachments(ak) {
  const raw = state.anexos[ak];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    return [{
      id: `legacy_${ak}`,
      name: 'imagem',
      type: 'image/*',
      url: raw,
      isImage: true,
    }];
  }
  return [];
}

function setAttachments(ak, items) {
  if (!items.length) delete state.anexos[ak];
  else state.anexos[ak] = items;
}

function isImageAttachment(att) {
  return !!att && (att.isImage || (att.type || '').startsWith('image/'));
}

function getImageAttachments(ak) {
  return getAttachments(ak).filter(isImageAttachment);
}

function getDocumentAttachments(ak) {
  return getAttachments(ak).filter(att => !isImageAttachment(att));
}

function getFirstImageAttachment(ak) {
  return getImageAttachments(ak)[0] || null;
}

function getAttachmentCount(ak) {
  return getAttachments(ak).length;
}

function getExt(name = '') {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function guessDocIcon(att) {
  const ext = getExt(att.name);
  if (ext === 'pdf') return 'ti-file-type-pdf';
  if (['doc', 'docx'].includes(ext)) return 'ti-file-type-doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'ti-file-type-xls';
  if (['ppt', 'pptx'].includes(ext)) return 'ti-file-type-ppt';
  if (ext === 'txt') return 'ti-file-text';
  return 'ti-file-description';
}

function buildAttachment(file, url) {
  const type = file.type || '';
  const ext = getExt(file.name);
  const isImage = type.startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext);
  return {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || 'arquivo',
    type,
    url,
    isImage,
  };
}

function showTooltip(e, att, lbl) {
  if (!att || !isImageAttachment(att)) return;
  clearTimeout(ttTimer);
  document.getElementById('tooltip-img').src = att.url;
  document.getElementById('tooltip-label').textContent = lbl;
  tt.classList.add('visible');
  posTooltip(e);
}

function posTooltip(e) {
  const tw = 290;
  const th = 210;
  let x = e.clientX + 14;
  let y = e.clientY + 14;
  if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 10;
  if (y + th > window.innerHeight - 8) y = e.clientY - th - 10;
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
}

function hideTooltip() {
  ttTimer = setTimeout(() => tt.classList.remove('visible'), 80);
}

document.addEventListener('mousemove', e => {
  if (tt.classList.contains('visible')) posTooltip(e);
});

function openLightbox(ak, lbl) {
  lbKey = ak;
  lbLabel = lbl;
  lbImageIdx = 0;
  document.getElementById('lb-label').textContent = lbl;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  lbKey = null;
  lbLabel = '';
  lbImageIdx = 0;
}

function removeAttachment(ak, id) {
  const next = getAttachments(ak).filter(att => att.id !== id);
  setAttachments(ak, next);
  if (!next.length) {
    closeLightbox();
  } else {
    lbImageIdx = Math.min(lbImageIdx, Math.max(getImageAttachments(ak).length - 1, 0));
    renderLightbox();
  }
  renderBody();
}

function lightboxNav(delta) {
  const imgs = getImageAttachments(lbKey);
  if (!imgs.length) return;
  lbImageIdx = (lbImageIdx + delta + imgs.length) % imgs.length;
  renderLightbox();
}

function renderLightbox() {
  const preview = document.getElementById('attach-preview');
  const docsWrap = document.getElementById('attach-docs');
  const imgs = getImageAttachments(lbKey);
  const docs = getDocumentAttachments(lbKey);

  preview.className = 'attach-preview';
  if (imgs.length) {
    const current = imgs[Math.min(lbImageIdx, imgs.length - 1)];
    preview.innerHTML = `<div class="attach-stage">
      <div class="attach-stage-main">
        <img src="${current.url}" alt="${current.name}">
      </div>
      <div class="attach-stage-bar">
        <div class="attach-stage-meta">${lbImageIdx + 1} de ${imgs.length} imagem(ns) · ${current.name}</div>
        <div class="attach-stage-nav">
          ${imgs.length > 1 ? '<button class="lb-btn" onclick="lightboxNav(-1)"><i class="ti ti-arrow-left"></i> Anterior</button>' : ''}
          ${imgs.length > 1 ? '<button class="lb-btn" onclick="lightboxNav(1)">Próxima <i class="ti ti-arrow-right"></i></button>' : ''}
        </div>
      </div>
    </div>`;
  } else {
    preview.className = 'attach-preview empty';
    preview.innerHTML = 'Sem imagens nesta célula.';
  }

  const docItems = docs.length
    ? docs.map(att => `<div class="attach-doc-item">
        <div class="attach-doc-main">
          <span class="attach-doc-icon"><i class="ti ${guessDocIcon(att)}"></i></span>
          <div style="min-width:0">
            <div class="attach-doc-name">${att.name}</div>
            <div class="attach-doc-type">${getExt(att.name) || 'arquivo'}</div>
          </div>
        </div>
        <div class="attach-doc-actions">
          <a class="attach-link-btn" href="${att.url}" download="${att.name}" target="_blank" rel="noopener noreferrer">Abrir</a>
        </div>
      </div>`).join('')
    : '<div class="attach-empty-list">Sem documentos anexados.</div>';

  docsWrap.innerHTML = `<div class="attach-section-title">Documentos</div>
    <div class="attach-doc-list">${docItems}</div>`;
}

let pendKey = null;
let pendLbl = null;
const fileInput = document.getElementById('file-input');

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length || !pendKey) return;
  Promise.all(files.map(file => new Promise(resolve => {
    const r = new FileReader();
    r.onload = e => resolve(buildAttachment(file, e.target.result));
    r.readAsDataURL(file);
  }))).then(newItems => {
    setAttachments(pendKey, [...getAttachments(pendKey), ...newItems]);
    renderBody();
    markDirty();
  });
  fileInput.value = '';
});

function triggerUpload(ak, lbl) {
  pendKey = ak;
  pendLbl = lbl;
  fileInput.click();
}

function startColumnResize(event, colKey) {
  event.preventDefault();
  event.stopPropagation();
  ensureColumnWidths();
  resizeState = {
    colKey,
    startX: event.clientX,
    startWidth: state.columnWidths[colKey] || COLUMN_WIDTH_DEFAULTS[colKey] || 110,
  };
  event.target.classList.add('active');
}

document.addEventListener('mousemove', event => {
  if (!resizeState) return;
  const dx = event.clientX - resizeState.startX;
  state.columnWidths[resizeState.colKey] = Math.max(72, resizeState.startWidth + dx);
  syncColumnWidths();
});

document.addEventListener('mouseup', () => {
  if (!resizeState) return;
  document.querySelectorAll('.resize-handle.active').forEach(el => el.classList.remove('active'));
  saveColumnWidths();
  resizeState = null;
});

function renderHeader() {
  const thead = document.getElementById('table-head');
  syncColumnWidths();
  thead.innerHTML = '';
  const tr = document.createElement('tr');

  let th = document.createElement('th');
  th.className = 'area-col';
  th.innerHTML = makeHeaderContent('Área / Indicador', 'area');
  tr.appendChild(th);

  state.semanas.forEach((s, i) => {
    th = document.createElement('th');
    th.className = 'week-th' + (state.focusIdx === i ? ' focused' : '');
    th.onclick = () => toggleFocus(i);
    th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-week" style="font-size:10px;vertical-align:-1px;margin-right:3px"></i>${s}`, s);
    tr.appendChild(th);
  });

  th = document.createElement('th');
  th.className = 'mes-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-month" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Mês`, 'mes');
  tr.appendChild(th);

  th = document.createElement('th');
  th.className = 'meta-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-target" style="font-size:10px;vertical-align:-1px;margin-right:3px"></i>Meta`, 'meta');
  tr.appendChild(th);

  th = document.createElement('th');
  th.className = 'var-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-trending-up" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Variação %`, 'var');
  tr.appendChild(th);

  thead.appendChild(tr);
}

function renderBody() {
  const tbody = document.getElementById('table-body');
  tbody.innerHTML = '';

  state.areas.forEach(area => {
    const aRow = document.createElement('tr');
    aRow.className = 'area-header-row';
    const aTd = document.createElement('td');
    aTd.colSpan = state.semanas.length + 4;
    aTd.innerHTML = `<span class="area-icon"><i class="ti ${area.icon}" style="font-size:14px;color:${area.cor}"></i>${area.nome}</span>`;
    aRow.appendChild(aTd);
    tbody.appendChild(aRow);

    getIndicators(area.id).forEach((ind, ii) => {
      if (isSpacerIndicator(ind)) {
        const spacerRow = document.createElement('tr');
        spacerRow.className = 'indicator-row spacer-row';
        const spacerTd = document.createElement('td');
        spacerTd.colSpan = state.semanas.length + 4;
        spacerTd.innerHTML = '&nbsp;';
        spacerRow.appendChild(spacerTd);
        tbody.appendChild(spacerRow);
        return;
      }

      const row = document.createElement('tr');
      row.className = 'indicator-row';
      const unit = getUnit(area.id, ind);
      const isAggregate = isAggregateIndicator(ind);
      const isChild = !!ind.parentId;

      const tdL = document.createElement('td');
      tdL.innerHTML = `<span style="display:flex;align-items:center;gap:6px;justify-content:space-between">
        <span contenteditable="true" style="flex:1;outline:none;padding:2px 3px 2px ${isChild ? '18px' : '3px'};border-radius:3px;font-weight:${isAggregate ? '600' : '400'}"
          onblur="renameIndicador('${area.id}',${ii},this.textContent.trim())">${ind.label}</span>
        <span style="display:inline-flex;align-items:center;gap:6px">
          <button onclick="removeIndicador('${area.id}',${ii})"
            style="background:none;border:none;cursor:pointer;color:#a0a09a;padding:0 2px;font-size:13px;line-height:1">x</button>
        </span>
      </span>`;
      row.appendChild(tdL);

      state.semanas.forEach((s, si) => {
        const tdC = document.createElement('td');
        if (state.focusIdx === si) tdC.className = 'focused-col';
        const k = key(area.id, ind.id, s);
        const ak = anexoKey(area.id, ind.id, s);
        const countAtt = getAttachmentCount(ak);
        const hasAtt = countAtt > 0;
        const previewAtt = getFirstImageAttachment(ak);
        const lbl = `${ind.label} - ${s}`;
        const unitCell = state.unidades[k] || 'R$';

        const wrap = document.createElement('div');
        wrap.className = 'cell-wrap';
        const inp = document.createElement('input');
        inp.className = 'cell-input';
        inp.placeholder = '-';
        inp.dataset.key = k;
        const rawVal = state.dados[k] || '';
        const calcVal = calcWeekValue(area.id, ind, s);
        inp.value = isAggregate ? formatNum(calcVal, unitCell) : (rawVal ? formatVal(rawVal, unitCell) : '');
        inp.disabled = isAggregate;
        inp.onfocus = () => {
          inp.value = state.dados[inp.dataset.key] || '';
          inp.select();
        };
        inp.onblur = e => {
          const rv = e.target.value;
          state.dados[e.target.dataset.key] = rv;
          e.target.value = rv ? formatVal(rv, unitCell) : '';
          markDirty();
        };
        inp.onkeydown = e => {
          if (e.key === 'Enter') inp.blur();
        };

        const us = document.createElement('span');
        us.className = 'unit-tag';
        us.textContent = unitCell;
        us.title = 'Alterar unidade';
        us.onclick = () => {
          const c = UNIDADES.indexOf(state.unidades[k] || 'R$');
          state.unidades[k] = UNIDADES[(c + 1) % UNIDADES.length];
          state.semanas.forEach(col => {
            state.unidades[key(area.id, ind.id, col)] = state.unidades[k];
          });
          us.textContent = state.unidades[k];
          renderBody();
          markDirty();
        };

        const cb = document.createElement('button');
        cb.className = 'clip-btn' + (hasAtt ? ' has-img' : '');
        cb.title = hasAtt ? 'Adicionar ou atualizar anexos' : 'Anexar arquivos';
        cb.innerHTML = `<i class="ti ti-paperclip"></i>${hasAtt ? `<span class="clip-count">${countAtt}</span>` : ''}`;
        if (previewAtt) {
          cb.onmouseenter = e => showTooltip(e, previewAtt, lbl);
          cb.onmouseleave = hideTooltip;
        }
        cb.onclick = () => triggerUpload(ak, lbl);

        wrap.appendChild(inp);
        wrap.appendChild(us);
        wrap.appendChild(cb);
        tdC.appendChild(wrap);
        row.appendChild(tdC);
      });

      const tdMes = document.createElement('td');
      tdMes.className = 'mes-cell';
      const modoMesObj = getModoMesObj(area.id, ind);
      const valMes = calcMes(area.id, ind);
      const mWrap = document.createElement('div');
      mWrap.className = 'calc-cell-wrap';

      if (!isAggregate && modoMesObj.id === 'manual') {
        const inp2 = document.createElement('input');
        inp2.className = 'cell-input';
        inp2.style.textAlign = 'right';
        inp2.placeholder = '-';
        const rawMes = state.dadosMes[dadosMesK(area.id, ind.id)] || '';
        inp2.value = rawMes ? formatVal(rawMes, unit) : '';
        inp2.onfocus = () => {
          inp2.value = state.dadosMes[dadosMesK(area.id, ind.id)] || '';
          inp2.select();
        };
        inp2.onblur = e => {
          state.dadosMes[dadosMesK(area.id, ind.id)] = e.target.value;
          const rv = e.target.value;
          e.target.value = rv ? formatVal(rv, unit) : '';
          renderBody();
          markDirty();
        };
        inp2.onkeydown = e => {
          if (e.key === 'Enter') inp2.blur();
        };
        mWrap.appendChild(inp2);
      } else {
        const span = document.createElement('span');
        span.className = 'calc-val';
        span.textContent = formatNum(valMes, unit);
        mWrap.appendChild(span);
      }

      const mBtn = document.createElement('button');
      mBtn.className = 'mode-icon-btn';
      mBtn.title = modoMesObj.label;
      mBtn.innerHTML = `<i class="ti ${modoMesObj.icon}"></i>`;
      mBtn.style.visibility = isAggregate ? 'hidden' : 'visible';
      mBtn.onclick = () => cycleModoMes(area.id, ind);
      mWrap.appendChild(mBtn);
      tdMes.appendChild(mWrap);
      row.appendChild(tdMes);

      const tdMeta = document.createElement('td');
      tdMeta.className = 'meta-cell';
      const modoMetaObj = getModoMetaObj(area.id, ind);
      const valMeta = calcMeta(area.id, ind);
      const mtWrap = document.createElement('div');
      mtWrap.className = 'calc-cell-wrap';

      if (!isAggregate && modoMetaObj.id === 'manual') {
        const inp3 = document.createElement('input');
        inp3.className = 'cell-input';
        inp3.style.textAlign = 'right';
        inp3.placeholder = '-';
        const rawMeta = state.dadosMeta[dadosMetaK(area.id, ind.id)] || '';
        inp3.value = rawMeta ? formatVal(rawMeta, unit) : '';
        inp3.onfocus = () => {
          inp3.value = state.dadosMeta[dadosMetaK(area.id, ind.id)] || '';
          inp3.select();
        };
        inp3.onblur = e => {
          state.dadosMeta[dadosMetaK(area.id, ind.id)] = e.target.value;
          const rv = e.target.value;
          e.target.value = rv ? formatVal(rv, unit) : '';
          renderBody();
          markDirty();
        };
        inp3.onkeydown = e => {
          if (e.key === 'Enter') inp3.blur();
        };
        mtWrap.appendChild(inp3);
      } else {
        const span = document.createElement('span');
        span.className = 'calc-val';
        span.textContent = formatNum(valMeta, unit);
        mtWrap.appendChild(span);
      }

      const mtBtn = document.createElement('button');
      mtBtn.className = 'mode-icon-btn';
      mtBtn.title = modoMetaObj.label;
      mtBtn.innerHTML = `<i class="ti ${modoMetaObj.icon}"></i>`;
      mtBtn.style.visibility = isAggregate ? 'hidden' : 'visible';
      mtBtn.onclick = () => cycleModoMeta(area.id, ind);
      mtWrap.appendChild(mtBtn);
      tdMeta.appendChild(mtWrap);
      row.appendChild(tdMeta);

      const tdV = document.createElement('td');
      tdV.className = 'var-cell';
      const vp = calcVar(valMes, valMeta);
      if (vp === null) {
        tdV.innerHTML = `<span class="var-neu">-</span>`;
      } else {
        const cls = vp > 0 ? 'var-pos' : vp < 0 ? 'var-neg' : 'var-neu';
        const ic = vp > 0 ? 'ti-trending-up' : 'ti-trending-down';
        tdV.innerHTML = `<span class="${cls}" style="display:flex;align-items:center;justify-content:center;gap:3px">
          <i class="ti ${ic}" style="font-size:12px"></i>${vp > 0 ? '+' : ''}${vp.toFixed(1)}%</span>`;
      }
      row.appendChild(tdV);
      tbody.appendChild(row);
    });

    const addRow = document.createElement('tr');
    const addTd = document.createElement('td');
    addTd.colSpan = state.semanas.length + 4;
    addTd.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
      <button class="add-btn" style="width:auto;padding-left:20px" onclick="addIndicador('${area.id}')">
        <i class="ti ti-plus" style="font-size:11px;vertical-align:-1px"></i> adicionar indicador</button>
      <button class="add-btn" style="width:auto;padding-left:0" onclick="addSpacer('${area.id}')">
        <i class="ti ti-layout-rows" style="font-size:11px;vertical-align:-1px"></i> adicionar espaço</button>
    </div>`;
    addRow.appendChild(addTd);
    tbody.appendChild(addRow);
  });
}

function toggleFocus(i) {
  state.focusIdx = state.focusIdx === i ? null : i;
  updateFocusBadge();
  renderHeader();
  renderBody();
}

function updateFocusBadge() {
  const b = document.getElementById('focus-badge');
  const l = document.getElementById('focus-label');
  if (state.focusIdx !== null) {
    b.classList.add('active');
    l.textContent = `Foco: ${state.semanas[state.focusIdx]}`;
  } else {
    b.classList.remove('active');
    l.textContent = 'Nenhuma semana em foco';
  }
}

async function enterFullscreen(el) {
  if (!el) return;
  try {
    if (document.fullscreenElement) return;
    if (el.requestFullscreen) {
      await el.requestFullscreen();
    }
  } catch (_) {
    // Ignora bloqueios do navegador; a apresentação continua aberta.
  }
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch (_) {
    // Ignora falhas ao sair do fullscreen.
  }
}

function openPresent() {
  state.presentIdx = state.focusIdx !== null ? state.focusIdx : 0;
  const overlay = document.getElementById('present-overlay');
  overlay.classList.add('open');
  document.getElementById('p-month-label').textContent = `${MESES[state.mesIdx]} ${state.ano}`;
  document.getElementById('p-header-sub').textContent = 'Acompanhamento de indicadores';
  renderPresentBody();
  enterFullscreen(overlay);
}

function closePresent() {
  document.getElementById('present-overlay').classList.remove('open');
  exitFullscreen();
}

function setPresentWeek(i) {
  state.presentIdx = i;
  renderPresentBody();
  updatePresentNav();
}

function presentNav(d) {
  const max = state.semanas.length - 1;
  state.presentIdx = Math.max(0, Math.min(max, state.presentIdx + d));
  renderPresentBody();
  updatePresentNav();
}

function updatePresentNav() {
  document.getElementById('p-focus-label').textContent = `Foco: ${state.semanas[state.presentIdx]}`;
}

function renderPresentBody() {
  const thead = document.getElementById('present-table-head');
  const tbody = document.getElementById('present-table-body');
  syncColumnWidths();
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const tr = document.createElement('tr');
  let th = document.createElement('th');
  th.className = 'area-col';
  th.innerHTML = makeHeaderContent('Área / Indicador', 'area');
  tr.appendChild(th);

  state.semanas.forEach((s, i) => {
    th = document.createElement('th');
    th.className = 'week-th' + (state.presentIdx === i ? ' focused' : '');
    th.onclick = () => setPresentWeek(i);
    th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-week" style="font-size:10px;vertical-align:-1px;margin-right:3px"></i>${s}`, s);
    tr.appendChild(th);
  });

  th = document.createElement('th');
  th.className = 'mes-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-month" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Mês`, 'mes');
  tr.appendChild(th);

  th = document.createElement('th');
  th.className = 'meta-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-target" style="font-size:10px;vertical-align:-1px;margin-right:3px"></i>Meta`, 'meta');
  tr.appendChild(th);

  th = document.createElement('th');
  th.className = 'var-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-trending-up" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Variação %`, 'var');
  tr.appendChild(th);
  thead.appendChild(tr);

  state.areas.forEach(area => {
    const aRow = document.createElement('tr');
    aRow.className = 'area-header-row';
    const aTd = document.createElement('td');
    aTd.colSpan = state.semanas.length + 4;
    aTd.innerHTML = `<span class="area-icon"><i class="ti ${area.icon}" style="font-size:14px;color:${area.cor}"></i>${area.nome}</span>`;
    aRow.appendChild(aTd);
    tbody.appendChild(aRow);

    getIndicators(area.id).forEach(ind => {
      if (isSpacerIndicator(ind)) {
        const spacerRow = document.createElement('tr');
        spacerRow.className = 'indicator-row spacer-row';
        const spacerTd = document.createElement('td');
        spacerTd.colSpan = state.semanas.length + 4;
        spacerTd.innerHTML = '&nbsp;';
        spacerRow.appendChild(spacerTd);
        tbody.appendChild(spacerRow);
        return;
      }

      const row = document.createElement('tr');
      row.className = 'indicator-row';
      const unit = getUnit(area.id, ind);
      const isChild = !!ind.parentId;

      const tdL = document.createElement('td');
      tdL.textContent = `${isChild ? '   ' : ''}${ind.label}`;
      row.appendChild(tdL);

      state.semanas.forEach((s, si) => {
        const td = document.createElement('td');
        if (state.presentIdx === si) td.className = 'focused-col';
        const ak = anexoKey(area.id, ind.id, s);
        const countAtt = getAttachmentCount(ak);
        const hasAtt = countAtt > 0;
        const val = calcWeekValue(area.id, ind, s);

        td.innerHTML = `<div class="present-cell-wrap">
          <span class="present-cell-val">${val !== null ? formatNum(val, unit) : '-'}</span>
          ${hasAtt ? `<button class="present-clip-btn" onclick="openLightbox('${ak}','${ind.label} - ${s}')"><i class="ti ti-paperclip"></i><span class="present-count">${countAtt}</span></button>` : ''}
        </div>`;
        row.appendChild(td);
      });

      const valMes = calcMes(area.id, ind);
      const valMeta = calcMeta(area.id, ind);
      const vp = calcVar(valMes, valMeta);

      const tdMes = document.createElement('td');
      tdMes.className = 'mes-cell';
      tdMes.innerHTML = `<div class="present-cell-wrap"><span class="present-cell-val">${formatNum(valMes, unit)}</span></div>`;
      row.appendChild(tdMes);

      const tdMeta = document.createElement('td');
      tdMeta.className = 'meta-cell';
      tdMeta.innerHTML = `<div class="present-cell-wrap"><span class="present-cell-val p-meta-val">${formatNum(valMeta, unit)}</span></div>`;
      row.appendChild(tdMeta);

      const tdVar = document.createElement('td');
      tdVar.className = 'var-cell';
      if (vp === null) {
        tdVar.innerHTML = `<div class="present-cell-wrap"><span class="p-var-neu">-</span></div>`;
      } else {
        const cls = vp > 0 ? 'p-var-pos' : vp < 0 ? 'p-var-neg' : 'p-var-neu';
        const ic = vp > 0 ? 'ti-trending-up' : 'ti-trending-down';
        tdVar.innerHTML = `<div class="present-cell-wrap"><span class="${cls}"><i class="ti ${ic}" style="font-size:11px"></i>${vp > 0 ? '+' : ''}${vp.toFixed(1)}%</span></div>`;
      }
      row.appendChild(tdVar);
      tbody.appendChild(row);
    });
  });
  updatePresentNav();
}

function renameIndicador(aId, idx, novo) {
  if (!novo) return;
  getIndicators(aId)[idx].label = novo;
  markDirty();
}

function removeIndicatorData(aId, indId) {
  state.semanas.forEach(col => {
    delete state.dados[key(aId, indId, col)];
    delete state.unidades[key(aId, indId, col)];
    delete state.anexos[anexoKey(aId, indId, col)];
  });
  delete state.modoMes[modoMesK(aId, indId)];
  delete state.modoMeta[modoMetaK(aId, indId)];
  delete state.dadosMes[dadosMesK(aId, indId)];
  delete state.dadosMeta[dadosMetaK(aId, indId)];
}

function addIndicador(aId) {
  getIndicators(aId).push(normalizeIndicator({ label:'Novo indicador', id:`novo_indicador_${Date.now()}` }));
  initData();
  renderBody();
  markDirty();
}

function addSpacer(aId) {
  getIndicators(aId).push(normalizeIndicator({ label:'', id:`spacer_${Date.now()}`, type:'spacer' }));
  initData();
  renderBody();
  markDirty();
}

function removeIndicador(aId, idx) {
  const indicators = getIndicators(aId);
  const target = indicators[idx];
  const idsToRemove = [target.id, ...getChildIndicators(aId, target.id).map(child => child.id)];
  state.indicadores[aId] = indicators.filter(ind => !idsToRemove.includes(ind.id));
  idsToRemove.forEach(indId => removeIndicatorData(aId, indId));
  renderBody();
  markDirty();
}

function addArea() {
  const n = prompt('Nome da nova área:');
  if (!n) return;
  const id = n.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
  state.areas.push({ id, nome: n.toUpperCase(), icon:'ti-briefcase', cor:'#5F5E5A' });
  state.indicadores[id] = [normalizeIndicator({ label:'Indicador 1', id:`indicador_1_${Date.now()}` })];
  initData();
  renderBody();
  markDirty();
}

async function changeMonth(d) {
  if (state.sync.enabled && state.sync.dirty) {
    await saveToCloud(true);
  }
  state.mesIdx += d;
  if (state.mesIdx < 0) {
    state.mesIdx = 11;
    state.ano--;
  }
  if (state.mesIdx > 11) {
    state.mesIdx = 0;
    state.ano++;
  }
  updateMonthLabel();
  if (state.sync.enabled) {
    await reloadFromCloud(true);
  } else {
    renderAll();
  }
}

function updateMonthLabel() {
  document.getElementById('month-label').textContent = getPeriodoLabel();
  document.getElementById('header-sub').textContent = 'Acompanhamento de indicadores';
}

function exportData() {
  const rows = [['Área','Indicador',...state.semanas,'Mês','Meta','Variação%'].join('\t')];
  state.areas.forEach(a => {
    getIndicators(a.id).forEach(ind => {
      if (isSpacerIndicator(ind)) return;
      const unit = getUnit(a.id, ind);
      const vals = state.semanas.map(col => {
        const v = calcWeekValue(a.id, ind, col);
        return v !== null ? formatNum(v, unit) : '';
      });
      const mes = calcMes(a.id, ind);
      const meta = calcMeta(a.id, ind);
      const vp = calcVar(mes, meta);
      rows.push([
        a.nome,
        ind.label,
        ...vals,
        mes !== null ? formatNum(mes, unit) : '',
        meta !== null ? formatNum(meta, unit) : '',
        vp !== null ? vp.toFixed(1) + '%' : ''
      ].join('\t'));
    });
  });
  const blob = new Blob([rows.join('\n')], { type:'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `RPS_MarcherBrasil_${MESES[state.mesIdx]}_${state.ano}.tsv`;
  a.click();
}

async function bootstrap() {
  loadColumnWidths();
  initData();
  initSupabase();
  renderAll();
  if (state.sync.enabled) {
    await reloadFromCloud(true);
  }
}

bootstrap();


