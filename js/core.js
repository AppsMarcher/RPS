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

const REMINDER_WEEKDAYS = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
];

let state = {
  mesIdx:     new Date().getMonth(),
  ano:        new Date().getFullYear(),
  semanas:    ['S1','S2','S3','S4','S5'],
  focusIdx:   null,
  presentIdx: 0,
  presentation: {
    darkMode: false,
    fontBoost: false,
  },
  columnWidths: {},
  auth: {
    user: null,
    checked: false,
    loadedUserId: null,
    profile: null,
    users: [],
    mode: 'login',
    pendingRequest: false,
  },
  sync: {
    enabled: false,
    dirty: false,
    status: 'offline',
    message: 'Supabase não configurado',
    lastSuccessAt: '',
    basePayload: null,
  },
  areas:      JSON.parse(JSON.stringify(AREAS)),
  indicadores: {},
  unidades:    {},
  dados:       {},
  cellStyles:  {},
  comentarios: {},
  dadosMes:    {},
  dadosMeta:   {},
  anexos:      {},
  modoMes:     {},
  modoMeta:    {},
  gridSelection: null,
  reminder: null,
};

let lbKey = null;
let lbLabel = '';
let lbImageIdx = 0;
let lbZoom = 1;
let attachmentManagerState = null;
let resizeState = null;
let supabaseClient = null;
let saveTimer = null;
let syncMessageTimer = null;
let authSubscription = null;
let authPostLogoutMessage = '';
let policyEditorState = null;
let copyConfigState = null;
let cellCommentEditorState = null;
let presentLaserVisible = false;

const COLUMN_WIDTH_DEFAULTS = {
  area: 620,
  S1: 110,
  S2: 110,
  S3: 110,
  S4: 110,
  S5: 110,
  mes: 120,
  meta: 120,
  vardiff: 120,
  var: 120,
};

const SUPABASE_TABLE = 'rps_snapshots';
const APP_USERS_TABLE = 'app_users';
const APP_REMINDER_TABLE = 'app_reminder_settings';
const REMINDER_FUNCTION_NAME = 'send-rps-reminder';
const ATTACHMENTS_BUCKET = 'rps-attachments';
const APP_PUBLIC_URL = 'https://rps.marcher.com.br/';
const ADMIN_EMAIL = 'ricardo@marcher.com.br';
const LOCAL_DRAFT_PREFIX = 'rps_local_draft_v1';

const key        = (a,i,c)  => `${a}|${i}|${c}`;
const anexoKey   = (a,i,c)  => `anx:${a}|${i}|${c}`;
const modoMesK   = (a,i)    => `mes:${a}|${i}`;
const modoMetaK  = (a,i)    => `meta:${a}|${i}`;
const dadosMesK  = (a,i)    => `vmes:${a}|${i}`;
const dadosMetaK = (a,i)    => `vmeta:${a}|${i}`;
const comentarioK = (a,i,c) => `cmt:${a}|${i}|${c}`;
const GRID_COLS  = ['S1', 'S2', 'S3', 'S4', 'S5', 'mes', 'meta'];

function slugifyLabel(label) {
  return String(label || 'indicador')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'indicador';
}

function getDefaultEditableFields(ind = {}) {
  if (ind.type === 'spacer') {
    return { label: false, semanas: false, mes: false, meta: false };
  }
  if (ind.aggregate === 'sum-children') {
    return { label: true, semanas: false, mes: false, meta: false };
  }
  return { label: true, semanas: true, mes: false, meta: true };
}

function normalizeEditableFields(ind = {}) {
  const defaults = getDefaultEditableFields(ind);
  return {
    ...defaults,
    ...(ind.editableFields || {}),
  };
}

function normalizeIndicator(ind, idx = 0) {
  if (typeof ind === 'string') {
    return {
      id: `${slugifyLabel(ind)}_${idx}`,
      label: ind,
      parentId: null,
      aggregate: null,
      type: 'item',
      editableFields: normalizeEditableFields({ type: 'item' }),
    };
  }
  return {
    id: ind.id || `${slugifyLabel(ind.label)}_${idx}`,
    label: ind.label || 'Indicador',
    parentId: ind.parentId || null,
    aggregate: ind.aggregate || null,
    type: ind.type || 'item',
    editableFields: normalizeEditableFields(ind),
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
  return ['area', ...state.semanas, 'mes', 'meta', 'vardiff', 'var'];
}

function syncVisibleInputsToState() {
  const inputs = document.querySelectorAll('.cell-input[data-area-id][data-ind-id][data-col]');
  let changed = false;

  inputs.forEach(input => {
    const areaId = input.dataset.areaId;
    const indId = input.dataset.indId;
    const col = input.dataset.col;
    const rawValue = input === document.activeElement ? input.value : input.value;

    if (!areaId || !indId || !col) return;

    if (col === 'mes') {
      const storageKey = dadosMesK(areaId, indId);
      if ((state.dadosMes[storageKey] || '') !== rawValue) {
        state.dadosMes[storageKey] = rawValue;
        changed = true;
      }
      return;
    }

    if (col === 'meta') {
      const storageKey = dadosMetaK(areaId, indId);
      if ((state.dadosMeta[storageKey] || '') !== rawValue) {
        state.dadosMeta[storageKey] = rawValue;
        changed = true;
      }
      return;
    }

    const storageKey = key(areaId, indId, col);
    if ((state.dados[storageKey] || '') !== rawValue) {
      state.dados[storageKey] = rawValue;
      changed = true;
    }
  });

  return changed;
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

function savePresentationPreferences() {
  try {
    localStorage.setItem('rps_presentation_prefs', JSON.stringify(state.presentation));
  } catch (_) {}
}

function loadPresentationPreferences() {
  try {
    const raw = localStorage.getItem('rps_presentation_prefs');
    if (raw) {
      state.presentation = {
        ...state.presentation,
        ...JSON.parse(raw),
      };
    }
  } catch (_) {}
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

function normalizeGridCol(col) {
  if (state.semanas.includes(col)) return col;
  if (col === 'mes' || col === 'meta') return col;
  return null;
}

function getEditableGridRows() {
  const rows = [];
  state.areas.forEach(area => {
    getIndicators(area.id).forEach(ind => {
      if (isSpacerIndicator(ind) || isAggregateIndicator(ind)) return;
      rows.push({ areaId: area.id, indId: ind.id });
    });
  });
  return rows;
}

function getGridRowIndex(areaId, indId) {
  return getEditableGridRows().findIndex(row => row.areaId === areaId && row.indId === indId);
}

function getGridColIndex(col) {
  return GRID_COLS.indexOf(col);
}

function buildGridCellRef(areaId, indId, col) {
  const normalizedCol = normalizeGridCol(col);
  if (!areaId || !indId || !normalizedCol) return null;
  return { areaId, indId, col: normalizedCol };
}

function getGridCellRefFromInput(input) {
  return buildGridCellRef(input?.dataset.areaId, input?.dataset.indId, input?.dataset.col);
}

function cloneGridCellRef(ref) {
  return ref ? { areaId: ref.areaId, indId: ref.indId, col: ref.col } : null;
}

function normalizeGridSelection(selection) {
  if (!selection?.anchor || !selection?.focus) return null;
  const anchor = cloneGridCellRef(selection.anchor);
  const focus = cloneGridCellRef(selection.focus);
  if (!anchor || !focus) return null;

  const anchorRow = getGridRowIndex(anchor.areaId, anchor.indId);
  const focusRow = getGridRowIndex(focus.areaId, focus.indId);
  const anchorCol = getGridColIndex(anchor.col);
  const focusCol = getGridColIndex(focus.col);
  if ([anchorRow, focusRow, anchorCol, focusCol].some(v => v < 0)) return null;

  return { anchor, focus };
}

function setGridSelection(anchor, focus = anchor) {
  const normalized = normalizeGridSelection({ anchor, focus });
  state.gridSelection = normalized;
}

function clearGridSelection() {
  state.gridSelection = null;
}

function getGridSelectionBounds() {
  const selection = normalizeGridSelection(state.gridSelection);
  if (!selection) return null;

  const anchorRow = getGridRowIndex(selection.anchor.areaId, selection.anchor.indId);
  const focusRow = getGridRowIndex(selection.focus.areaId, selection.focus.indId);
  const anchorCol = getGridColIndex(selection.anchor.col);
  const focusCol = getGridColIndex(selection.focus.col);

  return {
    rowStart: Math.min(anchorRow, focusRow),
    rowEnd: Math.max(anchorRow, focusRow),
    colStart: Math.min(anchorCol, focusCol),
    colEnd: Math.max(anchorCol, focusCol),
  };
}

function isGridCellSelected(areaId, indId, col) {
  const bounds = getGridSelectionBounds();
  if (!bounds) return false;
  const rowIdx = getGridRowIndex(areaId, indId);
  const colIdx = getGridColIndex(col);
  if (rowIdx < 0 || colIdx < 0) return false;
  return rowIdx >= bounds.rowStart && rowIdx <= bounds.rowEnd && colIdx >= bounds.colStart && colIdx <= bounds.colEnd;
}

function updateGridSelectionUI() {
  document.querySelectorAll('#table-body td.grid-selected').forEach(td => td.classList.remove('grid-selected'));
  document.querySelectorAll('#table-body .cell-input.grid-selected-input').forEach(inp => inp.classList.remove('grid-selected-input'));

  const bounds = getGridSelectionBounds();
  if (!bounds) return;

  const rows = getEditableGridRows();
  for (let rowIdx = bounds.rowStart; rowIdx <= bounds.rowEnd; rowIdx++) {
    const row = rows[rowIdx];
    if (!row) continue;
    for (let colIdx = bounds.colStart; colIdx <= bounds.colEnd; colIdx++) {
      const col = GRID_COLS[colIdx];
      const selector = `.cell-input[data-area-id="${row.areaId}"][data-ind-id="${row.indId}"][data-col="${col}"]`;
      const inp = document.querySelector(`#table-body ${selector}`);
      if (!inp) continue;
      inp.classList.add('grid-selected-input');
      inp.closest('td')?.classList.add('grid-selected');
    }
  }
}

function getGridCellDisplayValue(areaId, indId, col) {
  const ind = getIndicators(areaId).find(item => item.id === indId);
  if (!ind) return '';
  const unit = getUnit(areaId, ind);

  if (state.semanas.includes(col)) {
    const raw = state.dados[key(areaId, indId, col)] || '';
    if (raw === '') return '';
    const calcVal = calcWeekValue(areaId, ind, col);
    return calcVal === null ? raw : formatVal(raw, state.unidades[key(areaId, indId, col)] || unit);
  }

  if (col === 'mes') {
    const modo = state.modoMes[modoMesK(areaId, indId)] || 'soma';
    if (modo === 'manual') {
      const raw = state.dadosMes[dadosMesK(areaId, indId)] || '';
      return raw ? formatVal(raw, unit) : '';
    }
    const value = calcMes(areaId, ind);
    return value === null ? '' : formatNum(value, unit);
  }

  if (col === 'meta') {
    const modo = state.modoMeta[modoMetaK(areaId, indId)] || 'manual';
    if (modo === 'manual') {
      const raw = state.dadosMeta[dadosMetaK(areaId, indId)] || '';
      return raw ? formatVal(raw, unit) : '';
    }
    const value = calcMeta(areaId, ind);
    return value === null ? '' : formatNum(value, unit);
  }

  if (col === 'vardiff') {
    const mes = calcMes(areaId, ind);
    const meta = calcMeta(areaId, ind);
    const value = calcVarDiff(mes, meta);
    return value === null ? '' : formatNum(value, unit);
  }

  return '';
}

function buildGridClipboardText() {
  const bounds = getGridSelectionBounds();
  if (!bounds) return '';
  const rows = getEditableGridRows();
  const lines = [];

  for (let rowIdx = bounds.rowStart; rowIdx <= bounds.rowEnd; rowIdx++) {
    const row = rows[rowIdx];
    if (!row) continue;
    const cells = [];
    for (let colIdx = bounds.colStart; colIdx <= bounds.colEnd; colIdx++) {
      cells.push(getGridCellDisplayValue(row.areaId, row.indId, GRID_COLS[colIdx]));
    }
    lines.push(cells.join('\t'));
  }

  return lines.join('\n');
}

function applyGridChange(mutator, options = {}) {
  const { rerender = true, markDirty: shouldMarkDirty = true } = options;
  mutator();
  if (rerender) {
    renderBody();
  }
  if (shouldMarkDirty) {
    markDirty();
  }
}

function getIndicatorPolicyPresets() {
  return {
    entrada: { label: true, semanas: true, mes: false, meta: true },
    formula: { label: true, semanas: false, mes: false, meta: false },
    meta: { label: true, semanas: false, mes: false, meta: true },
    mes_meta: { label: true, semanas: false, mes: true, meta: true },
    tudo: { label: true, semanas: true, mes: true, meta: true },
    bloqueado: { label: true, semanas: false, mes: false, meta: false },
  };
}

function getIndicatorPolicyCode(ind) {
  const current = getIndicatorEditableFields(ind);
  return Object.entries(getIndicatorPolicyPresets()).find(([, preset]) =>
    preset.label === current.label &&
    preset.semanas === current.semanas &&
    preset.mes === current.mes &&
    preset.meta === current.meta
  )?.[0] || 'entrada';
}

function getPolicyOptionMeta(code) {
  const labels = {
    entrada: {
      title: 'Entrada semanal',
      description: 'Editor preenche semanas. Mês fica calculado. Meta permanece manual.',
    },
    formula: {
      title: 'Fórmula',
      description: 'Linha protegida para o editor. Uso ideal para cálculos e referências.',
    },
    meta: {
      title: 'Só meta',
      description: 'Editor não preenche semanas nem mês. Só a meta manual fica aberta.',
    },
    mes_meta: {
      title: 'Mês e meta',
      description: 'Editor informa o consolidado do mês e a meta manualmente.',
    },
    tudo: {
      title: 'Tudo liberado',
      description: 'Semanas, mês e meta ficam abertos para edição.',
    },
    bloqueado: {
      title: 'Bloqueado',
      description: 'Nada fica digitável para o editor. Útil para linhas de apoio.',
    },
  };
  return labels[code] || labels.entrada;
}

function previewPolicySelection() {
  const select = document.getElementById('policy-select');
  const preview = document.getElementById('policy-preview');
  if (!select || !preview) return;
  const meta = getPolicyOptionMeta(select.value);
  preview.innerHTML = `<strong>${meta.title}</strong>${meta.description}`;
}

function closePolicyEditor() {
  policyEditorState = null;
  document.getElementById('policy-overlay')?.classList.remove('open');
}

function savePolicyEditor() {
  if (!canEditStructure() || !policyEditorState) return;
  const select = document.getElementById('policy-select');
  const preset = getIndicatorPolicyPresets()[select?.value || ''];
  if (!preset) return;

  applyGridChange(() => {
    const indicators = getIndicators(policyEditorState.areaId);
    const ind = indicators[policyEditorState.idx];
    if (!ind) return;
    ind.editableFields = { ...preset };
    if (!preset.mes && state.modoMes[modoMesK(policyEditorState.areaId, ind.id)] === 'manual') {
      state.modoMes[modoMesK(policyEditorState.areaId, ind.id)] = 'soma';
    }
    if (!preset.meta && state.modoMeta[modoMetaK(policyEditorState.areaId, ind.id)] === 'manual') {
      state.modoMeta[modoMetaK(policyEditorState.areaId, ind.id)] = 'soma';
    }
  });
  closePolicyEditor();
}

function configureIndicadorEdit(aId, idx) {
  if (!canEditStructure()) return;
  const ind = getIndicators(aId)[idx];
  if (!ind || isSpacerIndicator(ind)) return;

  policyEditorState = { areaId: aId, idx };
  const currentCode = getIndicatorPolicyCode(ind);
  const select = document.getElementById('policy-select');
  const label = document.getElementById('policy-current-label');
  if (select) select.value = currentCode;
  if (label) label.textContent = `Política atual: ${getIndicatorPolicyLabel(ind)}. Escolha como o editor poderá preencher esta linha.`;
  previewPolicySelection();
  document.getElementById('policy-overlay')?.classList.add('open');
}

function parseClipboardTable(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((row, idx, rows) => row !== '' || idx < rows.length - 1)
    .map(row => row.split('\t'));
}

function setGridCellRawValue(areaId, indId, col, rawValue) {
  const normalizedCol = normalizeGridCol(col);
  if (!normalizedCol) return false;
  const raw = String(rawValue ?? '');
  const ind = getIndicators(areaId).find(item => item.id === indId);
  if (!ind) return false;

  if (state.semanas.includes(normalizedCol)) {
    if (!canEditIndicatorSemanas(ind)) return false;
    state.dados[key(areaId, indId, normalizedCol)] = raw;
    return true;
  }

  if (normalizedCol === 'mes') {
    if (!canEditIndicatorMes(ind)) return false;
    state.modoMes[modoMesK(areaId, indId)] = 'manual';
    state.dadosMes[dadosMesK(areaId, indId)] = raw;
    return true;
  }

  if (normalizedCol === 'meta') {
    if (!canEditIndicatorMeta(ind)) return false;
    state.modoMeta[modoMetaK(areaId, indId)] = 'manual';
    state.dadosMeta[dadosMetaK(areaId, indId)] = raw;
    return true;
  }

  return false;
}

function handleGridPaste(event) {
  if (!canEditData()) return;
  const text = event.clipboardData?.getData('text/plain');
  if (!text || (!text.includes('\t') && !text.includes('\n') && !text.includes('\r'))) return;

  const startAreaId = event.target.dataset.areaId;
  const startIndId = event.target.dataset.indId;
  const startCol = normalizeGridCol(event.target.dataset.col);
  const startRowIdx = getGridRowIndex(startAreaId, startIndId);
  const startColIdx = getGridColIndex(startCol);
  if (startRowIdx < 0 || startColIdx < 0) return;

  const matrix = parseClipboardTable(text);
  if (!matrix.length) return;

  event.preventDefault();

  const rows = getEditableGridRows();
  let changed = false;
  matrix.forEach((cells, rowOffset) => {
    const row = rows[startRowIdx + rowOffset];
    if (!row) return;
    cells.forEach((cellValue, colOffset) => {
      const col = GRID_COLS[startColIdx + colOffset];
      if (!col) return;
      if (setGridCellRawValue(row.areaId, row.indId, col, cellValue)) {
        changed = true;
      }
    });
  });

  if (!changed) return;
  applyGridChange(() => {});
}

function handleGridInputPointerDown(event) {
  const ref = getGridCellRefFromInput(event.currentTarget);
  if (!ref) return;
  if (event.shiftKey && state.gridSelection?.anchor) {
    setGridSelection(state.gridSelection.anchor, ref);
  } else {
    setGridSelection(ref, ref);
  }
  updateGridSelectionUI();
}

function handleGridInputFocus(event) {
  const ref = getGridCellRefFromInput(event.currentTarget);
  if (!ref) return;
  if (state.gridSelection && isGridCellSelected(ref.areaId, ref.indId, ref.col)) {
    updateGridSelectionUI();
    return;
  }
  if (event.shiftKey && state.gridSelection?.anchor) {
    setGridSelection(state.gridSelection.anchor, ref);
  } else {
    setGridSelection(ref, ref);
  }
  updateGridSelectionUI();
}

function findNextEditableCellRef(areaId, indId, col) {
  const startRowIdx = getGridRowIndex(areaId, indId);
  const colKey = normalizeGridCol(col);
  if (startRowIdx < 0 || !colKey) return null;

  const rows = getEditableGridRows();
  for (let rowIdx = startRowIdx + 1; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const selector = `.cell-input[data-area-id="${row.areaId}"][data-ind-id="${row.indId}"][data-col="${colKey}"]`;
    const input = document.querySelector(`#table-body ${selector}`);
    if (input && !input.disabled) {
      return { areaId: row.areaId, indId: row.indId, col: colKey };
    }
  }
  return null;
}

function handleGridEnterNavigation(event) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const current = event.currentTarget;
  const nextRef = findNextEditableCellRef(current.dataset.areaId, current.dataset.indId, current.dataset.col);
  current.blur();
  if (nextRef) {
    window.setTimeout(() => {
      const selector = `.cell-input[data-area-id="${nextRef.areaId}"][data-ind-id="${nextRef.indId}"][data-col="${nextRef.col}"]`;
      document.querySelector(`#table-body ${selector}`)?.focus();
    }, 0);
  }
}

function handleDocumentCopy(event) {
  const active = document.activeElement;
  const isGridInput = active?.classList?.contains('cell-input') && active?.dataset?.areaId;
  if (!isGridInput) return;

  const bounds = getGridSelectionBounds();
  const isMultiCellSelection = !!bounds && (bounds.rowStart !== bounds.rowEnd || bounds.colStart !== bounds.colEnd);
  if (!isMultiCellSelection && typeof active.selectionStart === 'number' && typeof active.selectionEnd === 'number' && active.selectionStart !== active.selectionEnd) {
    return;
  }

  const text = buildGridClipboardText();
  if (!text) return;

  event.preventDefault();
  event.clipboardData?.setData('text/plain', text);
}

function getCellComment(commentKey) {
  return String(state.comentarios[commentKey] || '');
}

function applyCellCommentState(td, commentKey) {
  if (!td || !commentKey) return;
  const comment = getCellComment(commentKey).trim();
  td.classList.toggle('has-comment', !!comment);
  td.title = comment || '';
}

function openCellCommentEditor(areaId, indId, col, label) {
  const commentKey = comentarioK(areaId, indId, col);
  cellCommentEditorState = { areaId, indId, col, commentKey };
  const textarea = document.getElementById('cell-comment-text');
  const labelEl = document.getElementById('cell-comment-label');
  if (textarea) textarea.value = getCellComment(commentKey);
  if (labelEl) labelEl.textContent = label || 'Adicione uma observação para esta célula.';
  document.getElementById('cell-comment-overlay')?.classList.add('open');
  window.setTimeout(() => textarea?.focus(), 0);
}

function closeCellCommentEditor() {
  cellCommentEditorState = null;
  document.getElementById('cell-comment-overlay')?.classList.remove('open');
}

function saveCellComment() {
  if (!cellCommentEditorState || !canEditData()) return;
  const textarea = document.getElementById('cell-comment-text');
  const value = String(textarea?.value || '').trim();
  applyGridChange(() => {
    if (value) {
      state.comentarios[cellCommentEditorState.commentKey] = value;
    } else {
      delete state.comentarios[cellCommentEditorState.commentKey];
    }
  });
  closeCellCommentEditor();
}

function removeCellComment() {
  if (!cellCommentEditorState || !canEditData()) return;
  applyGridChange(() => {
    delete state.comentarios[cellCommentEditorState.commentKey];
  });
  closeCellCommentEditor();
}

function handleCellCommentContextMenu(event, areaId, indId, col, label) {
  event.preventDefault();
  if (!canEditData()) return;
  openCellCommentEditor(areaId, indId, col, label);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePersonName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeJsString(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/</g, '\\x3C')
    .replace(/>/g, '\\x3E');
}

function getDefaultReminderSettings() {
  return {
    id: null,
    enabled: false,
    subject_template: 'Lembrete RPS | {{mes}} {{ano}}',
    body_template: 'Olá, {{nome}}.\n\nLembramos do preenchimento dos indicadores da RPS.\n\nAcesse: {{link_app}}',
    recurrence: 'weekly',
    weekday: 1,
    time_hhmm: '11:00',
    timezone: 'America/Sao_Paulo',
    last_sent_at: null,
    last_sent_by: '',
    updated_at: null,
    updated_by: '',
  };
}

function normalizeReminderSettings(settings = {}) {
  const defaults = getDefaultReminderSettings();
  return {
    ...defaults,
    ...settings,
    weekday: Number(settings.weekday ?? defaults.weekday),
    enabled: !!settings.enabled,
    recurrence: settings.recurrence || defaults.recurrence,
    time_hhmm: settings.time_hhmm || defaults.time_hhmm,
    timezone: settings.timezone || defaults.timezone,
  };
}

function ensureReminderState() {
  state.reminder = normalizeReminderSettings(state.reminder || {});
  return state.reminder;
}

function getReminderAppUrl() {
  return APP_PUBLIC_URL;
}

function getFunctionInvokeUrl(functionName) {
  const cfg = window.SUPABASE_CONFIG || {};
  const baseUrl = String(cfg.url || '').replace(/\/+$/, '');
  return baseUrl ? `${baseUrl}/functions/v1/${functionName}` : '';
}

function formatDateTimeLabel(value) {
  if (!value) return 'Nunca enviado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStoredPersonName(profile = state.auth.profile) {
  return normalizePersonName(profile?.name || profile?.full_name || profile?.nome || '');
}

function getDisplayName(profile = state.auth.profile, fallbackEmail = state.auth.user?.email || '') {
  const rawName = getStoredPersonName(profile);
  if (rawName) return rawName;
  const email = normalizeEmail(fallbackEmail);
  return email ? email.split('@')[0] : '';
}

function getFirstName(name) {
  const normalized = normalizePersonName(name);
  if (!normalized) return '';
  const [firstName] = normalized.split(' ');
  return firstName || normalized;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function withAppUserMatcher(query, match, prefer = 'id') {
  const normalizedEmail = normalizeEmail(match?.email || '');
  if (prefer === 'email' && normalizedEmail) return query.eq('email', normalizedEmail);
  if (match.id) return query.eq('id', match.id);
  if (normalizedEmail) return query.eq('email', normalizedEmail);
  return query;
}

async function persistAppUserName(match, rawName) {
  const name = normalizePersonName(rawName);
  let lastError = null;

  for (const prefer of ['id', 'email']) {
    const { error } = await withAppUserMatcher(
      supabaseClient
        .from(APP_USERS_TABLE)
        .update({ name: name || null }),
      match,
      prefer
    );

    if (!error) {
      return { field: 'name', value: name || null, error: null };
    }

    lastError = error;
  }

  return { field: null, value: name || null, error: lastError };
}

function setLoginMessage(message, type = '') {
  const el = document.getElementById('login-message');
  if (!el) return;
  el.textContent = message;
  el.className = `login-message${type ? ` is-${type}` : ''}`;
}

function getAuthRateLimitMessage(error, actionLabel = 'enviar um novo email') {
  const code = String(error?.code || '').toLowerCase();
  const status = Number(error?.status || 0);
  const message = String(error?.message || '');
  const normalized = message.toLowerCase();
  const isRateLimited =
    code.includes('rate') ||
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('security purposes') ||
    normalized.includes('after') && normalized.includes('seconds') ||
    status === 429;

  if (!isRateLimited) return '';

  const secondsMatch = normalized.match(/after\s+(\d+)\s+seconds?/i);
  const waitLabel = secondsMatch ? ` Aguarde ${secondsMatch[1]}s e tente novamente.` : ' Aguarde alguns instantes e tente novamente.';
  return `Já existe uma solicitação recente para ${actionLabel}.${waitLabel}`;
}

function createClientTimeoutError(operationLabel, timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  const error = new Error(`${operationLabel} demorou mais de ${seconds}s para responder.`);
  error.code = 'client_timeout';
  error.timeoutMs = timeoutMs;
  return error;
}

function withClientTimeout(promise, timeoutMs, operationLabel) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(createClientTimeoutError(operationLabel, timeoutMs)), timeoutMs);
    }),
  ]);
}

function setLoginBusy(isBusy) {
  const submitBtn = document.getElementById('login-submit');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const confirmInput = document.getElementById('login-password-confirm');
  const isSignup = state.auth.mode === 'signup';
  if (submitBtn) {
    submitBtn.disabled = isBusy;
    submitBtn.innerHTML = isBusy
      ? `<i class="ti ti-loader-2"></i> ${isSignup ? 'Criando acesso...' : 'Entrando...'}` 
      : (isSignup ? '<i class="ti ti-user-plus"></i> Criar senha' : '<i class="ti ti-login-2"></i> Entrar');
  }
  if (emailInput) emailInput.disabled = isBusy;
  if (passwordInput) passwordInput.disabled = isBusy;
  if (confirmInput) confirmInput.disabled = isBusy;
}

function showEmailConfirmModal(email) {
  // Remove modal anterior se existir
  const existing = document.getElementById('email-confirm-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'email-confirm-modal';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:99999;
    display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.45); padding:24px;
  `;

  overlay.innerHTML = `
    <div style="
      background:#fff; border-radius:20px; padding:32px 28px;
      width:min(420px,100%); box-shadow:0 24px 64px rgba(0,0,0,0.18);
      text-align:center; position:relative;
    ">
      <div style="
        width:56px; height:56px; border-radius:50%;
        background:#E8F4EA; display:flex; align-items:center;
        justify-content:center; margin:0 auto 18px;
      ">
        <i class="ti ti-mail-check" style="font-size:28px; color:#2F6B3B;"></i>
      </div>
      <div style="font-size:18px; font-weight:700; color:#1a1a1a; margin-bottom:10px;">
        Confirme seu e-mail
      </div>
      <div style="font-size:14px; color:#666660; line-height:1.6; margin-bottom:8px;">
        Enviamos um link de confirmação para
      </div>
      <div style="
        font-size:14px; font-weight:600; color:#185FA5;
        background:#E6F1FB; border-radius:10px; padding:8px 14px;
        margin-bottom:18px; word-break:break-all;
      ">${email}</div>
      <div style="font-size:13px; color:#666660; line-height:1.6; margin-bottom:24px;">
        Abra o e-mail e clique no link para ativar seu acesso.<br>
        Depois, volte aqui e faça login normalmente.
      </div>
      <button onclick="document.getElementById('email-confirm-modal').remove()" style="
        background:#185FA5; color:#fff; border:none; border-radius:12px;
        padding:11px 28px; font-size:14px; font-weight:600;
        cursor:pointer; font-family:inherit; width:100%;
      ">
        <i class="ti ti-check"></i> Entendido
      </button>
      <div style="font-size:11px; color:#a0a09a; margin-top:14px;">
        Não recebeu? Verifique a caixa de spam ou solicite um novo acesso ao administrador.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
}

function showLoginScreen() {
  document.getElementById('login-shell')?.classList.remove('hidden');
  document.getElementById('app-shell')?.classList.add('hidden');
  closeAdminPanel();
}

function showAppShell() {
  document.getElementById('login-shell')?.classList.add('hidden');
  document.getElementById('app-shell')?.classList.remove('hidden');
}

function renderAuthHeader() {
  const userBadge = document.getElementById('user-badge');
  const adminBtn = document.getElementById('admin-btn');
  const addAreaBtn = document.getElementById('add-area-btn');
  const copyMonthConfigBtn = document.getElementById('copy-month-config-btn');
  const saveBtn = document.getElementById('save-btn');
  const reloadBtn = document.getElementById('reload-btn');
  const headerSub = document.getElementById('header-sub');
  if (!userBadge) return;
  const email = state.auth.user?.email || '';
  const role = state.auth.profile?.role || '';
  const displayName = getDisplayName();
  const firstName = getFirstName(displayName);
  userBadge.textContent = email ? `${displayName || email}${role ? ` · ${role}` : ''}` : '';
  if (headerSub) {
    headerSub.textContent = firstName
      ? `${getGreeting()}, ${firstName}!`
      : 'Acompanhamento de indicadores por área';
  }
  if (adminBtn) {
    adminBtn.classList.toggle('hidden', !isAdminUser());
  }
  if (addAreaBtn) {
    addAreaBtn.classList.toggle('hidden', !canEditStructure());
  }
  if (copyMonthConfigBtn) {
    copyMonthConfigBtn.classList.toggle('hidden', !canEditStructure());
  }
  if (saveBtn) {
    saveBtn.classList.toggle('hidden', !canEditData());
  }
  if (reloadBtn) {
    reloadBtn.classList.toggle('hidden', !state.auth.profile);
  }
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return String(password || '').trim().length >= 6;
}

function isAdminUser() {
  return state.auth.profile?.role === 'admin';
}

function canEditData() {
  return !!state.auth.profile && state.auth.profile.role !== 'viewer';
}

function isEditorUser() {
  return state.auth.profile?.role === 'editor';
}

function canEditStructure() {
  return isAdminUser();
}

function canEditRps() {
  return canEditData();
}

function getIndicatorEditableFields(ind) {
  return normalizeEditableFields(ind);
}

function canEditIndicatorLabel(ind) {
  return canEditStructure() && getIndicatorEditableFields(ind).label !== false;
}

function canEditIndicatorSemanas(ind) {
  if (isAggregateIndicator(ind) || isSpacerIndicator(ind)) return false;
  if (canEditStructure()) return true;
  return canEditData() && getIndicatorEditableFields(ind).semanas !== false;
}

function canEditIndicatorMes(ind) {
  if (isAggregateIndicator(ind) || isSpacerIndicator(ind)) return false;
  if (canEditStructure()) return true;
  return canEditData() && getIndicatorEditableFields(ind).mes === true;
}

function canEditIndicatorMeta(ind) {
  if (isAggregateIndicator(ind) || isSpacerIndicator(ind)) return false;
  if (canEditStructure()) return true;
  return canEditData() && getIndicatorEditableFields(ind).meta === true;
}

function getIndicatorPolicyLabel(ind) {
  const fields = getIndicatorEditableFields(ind);
  if (isSpacerIndicator(ind)) return 'Espaço';
  if (isAggregateIndicator(ind)) return 'Calculado';
  if (fields.semanas && fields.meta && !fields.mes) return 'Entrada semanal';
  if (!fields.semanas && !fields.mes && !fields.meta) return 'Bloqueado';
  if (!fields.semanas && !fields.mes && fields.meta) return 'Só meta';
  if (!fields.semanas && fields.mes && fields.meta) return 'Mês e meta';
  if (fields.semanas && fields.mes && fields.meta) return 'Tudo liberado';
  if (fields.semanas && !fields.mes && !fields.meta) return 'Só semanas';
  return 'Personalizado';
}

function hasFormulaCellValue(raw) {
  return typeof raw === 'string' && raw.trim().startsWith('=');
}

function isFormulaIndicatorRow(areaId, ind) {
  if (isAggregateIndicator(ind)) return true;
  return state.semanas.some(semana => hasFormulaCellValue(state.dados[key(areaId, ind.id, semana)]));
}

function setAdminMessage(message, type = '') {
  const el = document.getElementById('admin-message');
  if (!el) return;
  el.textContent = message;
  el.className = `login-message${type ? ` is-${type}` : ''}`;
}

function setReminderMessage(message, type = '') {
  const el = document.getElementById('reminder-message');
  if (!el) return;
  el.textContent = message;
  el.className = `login-message${type ? ` is-${type}` : ''}`;
}

function renderReminderScheduleOptions(recurrence = 'weekly', selectedValue = 1) {
  const select = document.getElementById('reminder-weekday');
  if (!select) return;
  if (recurrence === 'daily') {
    select.innerHTML = '<option value="0">Todos os dias</option>';
    select.value = '0';
    select.disabled = true;
    return;
  }

  select.disabled = false;

  if (recurrence === 'monthly') {
    select.innerHTML = Array.from({ length: 31 }, (_, index) => {
      const day = index + 1;
      return `<option value="${day}">Dia ${day}</option>`;
    }).join('');
    select.value = String(selectedValue || 1);
    return;
  }

  select.innerHTML = REMINDER_WEEKDAYS
    .map(option => `<option value="${option.value}">${option.label}</option>`)
    .join('');
  select.value = String(selectedValue ?? 1);
}

function renderReminderSettings() {
  const settings = ensureReminderState();
  const enabled = document.getElementById('reminder-enabled');
  const subject = document.getElementById('reminder-subject');
  const body = document.getElementById('reminder-body');
  const recurrence = document.getElementById('reminder-recurrence');
  const weekday = document.getElementById('reminder-weekday');
  const time = document.getElementById('reminder-time');
  const timezone = document.getElementById('reminder-timezone');
  const lastSent = document.getElementById('reminder-last-sent');
  const lastSentBy = document.getElementById('reminder-last-sent-by');

  if (enabled) enabled.checked = !!settings.enabled;
  if (subject) subject.value = settings.subject_template || '';
  if (body) body.value = settings.body_template || '';
  if (recurrence) recurrence.value = settings.recurrence || 'weekly';
  renderReminderScheduleOptions(settings.recurrence || 'weekly', settings.weekday ?? 1);
  if (weekday && !weekday.disabled) weekday.value = String(settings.weekday ?? 1);
  if (time) time.value = settings.time_hhmm || '11:00';
  if (timezone) timezone.value = settings.timezone || 'America/Sao_Paulo';
  if (lastSent) lastSent.textContent = formatDateTimeLabel(settings.last_sent_at);
  if (lastSentBy) lastSentBy.textContent = settings.last_sent_by || '-';
}

function collectReminderSettingsFromForm() {
  const current = ensureReminderState();
  return normalizeReminderSettings({
    ...current,
    enabled: !!document.getElementById('reminder-enabled')?.checked,
    subject_template: document.getElementById('reminder-subject')?.value?.trim() || '',
    body_template: document.getElementById('reminder-body')?.value || '',
    recurrence: document.getElementById('reminder-recurrence')?.value || 'weekly',
    weekday: Number(document.getElementById('reminder-weekday')?.value || 1),
    time_hhmm: document.getElementById('reminder-time')?.value || '11:00',
    timezone: document.getElementById('reminder-timezone')?.value || 'America/Sao_Paulo',
  });
}

function renderAuthMode() {
  const heading = document.getElementById('login-form-heading');
  const submitBtn = document.getElementById('login-submit');
  const modeBtn = document.getElementById('auth-mode-btn');
  const resetBtn = document.getElementById('reset-password-btn');
  const help = document.getElementById('auth-mode-help');
  const confirmWrap = document.getElementById('login-confirm-wrap');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const confirmInput = document.getElementById('login-password-confirm');
  const isSignup = state.auth.mode === 'signup';
  const isRecovery = state.auth.mode === 'recovery';

  if (heading) heading.textContent = isRecovery ? 'Redefinir senha' : (isSignup ? 'Primeiro acesso' : 'Entrar');
  if (submitBtn) {
    submitBtn.innerHTML = isRecovery
      ? '<i class="ti ti-key"></i> Atualizar senha'
      : (isSignup
        ? '<i class="ti ti-user-plus"></i> Criar senha'
        : '<i class="ti ti-login-2"></i> Entrar');
  }
  if (modeBtn) {
    modeBtn.textContent = isSignup ? 'Já tenho senha' : 'Primeiro acesso';
    modeBtn.classList.toggle('hidden', isRecovery);
  }
  if (resetBtn) {
    resetBtn.classList.toggle('hidden', isSignup || isRecovery);
  }
  if (help) {
    help.textContent = isRecovery
      ? 'Digite sua nova senha e confirme para concluir a recuperação.'
      : (isSignup
        ? 'Use um email previamente liberado pelo administrador para criar sua senha.'
        : 'Se seu email já foi liberado pelo administrador, use “Primeiro acesso” para criar sua senha.');
  }
  if (confirmWrap) confirmWrap.classList.toggle('hidden', !(isSignup || isRecovery));
  if (emailInput) {
    emailInput.disabled = isRecovery;
    emailInput.autocomplete = isRecovery ? 'email' : 'email';
  }
  if (passwordInput) {
    passwordInput.autocomplete = (isSignup || isRecovery) ? 'new-password' : 'current-password';
    passwordInput.placeholder = isRecovery ? 'Digite sua nova senha' : 'Digite sua senha';
  }
  if (!isSignup && !isRecovery && confirmInput) confirmInput.value = '';
}

function toggleAuthMode() {
  state.auth.mode = state.auth.mode === 'login' ? 'signup' : 'login';
  setLoginBusy(false);
  setLoginMessage(state.auth.mode === 'login'
    ? 'Entre com seu email e senha para acessar a RPS.'
    : 'Crie sua senha usando um email já autorizado.');
  renderAuthMode();
}

function getPasswordResetRedirectUrl() {
  return APP_PUBLIC_URL;
}

async function requestPasswordReset() {
  if (!supabaseClient) {
    setLoginMessage('Supabase não configurado para recuperação de senha.', 'error');
    return;
  }

  const email = document.getElementById('login-email')?.value.trim() || '';
  if (!validateEmail(email)) {
    setLoginMessage('Informe um email válido para receber o link de recuperação.', 'error');
    return;
  }

  setLoginBusy(true);
  setLoginMessage('Enviando email de recuperação...');
  try {
    const redirectTo = getPasswordResetRedirectUrl();
    const options = redirectTo ? { redirectTo } : undefined;
    const { error } = await withClientTimeout(
      supabaseClient.auth.resetPasswordForEmail(normalizeEmail(email), options),
      20000,
      'A recuperação de senha'
    );
    if (error) {
      const rateLimitMessage = getAuthRateLimitMessage(error, 'reenviar o email de recuperação');
      setLoginMessage(rateLimitMessage || error.message || 'Não foi possível enviar o email de recuperação.', 'error');
      return;
    }
    setLoginMessage('Email de recuperação enviado. Abra o link para redefinir sua senha.', 'success');
  } catch (error) {
    if (error?.code === 'client_timeout') {
      setLoginMessage('O envio do email demorou demais para responder. Revise o SMTP do Supabase e tente novamente.', 'error');
      return;
    }
    setLoginMessage(error?.message || 'Falha inesperada ao solicitar recuperação de senha.', 'error');
  } finally {
    setLoginBusy(false);
  }
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

function formatSyncTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${yy} - ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setSyncStatus(status, message, dirty = state.sync.dirty) {
  state.sync.status = status;
  if (status === 'ready' && /Sincronizado com /.test(message)) {
    state.sync.lastSuccessAt = state.sync.lastSuccessAt || formatSyncTimestamp();
  }
  const suffix = status === 'ready' && /Sincronizado com /.test(message) && state.sync.lastSuccessAt
    ? ` | ${state.sync.lastSuccessAt}`
    : '';
  state.sync.message = `${message}${suffix}`;
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


