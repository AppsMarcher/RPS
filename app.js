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
  auth: {
    user: null,
    checked: false,
    loadedUserId: null,
    profile: null,
    users: [],
    mode: 'login',
  },
  sync: {
    enabled: false,
    dirty: false,
    status: 'offline',
    message: 'Supabase não configurado',
    lastSuccessAt: '',
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
};

let lbKey = null;
let lbLabel = '';
let lbImageIdx = 0;
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
const ADMIN_EMAIL = 'ricardo@marcher.com.br';

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

function getDisplayName(profile = state.auth.profile, fallbackEmail = state.auth.user?.email || '') {
  const rawName = normalizePersonName(profile?.name || profile?.full_name || profile?.nome || '');
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

function setLoginMessage(message, type = '') {
  const el = document.getElementById('login-message');
  if (!el) return;
  el.textContent = message;
  el.className = `login-message${type ? ` is-${type}` : ''}`;
}

function setLoginBusy(isBusy) {
  const submitBtn = document.getElementById('login-submit');
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const isSignup = state.auth.mode === 'signup';
  if (submitBtn) {
    submitBtn.disabled = isBusy;
    submitBtn.innerHTML = isBusy
      ? `<i class="ti ti-loader-2"></i> ${isSignup ? 'Criando acesso...' : 'Entrando...'}` 
      : (isSignup ? '<i class="ti ti-user-plus"></i> Criar senha' : '<i class="ti ti-login-2"></i> Entrar');
  }
  if (emailInput) emailInput.disabled = isBusy;
  if (passwordInput) passwordInput.disabled = isBusy;
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

function setAdminMessage(message, type = '') {
  const el = document.getElementById('admin-message');
  if (!el) return;
  el.textContent = message;
  el.className = `login-message${type ? ` is-${type}` : ''}`;
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
  try {
    const href = window.location?.href || '';
    if (!/^https?:/i.test(href)) return null;
    const url = new URL(href);
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
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
    const { error } = await supabaseClient.auth.resetPasswordForEmail(normalizeEmail(email), options);
    if (error) {
      setLoginMessage(error.message || 'Não foi possível enviar o email de recuperação.', 'error');
      return;
    }
    setLoginMessage('Email de recuperação enviado. Abra o link para redefinir sua senha.', 'success');
  } catch (error) {
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

function initSupabase() {
  if (!hasSupabaseConfig()) {
    showLoginScreen();
    setLoginMessage('Supabase não configurado para autenticação.', 'error');
    state.sync.enabled = false;
    setSyncStatus('offline', 'Sincronização automática indisponível', false);
    return;
  }

  const cfg = window.SUPABASE_CONFIG;
  supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
  state.sync.enabled = true;
  setSyncStatus('ready', `Sincronização automática pronta para ${getPeriodoLabel()}`, false);
}

async function fetchAppUserByEmail(email) {
  if (!supabaseClient) return null;
  const normalized = normalizeEmail(email);
  const { data, error } = await supabaseClient
    .from(APP_USERS_TABLE)
    .select('*')
    .eq('email', normalized)
    .maybeSingle();

  if (error) return null;
  return data;
}

async function canStartFirstAccess(email) {
  if (!supabaseClient) return false;
  const normalized = normalizeEmail(email);
  const { data, error } = await supabaseClient.rpc('is_signup_allowed', {
    p_email: normalized,
  });
  if (error) return false;
  return !!data;
}

async function loadAdminUsers() {
  if (!supabaseClient || !isAdminUser()) return;
  const { data, error } = await supabaseClient
    .from(APP_USERS_TABLE)
    .select('*')
    .order('email', { ascending: true });

  if (error) {
    setAdminMessage('Não foi possível carregar os usuários autorizados.', 'error');
    return;
  }

  state.auth.users = data || [];
  renderAdminUsers();
}

function resetStateData() {
  state.areas = JSON.parse(JSON.stringify(AREAS));
  state.indicadores = {};
  state.unidades = {};
  state.dados = {};
  state.cellStyles = {};
  state.comentarios = {};
  state.dadosMes = {};
  state.dadosMeta = {};
  state.anexos = {};
  state.modoMes = {};
  state.modoMeta = {};
  state.focusIdx = null;
  state.presentIdx = 0;
  state.gridSelection = null;
}

function resetForSignedOut() {
  clearTimeout(saveTimer);
  closePresent();
  resetStateData();
  initData();
  renderAll();
}

function buildSnapshotPayload() {
  return {
    version: 2,
    areas: state.areas,
    indicadores: state.indicadores,
    unidades: state.unidades,
    dados: state.dados,
    cellStyles: state.cellStyles,
    comentarios: state.comentarios,
    dadosMes: state.dadosMes,
    dadosMeta: state.dadosMeta,
    anexos: state.anexos,
    modoMes: state.modoMes,
    modoMeta: state.modoMeta,
  };
}

function extractFormulaEntries() {
  return Object.fromEntries(
    Object.entries(state.dados).filter(([, raw]) =>
      typeof raw === 'string' && raw.trim().startsWith('=')
    )
  );
}

function buildStructureOnlyPayload() {
  return {
    version: 2,
    areas: JSON.parse(JSON.stringify(state.areas)),
    indicadores: JSON.parse(JSON.stringify(state.indicadores)),
    unidades: JSON.parse(JSON.stringify(state.unidades)),
    dados: extractFormulaEntries(),
    cellStyles: {},
    comentarios: {},
    dadosMes: {},
    dadosMeta: {},
    anexos: {},
    modoMes: JSON.parse(JSON.stringify(state.modoMes)),
    modoMeta: JSON.parse(JSON.stringify(state.modoMeta)),
  };
}

function previewCopyConfigSelection() {
  const monthSelect = document.getElementById('copy-config-month');
  const yearSelect = document.getElementById('copy-config-year');
  const preview = document.getElementById('copy-config-preview');
  if (!monthSelect || !yearSelect || !preview) return;
  const month = Number(monthSelect.value);
  const year = Number(yearSelect.value);
  if (!month || !year) return;
  preview.innerHTML = `<strong>Destino</strong>${MESES[month - 1]} ${year}. A estrutura e as fórmulas serão copiadas; os campos digitados, anexos e valores manuais do mês destino continuarão zerados.`;
}

function closeCopyConfigEditor() {
  copyConfigState = null;
  document.getElementById('copy-config-overlay')?.classList.remove('open');
}

function openCopyConfigEditor() {
  const monthSelect = document.getElementById('copy-config-month');
  const yearSelect = document.getElementById('copy-config-year');
  const label = document.getElementById('copy-config-current-label');
  if (!monthSelect || !yearSelect) return;

  monthSelect.innerHTML = MESES.map((mes, idx) => `<option value="${idx + 1}">${mes}</option>`).join('');

  const currentYear = state.ano;
  const years = [];
  for (let year = currentYear - 1; year <= currentYear + 3; year++) {
    years.push(`<option value="${year}">${year}</option>`);
  }
  yearSelect.innerHTML = years.join('');

  let targetMonth = state.mesIdx + 2;
  let targetYear = state.ano;
  if (targetMonth > 12) {
    targetMonth = 1;
    targetYear += 1;
  }

  monthSelect.value = String(targetMonth);
  yearSelect.value = String(targetYear);
  monthSelect.onchange = previewCopyConfigSelection;
  yearSelect.onchange = previewCopyConfigSelection;
  if (label) {
    label.textContent = `Origem: ${getPeriodoLabel()}. Escolha o mês e o ano que receberão a mesma configuração e fórmulas.`;
  }
  previewCopyConfigSelection();
  document.getElementById('copy-config-overlay')?.classList.add('open');
}

async function copyMonthConfiguration() {
  if (!canEditStructure()) return;
  if (!supabaseClient) {
    alert('A cópia de configuração entre meses depende da sincronização com o Supabase.');
    return;
  }
  openCopyConfigEditor();
}

async function confirmCopyMonthConfiguration() {
  if (!canEditStructure()) return;
  if (!supabaseClient) return;

  const month = Number(document.getElementById('copy-config-month')?.value);
  const year = Number(document.getElementById('copy-config-year')?.value);
  if (!month || !year) {
    alert('Escolha um mês e um ano válidos.');
    return;
  }

  if (year === state.ano && month === state.mesIdx + 1) {
    alert('Escolha um mês diferente do atual.');
    return;
  }

  if (state.sync.dirty) {
    const saved = await saveToCloud(true);
    if (!saved) {
      alert('Não foi possível salvar o mês atual antes de copiar a configuração.');
      return;
    }
  }

  const targetLabel = `${MESES[month - 1]} ${year}`;
  if (!confirm(`Copiar a configuração estrutural e as fórmulas de ${getPeriodoLabel()} para ${targetLabel}?\n\nIsso substitui a máscara do mês destino, mas não leva os dados preenchidos.`)) {
    return;
  }

  const payload = buildStructureOnlyPayload();
  const { error } = await supabaseClient
    .from(SUPABASE_TABLE)
    .upsert({
      ano: year,
      mes: month,
      payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'ano,mes' });

  if (error) {
    alert(error.message || 'Não foi possível copiar a configuração para o mês escolhido.');
    return;
  }

  closeCopyConfigEditor();
  alert(`Configuração copiada com sucesso para ${targetLabel}.`);
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
  state.cellStyles = payload.cellStyles || {};
  state.comentarios = payload.comentarios || {};
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
  renderAuthHeader();
  const pMonth = document.getElementById('p-month-label');
  if (pMonth) pMonth.textContent = getPeriodoLabel();
  renderHeader();
  renderBody();
  if (document.getElementById('present-overlay').classList.contains('open')) {
    renderPresentBody();
  }
  renderSyncStatus();
}

function openAdminPanel() {
  if (!isAdminUser()) return;
  document.getElementById('admin-overlay')?.classList.add('open');
  setAdminMessage('Cadastre os emails que poderão fazer primeiro acesso.');
  loadAdminUsers();
}

function closeAdminPanel() {
  document.getElementById('admin-overlay')?.classList.remove('open');
}

function renderAdminUsers() {
  const list = document.getElementById('admin-users-list');
  if (!list) return;

  const visibleUsers = state.auth.users.filter(user =>
    user.email === ADMIN_EMAIL || (user.active && user.can_access)
  );

  if (!visibleUsers.length) {
    list.innerHTML = '<div class="admin-empty">Nenhum usuário autorizado ainda.</div>';
    return;
  }

  const rows = visibleUsers.map(user => `
    <div class="admin-user-row">
      <div>
        <input
          class="admin-user-name-input"
          type="text"
          value="${escapeHtml(getDisplayName(user, user.email))}"
          placeholder="Nome do usuário"
          onchange="updateAppUserName('${user.id}', this.value)"
          ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
      </div>
      <div class="admin-user-email">${user.email}</div>
      <div>
        <select class="admin-select" onchange="updateAppUserRole('${user.id}', this.value)" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        </select>
      </div>
      <div>
        <label class="admin-check">
          <input type="checkbox" ${user.active ? 'checked' : ''} onchange="updateAppUserFlags('${user.id}', 'active', this.checked)" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <span>Ativo</span>
        </label>
      </div>
      <div>
        <label class="admin-check">
          <input type="checkbox" ${user.can_access ? 'checked' : ''} onchange="updateAppUserFlags('${user.id}', 'can_access', this.checked)" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <span>Acesso</span>
        </label>
      </div>
      <div class="admin-user-actions">
        <button class="row-action-btn row-action-remove" type="button" title="Revogar acesso" onclick="revokeAppUserAccess('${user.id}')" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <i class="ti ti-trash"></i>
        </button>
      </div>
    </div>
  `).join('');

  list.innerHTML = `
    <div class="admin-users-scroll">
      <div class="admin-user-row header">
        <div>Nome</div>
        <div>Email</div>
        <div>Perfil</div>
        <div>Ativo</div>
        <div>Acesso</div>
        <div>Ação</div>
      </div>
      ${rows}
    </div>
  `;
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

  state.sync.lastSuccessAt = formatSyncTimestamp();
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
    state.sync.lastSuccessAt = formatSyncTimestamp();
    setSyncStatus('ready', `Sem dados salvos para ${getPeriodoLabel()}`, false);
    if (!silent) scheduleSyncMessageReset();
    return true;
  }

  applySnapshotPayload(data.payload);
  renderAll();
  state.sync.lastSuccessAt = formatSyncTimestamp();
  setSyncStatus('ready', `Dados carregados: ${getPeriodoLabel()}`, false);
  if (!silent) scheduleSyncMessageReset();
  return true;
}

async function applyAuthSession(session) {
  state.auth.checked = true;
  state.auth.user = session?.user || null;

  if (state.auth.mode === 'recovery' && state.auth.user) {
    showLoginScreen();
    const emailInput = document.getElementById('login-email');
    if (emailInput) emailInput.value = state.auth.user.email || '';
    setLoginBusy(false);
    setLoginMessage('Defina sua nova senha para concluir a recuperação.');
    renderAuthMode();
    return;
  }

  if (!state.auth.user) {
    state.auth.loadedUserId = null;
    state.auth.profile = null;
    state.auth.users = [];
    resetForSignedOut();
    showLoginScreen();
    setLoginBusy(false);
    if (authPostLogoutMessage) {
      setLoginMessage(authPostLogoutMessage, 'error');
      authPostLogoutMessage = '';
    } else {
      setLoginMessage('Entre com seu email e senha para acessar a RPS.');
    }
    return;
  }

  const profile = await fetchAppUserByEmail(state.auth.user.email);
  if (!profile || !profile.active || !profile.can_access) {
    state.auth.profile = null;
    state.auth.users = [];
    setLoginBusy(false);
    authPostLogoutMessage = 'Seu email não está autorizado para acessar este app.';
    await supabaseClient.auth.signOut();
    return;
  }

  state.auth.profile = profile;

  showAppShell();
  setLoginBusy(false);
  setLoginMessage('Login realizado com sucesso.', 'success');
  renderAll();

  if (state.auth.loadedUserId !== state.auth.user.id && state.sync.enabled) {
    state.auth.loadedUserId = state.auth.user.id;
    await reloadFromCloud(true);
  }

  if (isAdminUser()) {
    await loadAdminUsers();
  }
}

function registerAuthListener() {
  if (!supabaseClient) return;
  if (authSubscription) {
    authSubscription.unsubscribe();
    authSubscription = null;
  }

  const { data } = supabaseClient.auth.onAuthStateChange((event, session) => {
    window.setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') {
        state.auth.mode = 'recovery';
        renderAuthMode();
      }
      applyAuthSession(session);
    }, 0);
  });

  authSubscription = data.subscription;
}

async function submitLogin(event) {
  event.preventDefault();
  if (!supabaseClient) {
    setLoginMessage('Supabase não configurado para autenticação.', 'error');
    return;
  }

  const email = document.getElementById('login-email')?.value.trim() || '';
  const password = document.getElementById('login-password')?.value || '';
  const emailNormalized = normalizeEmail(email);
  const isSignup = state.auth.mode === 'signup';
  const isRecovery = state.auth.mode === 'recovery';

  if (isRecovery) {
    const confirmPassword = document.getElementById('login-password-confirm')?.value || '';
    if (!validatePassword(password)) {
      setLoginMessage('A nova senha precisa ter pelo menos 6 caracteres.', 'error');
      return;
    }
    if (password !== confirmPassword) {
      setLoginMessage('A confirmação da senha não confere.', 'error');
      return;
    }

    setLoginBusy(true);
    setLoginMessage('Atualizando sua senha...');
    try {
      const { error } = await supabaseClient.auth.updateUser({ password });
      if (error) {
        setLoginMessage(error.message || 'Não foi possível atualizar sua senha.', 'error');
        return;
      }

      state.auth.mode = 'login';
      renderAuthMode();
      authPostLogoutMessage = 'Senha redefinida com sucesso. Faça login com a nova senha.';
      await supabaseClient.auth.signOut();
    } catch (error) {
      setLoginMessage(error?.message || 'Falha inesperada ao atualizar a senha.', 'error');
    } finally {
      setLoginBusy(false);
    }
    return;
  }

  if (!validateEmail(email)) {
    setLoginMessage('Informe um email válido.', 'error');
    return;
  }

  if (!validatePassword(password)) {
    setLoginMessage('A senha precisa ter pelo menos 6 caracteres.', 'error');
    return;
  }

  if (isSignup) {
    const confirmPassword = document.getElementById('login-password-confirm')?.value || '';
    if (password !== confirmPassword) {
      setLoginMessage('A confirmação da senha não confere.', 'error');
      return;
    }

    const signupAllowed = await canStartFirstAccess(emailNormalized);
    if (!signupAllowed) {
      setLoginMessage('Este email ainda não foi liberado pelo administrador.', 'error');
      return;
    }
  }

  setLoginBusy(true);
  setLoginMessage(isSignup ? 'Criando seu acesso...' : 'Validando credenciais...');

  try {
    if (isSignup) {
      const { data, error } = await supabaseClient.auth.signUp({
        email: emailNormalized,
        password,
      });

      if (error) {
        setLoginMessage(error.message || 'Não foi possível criar sua senha.', 'error');
        return;
      }

      if (!data.session) {
        setLoginMessage('Cadastro iniciado. Confirme o email, se o Supabase exigir confirmação.', 'success');
      } else {
        setLoginMessage('Senha criada com sucesso. Você já está autenticado.', 'success');
      }
      state.auth.mode = 'login';
      renderAuthMode();
      return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email: emailNormalized, password });
    if (error) {
      setLoginMessage(error.message || 'Email ou senha inválidos.', 'error');
      return;
    }
  } catch (error) {
    setLoginMessage(error?.message || 'Falha inesperada durante a autenticação.', 'error');
  } finally {
    setLoginBusy(false);
  }
}

async function submitAdminUser(event) {
  event.preventDefault();
  if (!supabaseClient || !isAdminUser()) return;

  const name = normalizePersonName(document.getElementById('admin-name')?.value);
  const email = normalizeEmail(document.getElementById('admin-email')?.value);
  const role = document.getElementById('admin-role')?.value || 'editor';
  const active = !!document.getElementById('admin-active')?.checked;
  const canAccess = !!document.getElementById('admin-can-access')?.checked;

  if (!validateEmail(email)) {
    setAdminMessage('Informe um email válido para liberar acesso.', 'error');
    return;
  }

  const { error } = await supabaseClient
    .from(APP_USERS_TABLE)
    .upsert({
      name: name || null,
      email,
      role,
      active,
      can_access: canAccess,
    }, { onConflict: 'email' });

  if (error) {
    setAdminMessage('Não foi possível salvar esse acesso.', 'error');
    return;
  }

  document.getElementById('admin-user-form')?.reset();
  document.getElementById('admin-role').value = 'editor';
  document.getElementById('admin-active').checked = true;
  document.getElementById('admin-can-access').checked = true;
  setAdminMessage('Acesso salvo. O usuário já pode usar “Primeiro acesso”.', 'success');
  await loadAdminUsers();
}

async function updateAppUserFlags(userId, field, value) {
  if (!supabaseClient || !isAdminUser()) return;
  const patch = field === 'active' ? { active: value } : { can_access: value };
  const { error } = await supabaseClient
    .from(APP_USERS_TABLE)
    .update(patch)
    .eq('id', userId);

  if (error) {
    setAdminMessage('Não foi possível atualizar esse usuário.', 'error');
    await loadAdminUsers();
    return;
  }

  setAdminMessage('Acesso atualizado com sucesso.', 'success');
  await loadAdminUsers();
}

async function updateAppUserName(userId, rawName) {
  if (!supabaseClient || !isAdminUser()) return;
  const name = normalizePersonName(rawName);
  const { error } = await supabaseClient
    .from(APP_USERS_TABLE)
    .update({ name: name || null })
    .eq('id', userId);

  if (error) {
    setAdminMessage('Não foi possível atualizar o nome desse usuário.', 'error');
    await loadAdminUsers();
    return;
  }

  state.auth.users = state.auth.users.map(item => (
    item.id === userId ? { ...item, name: name || null } : item
  ));
  if (state.auth.profile?.id === userId) {
    state.auth.profile = { ...state.auth.profile, name: name || null };
    renderAuthHeader();
  }
  setAdminMessage('Nome atualizado com sucesso.', 'success');
  renderAdminUsers();
}

async function updateAppUserRole(userId, role) {
  if (!supabaseClient || !isAdminUser()) return;
  const { error } = await supabaseClient
    .from(APP_USERS_TABLE)
    .update({ role })
    .eq('id', userId);

  if (error) {
    setAdminMessage('Não foi possível atualizar o perfil.', 'error');
    await loadAdminUsers();
    return;
  }

  setAdminMessage('Perfil atualizado com sucesso.', 'success');
  await loadAdminUsers();
}

async function revokeAppUserAccess(userId) {
  if (!supabaseClient || !isAdminUser()) return;
  const user = state.auth.users.find(item => item.id === userId);
  if (!user || user.email === ADMIN_EMAIL) return;

  const confirmed = confirm(`Revogar o acesso de ${user.email}?\n\nO registro será preservado no banco para rastreabilidade, mas ficará inativo e sem acesso ao app.`);
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from(APP_USERS_TABLE)
    .update({
      active: false,
      can_access: false,
    })
    .eq('id', userId);

  if (error) {
    setAdminMessage('Não foi possível revogar esse acesso.', 'error');
    await loadAdminUsers();
    return;
  }

  state.auth.users = state.auth.users.map(item => (
    item.id === userId
      ? { ...item, active: false, can_access: false }
      : item
  ));
  renderAdminUsers();
  setAdminMessage('Acesso revogado com sucesso. O histórico do usuário foi preservado.', 'success');
  await loadAdminUsers();
}

async function logout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
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
  let hasReference = false;
  let hasResolvedReferenceValue = false;

  expr = expr.replace(/\{([^}]+)\}/g, (_, refName) => {
    hasReference = true;
    const refInd = findIndicatorByRef(areaId, refName);
    if (!refInd) return '0';
    const val = calcWeekValue(areaId, refInd, semana, stack);
    if (val !== null) hasResolvedReferenceValue = true;
    return String(val ?? 0);
  });

  expr = expr.replace(/\b[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*\b/g, token => {
    const refInd = findIndicatorByRef(areaId, token);
    if (!refInd) return token;
    hasReference = true;
    const val = calcWeekValue(areaId, refInd, semana, stack);
    if (val !== null) hasResolvedReferenceValue = true;
    return String(val ?? 0);
  });

  if (hasReference && !hasResolvedReferenceValue) return null;

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

function getFocusedSemana(mode = 'grid') {
  const idx = mode === 'presentation' ? state.presentIdx : state.focusIdx;
  if (idx === null || idx === undefined) return null;
  return state.semanas[idx] || null;
}

function calcMes(aId, ind, options = {}) {
  if (isAggregateIndicator(ind)) {
    const vals = getChildIndicators(aId, ind.id)
      .map(child => calcMes(aId, child, options))
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
  if (modo === 'ultima') {
    const focusedSemana = options.focusedSemana ?? getFocusedSemana();
    if (focusedSemana) return calcWeekValue(aId, ind, focusedSemana);
    return vals[vals.length - 1];
  }
  return null;
}

function calcMeta(aId, ind, options = {}) {
  if (isAggregateIndicator(ind)) {
    const vals = getChildIndicators(aId, ind.id)
      .map(child => calcMeta(aId, child, options))
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
  if (modo === 'ultima') {
    const focusedSemana = options.focusedSemana ?? getFocusedSemana();
    if (focusedSemana) return calcWeekValue(aId, ind, focusedSemana);
    return vals[vals.length - 1];
  }
  return null;
}

function calcVar(ref, meta) {
  if (ref === null || meta === null || meta === 0) return null;
  return ((ref - meta) / Math.abs(meta)) * 100;
}

function calcVarDiff(ref, meta) {
  if (ref === null || meta === null) return null;
  return ref - meta;
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
  if (isAggregateIndicator(ind) || !canEditStructure()) return;
  applyGridChange(() => {
    const cur = state.modoMes[modoMesK(aId, ind.id)] || 'soma';
    const idx = MES_MODOS.findIndex(m => m.id === cur);
    state.modoMes[modoMesK(aId, ind.id)] = MES_MODOS[(idx + 1) % MES_MODOS.length].id;
  });
}

function cycleModoMeta(aId, ind) {
  if (isAggregateIndicator(ind) || !canEditStructure()) return;
  applyGridChange(() => {
    const cur = state.modoMeta[modoMetaK(aId, ind.id)] || 'manual';
    const idx = MES_MODOS.findIndex(m => m.id === cur);
    state.modoMeta[modoMetaK(aId, ind.id)] = MES_MODOS[(idx + 1) % MES_MODOS.length].id;
  });
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
  if (!canEditData()) return;
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
  th.className = 'vardiff-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-minus-vertical" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Variação`, 'vardiff');
  tr.appendChild(th);

  th = document.createElement('th');
  th.className = 'var-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-trending-up" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Variação %`, 'var');
  tr.appendChild(th);

  thead.appendChild(tr);
}

function renderBody() {
  const tbody = document.getElementById('table-body');
  captureRenderedCellStyles();
  tbody.innerHTML = '';
  const canEditRows = canEditStructure();
  const canFillData = canEditData();

  state.areas.forEach(area => {
    const aRow = document.createElement('tr');
    aRow.className = 'area-header-row';
    const aTd = document.createElement('td');
    aTd.colSpan = state.semanas.length + 5;
    aTd.innerHTML = `<span class="area-icon"><i class="ti ${area.icon}" style="font-size:14px;color:${area.cor}"></i>${area.nome}</span>`;
    aRow.appendChild(aTd);
    tbody.appendChild(aRow);

    getIndicators(area.id).forEach((ind, ii) => {
      if (isSpacerIndicator(ind)) {
        const spacerRow = document.createElement('tr');
        spacerRow.className = 'indicator-row spacer-row';
        const spacerTd = document.createElement('td');
        spacerTd.colSpan = state.semanas.length + 5;
        spacerTd.innerHTML = `<span class="spacer-row-actions">
          <button onclick="insertSpacerAt('${area.id}',${ii})"
            class="row-action-btn"
            title="Inserir espaço abaixo"
            style="visibility:${canEditRows ? 'visible' : 'hidden'}"><i class="ti ti-layout-rows"></i></button>
          <button onclick="removeIndicador('${area.id}',${ii})"
            class="row-action-btn row-action-remove"
            title="Excluir espaço"
            style="visibility:${canEditRows ? 'visible' : 'hidden'}">x</button>
        </span>`;
        spacerRow.appendChild(spacerTd);
        tbody.appendChild(spacerRow);
        return;
      }

      const row = document.createElement('tr');
      row.className = 'indicator-row';
      const unit = getUnit(area.id, ind);
      const isAggregate = isAggregateIndicator(ind);
      const isChild = !!ind.parentId;
      const canEditLabel = canEditIndicatorLabel(ind);
      const canEditSemanas = canEditIndicatorSemanas(ind);
      const canEditMes = canEditIndicatorMes(ind);
      const canEditMeta = canEditIndicatorMeta(ind);
      const policyLabel = getIndicatorPolicyLabel(ind);

      const tdL = document.createElement('td');
      tdL.innerHTML = `<span style="display:flex;align-items:center;gap:6px;justify-content:space-between">
        <span contenteditable="${canEditLabel}" title="${policyLabel}" style="flex:1;outline:none;padding:2px 3px 2px ${isChild ? '18px' : '3px'};border-radius:3px;font-weight:${isAggregate ? '600' : '400'};white-space:break-spaces"
          onblur="renameIndicador('${area.id}',${ii},this.textContent)"></span>
        <span style="display:inline-flex;align-items:center;gap:6px">
          <button onclick="configureIndicadorEdit('${area.id}',${ii})"
            class="row-action-btn"
            title="Configurar campos digitáveis"
            style="visibility:${canEditRows && !isAggregate ? 'visible' : 'hidden'}"><i class="ti ti-lock-cog"></i></button>
          <button onclick="insertIndicadorAt('${area.id}',${ii})"
            class="row-action-btn"
            title="Inserir linha abaixo"
            style="visibility:${canEditRows ? 'visible' : 'hidden'}"><i class="ti ti-plus"></i></button>
          <button onclick="removeIndicador('${area.id}',${ii})"
            class="row-action-btn row-action-remove"
            title="Excluir linha"
            style="visibility:${canEditRows ? 'visible' : 'hidden'}">x</button>
        </span>
      </span>`;
      tdL.querySelector('[contenteditable]')?.replaceChildren(document.createTextNode(ind.label));
      row.appendChild(tdL);

      state.semanas.forEach((s, si) => {
        const k = key(area.id, ind.id, s);
        const commentKey = comentarioK(area.id, ind.id, s);
        const tdC = document.createElement('td');
        if (state.focusIdx === si) tdC.className = 'focused-col';
        tdC.dataset.key = k;
        const ak = anexoKey(area.id, ind.id, s);
        const countAtt = getAttachmentCount(ak);
        const hasAtt = countAtt > 0;
        const previewAtt = getFirstImageAttachment(ak);
        const lbl = `${ind.label} - ${s}`;
        const unitCell = state.unidades[k] || 'R$';
        tdC.oncontextmenu = e => handleCellCommentContextMenu(e, area.id, ind.id, s, `Comentário: ${ind.label} / ${s}`);

        const wrap = document.createElement('div');
        wrap.className = 'cell-wrap';
        const inp = document.createElement('input');
        inp.className = 'cell-input';
        inp.placeholder = '-';
        inp.dataset.key = k;
        inp.dataset.areaId = area.id;
        inp.dataset.indId = ind.id;
        inp.dataset.col = s;
        const rawVal = state.dados[k] || '';
        const calcVal = calcWeekValue(area.id, ind, s);
        inp.value = isAggregate ? formatNum(calcVal, unitCell) : (rawVal ? formatVal(rawVal, unitCell) : '');
        inp.disabled = !canEditSemanas;
        inp.onfocus = e => {
          handleGridInputFocus(e);
          inp.value = state.dados[inp.dataset.key] || '';
          inp.select();
        };
        inp.onblur = e => {
          const rv = e.target.value;
          applyGridChange(() => {
            state.dados[e.target.dataset.key] = rv;
          });
          e.target.value = rv ? formatVal(rv, unitCell) : '';
        };
        inp.onkeydown = e => {
          handleGridEnterNavigation(e);
        };
        inp.onpaste = handleGridPaste;
        inp.onpointerdown = handleGridInputPointerDown;

        const us = document.createElement('span');
        us.className = 'unit-tag';
        us.textContent = unitCell;
        us.title = canEditRows ? 'Alterar unidade' : unitCell;
        us.onclick = () => {
          if (!canEditRows) return;
          applyGridChange(() => {
            const c = UNIDADES.indexOf(state.unidades[k] || 'R$');
            state.unidades[k] = UNIDADES[(c + 1) % UNIDADES.length];
            state.semanas.forEach(col => {
              state.unidades[key(area.id, ind.id, col)] = state.unidades[k];
            });
          });
          us.textContent = state.unidades[k];
        };

        const cb = document.createElement('button');
        cb.className = 'clip-btn' + (hasAtt ? ' has-img' : '');
        cb.title = hasAtt ? 'Adicionar ou atualizar anexos' : 'Anexar arquivos';
        cb.innerHTML = `<i class="ti ti-paperclip"></i>${hasAtt ? `<span class="clip-count">${countAtt}</span>` : ''}`;
        if (previewAtt) {
          cb.onmouseenter = e => showTooltip(e, previewAtt, lbl);
          cb.onmouseleave = hideTooltip;
        }
        cb.onclick = () => {
          if (!canFillData) return;
          triggerUpload(ak, lbl);
        };

        wrap.appendChild(inp);
        wrap.appendChild(us);
        wrap.appendChild(cb);
        applySavedCellStyle(k, tdC, wrap, inp);
        applyCellCommentState(tdC, commentKey);
        tdC.appendChild(wrap);
        row.appendChild(tdC);
      });

      const tdMes = document.createElement('td');
      tdMes.className = 'mes-cell';
      applyCellCommentState(tdMes, comentarioK(area.id, ind.id, 'mes'));
      tdMes.oncontextmenu = e => handleCellCommentContextMenu(e, area.id, ind.id, 'mes', `Comentário: ${ind.label} / Mês`);
      const modoMesObj = getModoMesObj(area.id, ind);
      const valMes = calcMes(area.id, ind);
      const mWrap = document.createElement('div');
      mWrap.className = 'calc-cell-wrap';

      if (!isAggregate && modoMesObj.id === 'manual' && canEditMes) {
        const inp2 = document.createElement('input');
        inp2.className = 'cell-input';
        inp2.style.textAlign = 'right';
        inp2.placeholder = '-';
        inp2.disabled = !canEditMes;
        inp2.dataset.areaId = area.id;
        inp2.dataset.indId = ind.id;
        inp2.dataset.col = 'mes';
        const rawMes = state.dadosMes[dadosMesK(area.id, ind.id)] || '';
        inp2.value = rawMes ? formatVal(rawMes, unit) : '';
        inp2.onfocus = e => {
          handleGridInputFocus(e);
          inp2.value = state.dadosMes[dadosMesK(area.id, ind.id)] || '';
          inp2.select();
        };
        inp2.onblur = e => {
          const rv = e.target.value;
          applyGridChange(() => {
            state.dadosMes[dadosMesK(area.id, ind.id)] = rv;
          });
          e.target.value = rv ? formatVal(rv, unit) : '';
        };
        inp2.onkeydown = e => {
          handleGridEnterNavigation(e);
        };
        inp2.onpaste = handleGridPaste;
        inp2.onpointerdown = handleGridInputPointerDown;
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
      mBtn.style.visibility = isAggregate || !canEditRows ? 'hidden' : 'visible';
      mBtn.onclick = () => cycleModoMes(area.id, ind);
      mWrap.appendChild(mBtn);
      tdMes.appendChild(mWrap);
      row.appendChild(tdMes);

      const tdMeta = document.createElement('td');
      tdMeta.className = 'meta-cell';
      applyCellCommentState(tdMeta, comentarioK(area.id, ind.id, 'meta'));
      tdMeta.oncontextmenu = e => handleCellCommentContextMenu(e, area.id, ind.id, 'meta', `Comentário: ${ind.label} / Meta`);
      const modoMetaObj = getModoMetaObj(area.id, ind);
      const valMeta = calcMeta(area.id, ind);
      const mtWrap = document.createElement('div');
      mtWrap.className = 'calc-cell-wrap';

      if (!isAggregate && modoMetaObj.id === 'manual' && canEditMeta) {
        const inp3 = document.createElement('input');
        inp3.className = 'cell-input';
        inp3.style.textAlign = 'right';
        inp3.placeholder = '-';
        inp3.disabled = !canEditMeta;
        inp3.dataset.areaId = area.id;
        inp3.dataset.indId = ind.id;
        inp3.dataset.col = 'meta';
        const rawMeta = state.dadosMeta[dadosMetaK(area.id, ind.id)] || '';
        inp3.value = rawMeta ? formatVal(rawMeta, unit) : '';
        inp3.onfocus = e => {
          handleGridInputFocus(e);
          inp3.value = state.dadosMeta[dadosMetaK(area.id, ind.id)] || '';
          inp3.select();
        };
        inp3.onblur = e => {
          const rv = e.target.value;
          applyGridChange(() => {
            state.dadosMeta[dadosMetaK(area.id, ind.id)] = rv;
          });
          e.target.value = rv ? formatVal(rv, unit) : '';
        };
        inp3.onkeydown = e => {
          handleGridEnterNavigation(e);
        };
        inp3.onpaste = handleGridPaste;
        inp3.onpointerdown = handleGridInputPointerDown;
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
      mtBtn.style.visibility = isAggregate || !canEditRows ? 'hidden' : 'visible';
      mtBtn.onclick = () => cycleModoMeta(area.id, ind);
      mtWrap.appendChild(mtBtn);
      tdMeta.appendChild(mtWrap);
      row.appendChild(tdMeta);

      const tdVarDiff = document.createElement('td');
      tdVarDiff.className = 'vardiff-cell';
      const vv = calcVarDiff(valMes, valMeta);
      if (vv === null) {
        tdVarDiff.innerHTML = `<span class="var-neu">-</span>`;
      } else {
        const cls = vv > 0 ? 'var-pos' : vv < 0 ? 'var-neg' : 'var-neu';
        const ic = vv > 0 ? 'ti-trending-up' : vv < 0 ? 'ti-trending-down' : 'ti-minus';
        tdVarDiff.innerHTML = `<span class="${cls}" style="display:flex;align-items:center;justify-content:center;gap:3px">
          <i class="ti ${ic}" style="font-size:12px"></i>${formatNum(vv, unit)}</span>`;
      }
      row.appendChild(tdVarDiff);

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
    addTd.colSpan = state.semanas.length + 5;
    addTd.innerHTML = `<div style="display:${canEditRows ? 'flex' : 'none'};align-items:center;gap:8px">
      <button class="add-btn" style="width:auto;padding-left:20px" onclick="addIndicador('${area.id}')">
        <i class="ti ti-plus" style="font-size:11px;vertical-align:-1px"></i> adicionar indicador</button>
      <button class="add-btn" style="width:auto;padding-left:0" onclick="addSpacer('${area.id}')">
        <i class="ti ti-layout-rows" style="font-size:11px;vertical-align:-1px"></i> adicionar espaço</button>
    </div>`;
    addRow.appendChild(addTd);
    tbody.appendChild(addRow);
  });
  updateGridSelectionUI();
}

function getCellStyleSnapshot(td, wrap, inp) {
  return {
    tdExtraClasses: getExtraClassNames(td, ['focused-col']),
    tdStyle: td.getAttribute('style') || '',
    wrapExtraClasses: getExtraClassNames(wrap, ['cell-wrap']),
    wrapStyle: wrap.getAttribute('style') || '',
    inputExtraClasses: getExtraClassNames(inp, ['cell-input']),
    inputStyle: inp.getAttribute('style') || '',
  };
}

function hasCellStyleSnapshot(snapshot) {
  if (!snapshot) return false;
  return !!(
    snapshot.tdExtraClasses ||
    snapshot.tdStyle ||
    snapshot.wrapExtraClasses ||
    snapshot.wrapStyle ||
    snapshot.inputExtraClasses ||
    snapshot.inputStyle
  );
}

function getExtraClassNames(el, baseClasses) {
  return [...el.classList].filter(cls => !baseClasses.includes(cls)).join(' ');
}

function captureRenderedCellStyles() {
  const inputs = document.querySelectorAll('#table-body .cell-input[data-key]');
  inputs.forEach(inp => {
    const k = inp.dataset.key;
    if (!k) return;
    const wrap = inp.closest('.cell-wrap');
    const td = inp.closest('td');
    if (!wrap || !td) return;
    const snapshot = getCellStyleSnapshot(td, wrap, inp);
    if (hasCellStyleSnapshot(snapshot)) {
      state.cellStyles[k] = snapshot;
    } else {
      delete state.cellStyles[k];
    }
  });
}

function applySavedCellStyle(k, td, wrap, inp) {
  const snapshot = state.cellStyles[k];
  if (!snapshot) return;
  if (snapshot.tdExtraClasses) td.classList.add(...snapshot.tdExtraClasses.split(/\s+/).filter(Boolean));
  if (snapshot.wrapExtraClasses) wrap.classList.add(...snapshot.wrapExtraClasses.split(/\s+/).filter(Boolean));
  if (snapshot.inputExtraClasses) inp.classList.add(...snapshot.inputExtraClasses.split(/\s+/).filter(Boolean));

  if (snapshot.tdStyle) td.setAttribute('style', snapshot.tdStyle);
  if (snapshot.wrapStyle) wrap.setAttribute('style', snapshot.wrapStyle);
  if (snapshot.inputStyle) inp.setAttribute('style', snapshot.inputStyle);
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
  const laser = document.getElementById('present-laser');
  if (laser) laser.style.opacity = '0';
  presentLaserVisible = false;
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
  const focusedSemana = getFocusedSemana('presentation');
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
  th.className = 'vardiff-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-minus-vertical" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Variação`, 'vardiff');
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
    aTd.colSpan = state.semanas.length + 5;
    aTd.innerHTML = `<span class="area-icon"><i class="ti ${area.icon}" style="font-size:14px;color:${area.cor}"></i>${area.nome}</span>`;
    aRow.appendChild(aTd);
    tbody.appendChild(aRow);

    getIndicators(area.id).forEach(ind => {
      if (isSpacerIndicator(ind)) {
        const spacerRow = document.createElement('tr');
        spacerRow.className = 'indicator-row spacer-row';
        const spacerTd = document.createElement('td');
        spacerTd.colSpan = state.semanas.length + 5;
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

      const valMes = calcMes(area.id, ind, { focusedSemana });
      const valMeta = calcMeta(area.id, ind, { focusedSemana });
      const vv = calcVarDiff(valMes, valMeta);
      const vp = calcVar(valMes, valMeta);

      const tdMes = document.createElement('td');
      tdMes.className = 'mes-cell';
      tdMes.innerHTML = `<div class="present-cell-wrap"><span class="present-cell-val">${formatNum(valMes, unit)}</span></div>`;
      row.appendChild(tdMes);

      const tdMeta = document.createElement('td');
      tdMeta.className = 'meta-cell';
      tdMeta.innerHTML = `<div class="present-cell-wrap"><span class="present-cell-val p-meta-val">${formatNum(valMeta, unit)}</span></div>`;
      row.appendChild(tdMeta);

      const tdVarDiff = document.createElement('td');
      tdVarDiff.className = 'vardiff-cell';
      if (vv === null) {
        tdVarDiff.innerHTML = `<div class="present-cell-wrap"><span class="p-var-neu">-</span></div>`;
      } else {
        const cls = vv > 0 ? 'p-var-pos' : vv < 0 ? 'p-var-neg' : 'p-var-neu';
        const ic = vv > 0 ? 'ti-trending-up' : vv < 0 ? 'ti-trending-down' : 'ti-minus';
        tdVarDiff.innerHTML = `<div class="present-cell-wrap"><span class="${cls}"><i class="ti ${ic}" style="font-size:11px"></i>${formatNum(vv, unit)}</span></div>`;
      }
      row.appendChild(tdVarDiff);

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

function updatePresentLaserPosition(event) {
  const overlay = document.getElementById('present-overlay');
  const laser = document.getElementById('present-laser');
  if (!overlay || !laser || !overlay.classList.contains('open')) return;
  laser.style.left = `${event.clientX}px`;
  laser.style.top = `${event.clientY}px`;
  if (!presentLaserVisible) {
    laser.style.opacity = '1';
    presentLaserVisible = true;
  }
}

function hidePresentLaser() {
  const laser = document.getElementById('present-laser');
  if (!laser) return;
  laser.style.opacity = '0';
  presentLaserVisible = false;
}

function renameIndicador(aId, idx, novo) {
  if (!canEditStructure()) return;
  if (!String(novo || '').trim()) return;
  applyGridChange(() => {
    getIndicators(aId)[idx].label = novo;
  });
}

function removeIndicatorData(aId, indId) {
  state.semanas.forEach(col => {
    const cellKey = key(aId, indId, col);
    delete state.dados[cellKey];
    delete state.unidades[cellKey];
    delete state.cellStyles[cellKey];
    delete state.comentarios[comentarioK(aId, indId, col)];
    delete state.anexos[anexoKey(aId, indId, col)];
  });
  delete state.comentarios[comentarioK(aId, indId, 'mes')];
  delete state.comentarios[comentarioK(aId, indId, 'meta')];
  delete state.modoMes[modoMesK(aId, indId)];
  delete state.modoMeta[modoMetaK(aId, indId)];
  delete state.dadosMes[dadosMesK(aId, indId)];
  delete state.dadosMeta[dadosMetaK(aId, indId)];
}

function addIndicador(aId) {
  if (!canEditStructure()) return;
  getIndicators(aId).push(normalizeIndicator({ label:'Novo indicador', id:`novo_indicador_${Date.now()}` }));
  initData();
  renderBody();
  markDirty();
}

function insertIndicadorAt(aId, idx) {
  if (!canEditStructure()) return;
  applyGridChange(() => {
    const indicators = getIndicators(aId);
    const insertIdx = Math.max(0, Math.min(indicators.length, idx + 1));
    indicators.splice(insertIdx, 0, normalizeIndicator({
      label: 'Novo indicador',
      id: `novo_indicador_${Date.now()}`,
    }));
    initData();
  });
}

function addSpacer(aId) {
  if (!canEditStructure()) return;
  getIndicators(aId).push(normalizeIndicator({ label:'', id:`spacer_${Date.now()}`, type:'spacer' }));
  initData();
  renderBody();
  markDirty();
}

function insertSpacerAt(aId, idx) {
  if (!canEditStructure()) return;
  applyGridChange(() => {
    const indicators = getIndicators(aId);
    const insertIdx = Math.max(0, Math.min(indicators.length, idx + 1));
    indicators.splice(insertIdx, 0, normalizeIndicator({
      label: '',
      id: `spacer_${Date.now()}`,
      type: 'spacer',
    }));
    initData();
  });
}

function removeIndicador(aId, idx) {
  if (!canEditStructure()) return;
  const indicators = getIndicators(aId);
  const target = indicators[idx];
  const idsToRemove = [target.id, ...getChildIndicators(aId, target.id).map(child => child.id)];
  state.indicadores[aId] = indicators.filter(ind => !idsToRemove.includes(ind.id));
  idsToRemove.forEach(indId => removeIndicatorData(aId, indId));
  renderBody();
  markDirty();
}

function addArea() {
  if (!canEditStructure()) return;
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
  renderAuthHeader();
}

function exportData() {
  const rows = [['Área','Indicador',...state.semanas,'Mês','Meta','Variação','Variação%'].join('\t')];
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
      const vv = calcVarDiff(mes, meta);
      const vp = calcVar(mes, meta);
      rows.push([
        a.nome,
        ind.label,
        ...vals,
        mes !== null ? formatNum(mes, unit) : '',
        meta !== null ? formatNum(meta, unit) : '',
        vv !== null ? formatNum(vv, unit) : '',
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
  document.addEventListener('copy', handleDocumentCopy);
  const presentOverlay = document.getElementById('present-overlay');
  if (presentOverlay) {
    presentOverlay.addEventListener('mousemove', updatePresentLaserPosition);
    presentOverlay.addEventListener('mouseleave', hidePresentLaser);
  }
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', submitLogin);
  }
  const adminUserForm = document.getElementById('admin-user-form');
  if (adminUserForm) {
    adminUserForm.addEventListener('submit', submitAdminUser);
  }

  showLoginScreen();
  setLoginMessage('Entre com seu email e senha para acessar a RPS.');
  renderAuthMode();
  loadColumnWidths();
  initData();
  initSupabase();
  if (!supabaseClient) return;

  registerAuthListener();
  renderAll();

  const { data } = await supabaseClient.auth.getSession();
  await applyAuthSession(data.session);
  if (!state.auth.user) {
    document.getElementById('login-email')?.focus();
  }
}

bootstrap();


