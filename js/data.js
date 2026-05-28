// --- Motor de fórmulas estilo Excel -------------------------------------------
//
// Sintaxe suportada (separador de argumentos: ponto-e-vírgula):
//
//   Funções:
//     SOMA(a;b;c;...)          soma os argumentos
//     MÉDIA(a;b;c;...)         média dos argumentos não nulos
//     MÍNIMO(a;b;c;...)        menor valor
//     MÁXIMO(a;b;c;...)        maior valor
//     ARRED(número;casas)      arredonda para N casas decimais
//     ABS(número)              valor absoluto
//     SE(cond;v_verd;v_falso)  condicional (retorna número ou texto simples)
//     SEERRO(expr;fallback)    retorna fallback se expr der erro ou null
//
//   Referências a indicadores (mesma área):
//     NomeIndicador            valor da semana corrente do indicador
//     {Nome Com Espaços}       idem, para nomes com espaços ou caracteres especiais
//
//   Referências a colunas da linha corrente:
//     S1  S2  S3  S4  S5      valor digitado naquela semana específica
//     MES  META               valor consolidado do mês / meta da linha
//
//   Referências a outra área:
//     area.NomeIndicador       ex: comercial.Faturamento
//
//   Operadores:  + - * / ^ ( )  e comparações  > < >= <= = <>
//
//   Retrocompatibilidade: {NomeIndicador} continua funcionando.
//
// Perfis de acesso:
//   - Admin    ? pode digitar e ver fórmulas livremente em qualquer célula
//   - Editor   ? vê o RESULTADO calculado (célula desabilitada se política = fórmula)
//   - Viewer   ? sempre só leitura (sem inputs)
// -----------------------------------------------------------------------------

const FORMULA_FUNCTIONS = {
  SOMA:   args => args.reduce((a, b) => a + b, 0),
  MÉDIA:  args => args.reduce((a, b) => a + b, 0) / args.length,
  MINIMO: args => Math.min(...args),
  MÍNIMO: args => Math.min(...args),
  MAXIMO: args => Math.max(...args),
  MÁXIMO: args => Math.max(...args),
  ABS:    args => Math.abs(args[0]),
  ARRED:  args => {
    const casas = args[1] !== undefined ? Math.round(args[1]) : 0;
    return parseFloat(args[0].toFixed(casas));
  },
};

// Tokenizer simples para separar argumentos respeitando parênteses aninhados
function splitFormulaArgs(str) {
  const args = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(' ) { depth++; cur += ch; }
    else if (ch === ')') { depth--; cur += ch; }
    else if (ch === ';' && depth === 0) { args.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  if (cur.trim() !== '') args.push(cur.trim());
  return args;
}

// Resolve o valor de uma coluna (S1-S5, MES, META) para a linha corrente
function resolveColRef(colToken, areaId, indObj, semana, stack) {
  const t = colToken.toUpperCase();
  if (t === 'MES')  return calcMes(areaId, indObj);
  if (t === 'META') return calcMeta(areaId, indObj);
  // S1..S5 — se for a semana da coluna corrente usa calcWeekValue para suportar
  // fórmulas aninhadas; caso contrário lê o dado direto para evitar recursão
  if (/^S[1-5]$/.test(t)) {
    const targetSemana = t; // ex: 'S1'
    if (targetSemana === semana) return null; // evita auto-referência
    return calcWeekValue(areaId, indObj, targetSemana, new Set(stack));
  }
  return undefined; // não é referência de coluna
}

// Resolve "area.Indicador" — cross-area reference
function resolveCrossAreaRef(token, semana, stack) {
  const dot = token.indexOf('.');
  if (dot < 0) return undefined;
  const areaSlug = slugifyLabel(token.slice(0, dot));
  const indSlug  = slugifyLabel(token.slice(dot + 1));
  const area = state.areas.find(a => slugifyLabel(a.nome) === areaSlug || a.id === areaSlug);
  if (!area) return undefined;
  const refInd = getIndicators(area.id).find(i => slugifyLabel(i.label) === indSlug);
  if (!refInd) return undefined;
  return calcWeekValue(area.id, refInd, semana, stack);
}

// Avalia uma expressão já limpa (números, operadores, parênteses)
function evalArithmetic(expr) {
  // Substitui ^ por ** para potenciação, converte <> para !=
  const safe = expr
    .replace(/\^/g, '**')
    .replace(/<>/g, '!=')
    .replace(/=/g, '==')
    .replace(/!===/g, '!==')  // corrige triplo após substituição dupla
    .replace(/====/g, '===');
  if (!/^[\d+\-*/().!<>=&| \t\n]+$/.test(safe)) return null;
  try {
    const v = Function('"use strict"; return (' + safe + ');')();
    return Number.isFinite(v) ? v : (v === true ? 1 : v === false ? 0 : null);
  } catch (_) { return null; }
}

// Avalia recursivamente a fórmula ou sub-expressão
function evalFormulaExpr(expr, areaId, indObj, semana, stack, depth) {
  if (depth > 20) return null; // evita recursão infinita
  expr = expr.trim();

  // String literal entre aspas ? retorna como texto (usado no SE)
  if (/^"[^"]*"$/.test(expr)) return expr.slice(1, -1);

  // Número literal
  const num = parseFloat(expr.replace(',', '.'));
  if (!isNaN(num) && String(num) === expr.replace(',', '.')) return num;

  // SE(cond; v_verd; v_falso) — tratado antes do loop de funções
  if (/^SE\s*\(/i.test(expr)) {
    const inner = expr.replace(/^SE\s*\(/i, '').replace(/\)$/, '');
    const parts = splitFormulaArgs(inner);
    if (parts.length < 2) return null;
    const cond = evalFormulaExpr(parts[0], areaId, indObj, semana, stack, depth + 1);
    if (cond === null) return null;
    const branch = (typeof cond === 'string' ? cond !== '' && cond !== '0' : !!cond)
      ? parts[1] : (parts[2] || '"0"');
    return evalFormulaExpr(branch, areaId, indObj, semana, stack, depth + 1);
  }

  // SEERRO(expr; fallback)
  if (/^SEERRO\s*\(/i.test(expr)) {
    const inner = expr.replace(/^SEERRO\s*\(/i, '').replace(/\)$/, '');
    const parts = splitFormulaArgs(inner);
    if (parts.length < 2) return null;
    const tried = evalFormulaExpr(parts[0], areaId, indObj, semana, stack, depth + 1);
    return tried !== null ? tried : evalFormulaExpr(parts[1], areaId, indObj, semana, stack, depth + 1);
  }

  // Funções: NOME(arg1;arg2;...)
  const fnMatch = expr.match(/^([A-ZÀ-Ÿ_][A-ZÀ-Ÿ0-9_ÁÉÍÓÚÃÕÂÊÎÔÛÇÀÈÌÒÙ]*)\s*\((.+)\)$/i);
  if (fnMatch) {
    const fnName = fnMatch[1].toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove acentos para lookup
      .normalize('NFC');
    const rawArgs = splitFormulaArgs(fnMatch[2]);
    const resolvedArgs = rawArgs.map(a => evalFormulaExpr(a, areaId, indObj, semana, stack, depth + 1));
    if (resolvedArgs.some(v => v === null)) return null;
    const numArgs = resolvedArgs.map(Number).filter(Number.isFinite);
    if (!numArgs.length) return null;

    // Lookup com e sem acentos
    const fnKey = Object.keys(FORMULA_FUNCTIONS).find(k =>
      k === fnName ||
      k.normalize('NFD').replace(/[\u0300-\u036f]/g,'') === fnName
    );
    if (!fnKey) return null;
    const result = FORMULA_FUNCTIONS[fnKey](numArgs);
    return Number.isFinite(result) ? result : null;
  }

  // Referência entre chaves: {Nome do indicador}
  const bracketRef = expr.match(/^\{([^}]+)\}$/);
  if (bracketRef) {
    const refInd = findIndicatorByRef(areaId, bracketRef[1]);
    if (!refInd) return null;
    return calcWeekValue(areaId, refInd, semana, stack);
  }

  // Referências de coluna: S1, S2, MES, META
  const colVal = resolveColRef(expr, areaId, indObj, semana, stack);
  if (colVal !== undefined) return colVal;

  // Referência cross-área: area.Indicador
  const crossVal = resolveCrossAreaRef(expr, semana, stack);
  if (crossVal !== undefined) return crossVal;

  // Referência a indicador pelo nome (sem chaves)
  const refInd = findIndicatorByRef(areaId, expr);
  if (refInd) return calcWeekValue(areaId, refInd, semana, stack);

  // Expressão aritmética composta — substitui referências e avalia
  let built = expr;
  let hasRef = false;
  let hasResolved = false;

  // {Nome} dentro de expressão
  built = built.replace(/\{([^}]+)\}/g, (_, name) => {
    hasRef = true;
    const ind2 = findIndicatorByRef(areaId, name);
    if (!ind2) return '0';
    const v = calcWeekValue(areaId, ind2, semana, stack);
    if (v !== null) hasResolved = true;
    return String(v ?? 0);
  });

  // Tokens de coluna dentro de expressão (S1, S2, MES, META)
  built = built.replace(/\b(S[1-5]|MES|META)\b/gi, tok => {
    hasRef = true;
    const v = resolveColRef(tok, areaId, indObj, semana, stack);
    if (v !== null && v !== undefined) hasResolved = true;
    return String(v ?? 0);
  });

  // Referências cross-área dentro de expressão
  built = built.replace(/\b([A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*)\.([A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_ ]*)\b/g, (_, a, i) => {
    hasRef = true;
    const v = resolveCrossAreaRef(`${a}.${i}`, semana, stack);
    if (v !== null && v !== undefined) hasResolved = true;
    return String(v ?? 0);
  });

  // Tokens de indicador por nome
  built = built.replace(/\b([A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_]*)\b/g, tok => {
    const ind2 = findIndicatorByRef(areaId, tok);
    if (!ind2) return tok;
    hasRef = true;
    const v = calcWeekValue(areaId, ind2, semana, stack);
    if (v !== null) hasResolved = true;
    return String(v ?? 0);
  });

  if (hasRef && !hasResolved) return null;

  return evalArithmetic(built);
}

function evaluateFormula(raw, areaId, semana, stack, indObj) {
  let expr = String(raw || '').trim();
  if (!expr.startsWith('=')) return null;
  expr = expr.slice(1).trim();
  return evalFormulaExpr(expr, areaId, indObj || null, semana, stack, 0);
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
    const formulaVal = evaluateFormula(raw, aId, semana, stack, ind);
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

function getStoragePublicUrl(bucket, path) {
  if (!supabaseClient || !bucket || !path) return '';
  const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || '';
}

function normalizeStoredAttachment(att, fallbackId = '') {
  if (!att) return null;
  if (typeof att === 'string') {
    return {
      id: fallbackId || `legacy_${Date.now()}`,
      name: 'imagem',
      type: 'image/*',
      url: att,
      isImage: true,
      bucket: null,
      path: null,
    };
  }

  const bucket = att.bucket || null;
  const path = att.path || null;
  const derivedUrl = att.url || getStoragePublicUrl(bucket, path);
  return {
    id: att.id || fallbackId || `att_${Date.now()}`,
    name: att.name || 'arquivo',
    type: att.type || '',
    isImage: !!att.isImage || (att.type || '').startsWith('image/'),
    bucket,
    path,
    url: derivedUrl,
  };
}

function getAttachments(ak) {
  const raw = state.anexos[ak];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((att, index) => normalizeStoredAttachment(att, `${ak}_${index}`)).filter(Boolean);
  if (typeof raw === 'string') {
    return [normalizeStoredAttachment(raw, `legacy_${ak}`)].filter(Boolean);
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

function isPdfAttachment(att) {
  return getExt(att?.name || '') === 'pdf' || (att?.type || '') === 'application/pdf';
}

function buildAttachmentRecord(file, storagePath) {
  const type = file.type || '';
  const ext = getExt(file.name);
  const isImage = type.startsWith('image/') || ['png','jpg','jpeg','gif','webp','bmp','svg'].includes(ext);
  const bucket = ATTACHMENTS_BUCKET;
  return {
    id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name || 'arquivo',
    type,
    bucket,
    path: storagePath,
    url: getStoragePublicUrl(bucket, storagePath),
    isImage,
  };
}

function sanitizeFilename(name = '') {
  const ext = getExt(name);
  const baseName = String(name || 'arquivo')
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'arquivo';
  return ext ? `${baseName}.${ext}` : baseName;
}

function buildAttachmentStoragePath(ak, file) {
  const safeKey = slugifyLabel(ak).replace(/_+/g, '/');
  const period = `${state.ano}/${String(state.mesIdx + 1).padStart(2, '0')}`;
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${period}/${safeKey}/${stamp}_${sanitizeFilename(file.name)}`;
}

async function uploadAttachmentToStorage(ak, file) {
  if (!supabaseClient) {
    throw new Error('Supabase não configurado para anexos.');
  }

  const storagePath = buildAttachmentStoragePath(ak, file);
  const { error } = await supabaseClient.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    throw new Error(error.message || 'Falha ao enviar anexo para o Storage.');
  }

  return buildAttachmentRecord(file, storagePath);
}

async function deleteAttachmentFromStorage(att) {
  if (!supabaseClient || !att?.bucket || !att?.path) return;
  const { error } = await supabaseClient.storage.from(att.bucket).remove([att.path]);
  if (error) {
    throw new Error(error.message || 'Falha ao excluir anexo do Storage.');
  }
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

function getLightboxElement() {
  return document.getElementById('lightbox');
}

function isPresentModeOpen() {
  return document.getElementById('present-overlay')?.classList.contains('open');
}

function canDeleteAttachmentsInUi() {
  return canEditData() && !isPresentModeOpen();
}

function setAttachmentManagerMessage(message, type = '') {
  const el = document.getElementById('attachment-manager-message');
  if (!el) return;
  el.textContent = message;
  el.className = `login-message${type ? ` is-${type}` : ''}`;
}

function openAttachmentManager(ak, lbl) {
  if (!canEditData()) return;
  attachmentManagerState = { ak, lbl };
  const title = document.getElementById('attachment-manager-title');
  if (title) title.textContent = lbl;
  document.getElementById('attachment-manager-input').value = '';
  renderAttachmentManagerList();
  setAttachmentManagerMessage('Selecione um ou mais arquivos para anexar.');
  document.getElementById('attachment-manager-overlay')?.classList.add('open');
}

function closeAttachmentManager() {
  document.getElementById('attachment-manager-overlay')?.classList.remove('open');
  attachmentManagerState = null;
}

function renderAttachmentManagerList() {
  const list = document.getElementById('attachment-manager-list');
  if (!list || !attachmentManagerState) return;
  const items = getAttachments(attachmentManagerState.ak);
  if (!items.length) {
    list.innerHTML = '<div class="admin-empty">Nenhum arquivo anexado nesta célula.</div>';
    return;
  }

  const rows = items.map(att => `
    <div class="attachment-manager-row">
      <div class="attachment-manager-main">
        ${isPdfAttachment(att) ? `<div class="attachment-pdf-thumb"><iframe src="${att.url}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH" title="${att.name}"></iframe></div>` : ''}
        <div class="attachment-manager-name">${att.name}</div>
      </div>
      <div class="attachment-manager-type">${getExt(att.name) || (isImageAttachment(att) ? 'imagem' : 'arquivo')}</div>
      <div class="attachment-manager-actions">
        <a class="attach-link-btn attachment-manager-open" href="${att.url}" target="_blank" rel="noopener noreferrer">Visualizar</a>
        <button class="lb-btn lb-btn-remove" type="button" onclick="confirmRemoveManagedAttachment('${att.id}','${att.name.replace(/'/g, "\\'")}')"><i class="ti ti-trash"></i> Excluir</button>
      </div>
    </div>
  `).join('');

  list.innerHTML = `
    <div class="attachment-manager-row header">
      <div>Arquivo</div>
      <div>Tipo</div>
      <div>Ação</div>
    </div>
    ${rows}
  `;
}

function confirmRemoveManagedAttachment(attId, attName) {
  if (!attachmentManagerState) return;
  const confirmed = confirm(`Excluir o anexo "${attName}"?\n\nEssa ação remove o arquivo da tela e do dado sincronizado deste mês.`);
  if (!confirmed) return;
  removeManagedAttachment(attId);
}

async function removeManagedAttachment(attId) {
  if (!attachmentManagerState) return;
  const currentItems = getAttachments(attachmentManagerState.ak);
  const target = currentItems.find(att => att.id === attId);
  if (!target) return;

  setAttachmentManagerMessage('Excluindo anexo...');
  try {
    await deleteAttachmentFromStorage(target);
    setAttachments(attachmentManagerState.ak, currentItems.filter(att => att.id !== attId));
    renderAttachmentManagerList();
    renderBody();
    markDirty();
    setAttachmentManagerMessage('Anexo excluído com sucesso.', 'success');
  } catch (error) {
    setAttachmentManagerMessage(`Não foi possível excluir o anexo. Detalhe: ${error?.message || 'erro desconhecido'}`, 'error');
  }
}

async function confirmAttachmentUpload() {
  if (!attachmentManagerState) return;
  const input = document.getElementById('attachment-manager-input');
  const files = Array.from(input?.files || []);
  if (!files.length) {
    setAttachmentManagerMessage('Selecione pelo menos um arquivo para enviar.', 'error');
    return;
  }

  setAttachmentManagerMessage('Enviando arquivos...');
  try {
    const newItems = await Promise.all(files.map(file => uploadAttachmentToStorage(attachmentManagerState.ak, file)));
    setAttachments(attachmentManagerState.ak, [...getAttachments(attachmentManagerState.ak), ...newItems]);
    renderAttachmentManagerList();
    renderBody();
    markDirty();
    input.value = '';
    setAttachmentManagerMessage('Arquivos anexados com sucesso.', 'success');
  } catch (error) {
    setAttachmentManagerMessage(`Não foi possível enviar os arquivos. Detalhe: ${error?.message || 'erro desconhecido'}`, 'error');
  }
}

function getCurrentLightboxImage() {
  const imgs = getImageAttachments(lbKey);
  if (!imgs.length) return null;
  return imgs[Math.min(lbImageIdx, imgs.length - 1)] || null;
}

function syncLightboxHost() {
  const lightbox = getLightboxElement();
  const presentOverlay = document.getElementById('present-overlay');
  if (!lightbox || !presentOverlay) return;
  const targetParent = presentOverlay.classList.contains('open') ? presentOverlay : document.body;
  if (lightbox.parentElement !== targetParent) {
    targetParent.appendChild(lightbox);
  }
}

function openLightbox(ak, lbl) {
  lbKey = ak;
  lbLabel = lbl;
  lbImageIdx = 0;
  lbZoom = 1;
  syncLightboxHost();
  document.getElementById('lb-label').textContent = lbl;
  renderLightbox();
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  getLightboxElement()?.classList.remove('open');
  lbKey = null;
  lbLabel = '';
  lbImageIdx = 0;
  lbZoom = 1;
  syncLightboxHost();
}

async function removeAttachment(ak, id) {
  if (!canDeleteAttachmentsInUi()) return;
  const currentItems = getAttachments(ak);
  const target = currentItems.find(att => att.id === id);
  if (!target) return;
  await deleteAttachmentFromStorage(target);
  const next = currentItems.filter(att => att.id !== id);
  setAttachments(ak, next);
  if (!next.length) {
    closeLightbox();
  } else {
    lbImageIdx = Math.min(lbImageIdx, Math.max(getImageAttachments(ak).length - 1, 0));
    renderLightbox();
  }
  renderBody();
  markDirty();
}

async function confirmRemoveAttachment(ak, id, label = 'este anexo') {
  if (!canDeleteAttachmentsInUi()) return;
  const confirmed = confirm(`Excluir ${label}?\n\nEssa ação remove o anexo da tela e do dado sincronizado deste mês.`);
  if (!confirmed) return;
  try {
    await removeAttachment(ak, id);
  } catch (error) {
    alert(`Não foi possível excluir o anexo. Detalhe: ${error?.message || 'erro desconhecido'}`);
  }
}

function confirmRemoveCurrentAttachment() {
  const current = getCurrentLightboxImage();
  if (!current || !lbKey) return;
  confirmRemoveAttachment(lbKey, current.id, `a imagem "${current.name}"`);
}

function lightboxNav(delta) {
  const imgs = getImageAttachments(lbKey);
  if (!imgs.length) return;
  lbImageIdx = (lbImageIdx + delta + imgs.length) % imgs.length;
  lbZoom = 1;
  renderLightbox();
}

function resetLightboxZoom() {
  lbZoom = 1;
  renderLightbox();
}

function lightboxZoom(delta) {
  lbZoom = Math.max(0.6, Math.min(4, Number((lbZoom + delta).toFixed(2))));
  renderLightbox();
}

function renderLightbox() {
  const preview = document.getElementById('attach-preview');
  const docsWrap = document.getElementById('attach-docs');
  const imgs = getImageAttachments(lbKey);
  const docs = getDocumentAttachments(lbKey);
  const canDelete = canDeleteAttachmentsInUi();

  preview.className = 'attach-preview';
  if (imgs.length) {
    const current = imgs[Math.min(lbImageIdx, imgs.length - 1)];
    preview.innerHTML = `<div class="attach-stage">
      <div class="attach-stage-main">
        <div class="attach-stage-image-wrap">
          <img src="${current.url}" alt="${current.name}" style="transform:scale(${lbZoom})">
        </div>
      </div>
      <div class="attach-stage-bar">
        <div class="attach-stage-meta">${lbImageIdx + 1} de ${imgs.length} imagem(ns) · ${current.name}</div>
        <div class="attach-stage-nav">
          ${canDelete ? `<button class="lb-btn lb-btn-remove" onclick="confirmRemoveAttachment('${lbKey}','${current.id}','a imagem &quot;${current.name.replace(/"/g, '&quot;')}&quot;')"><i class="ti ti-trash"></i> Excluir imagem</button>` : ''}
          ${imgs.length > 1 ? '<button class="lb-btn" onclick="lightboxNav(-1)"><i class="ti ti-arrow-left"></i> Anterior</button>' : ''}
          ${imgs.length > 1 ? '<button class="lb-btn" onclick="lightboxNav(1)">Próxima <i class="ti ti-arrow-right"></i></button>' : ''}
        </div>
      </div>
    </div>`;
  } else {
    preview.className = 'attach-preview empty';
    preview.innerHTML = 'Sem imagens nesta célula.';
  }

  if (!docs.length) {
    docsWrap.innerHTML = '';
    docsWrap.classList.add('empty');
    return;
  }

  docsWrap.classList.remove('empty');
  const docItems = docs.map(att => `<div class="attach-doc-item">
        <div class="attach-doc-main">
          ${isPdfAttachment(att) ? `<div class="attach-doc-preview"><iframe src="${att.url}#toolbar=0&navpanes=0&scrollbar=0&page=1&view=FitH" title="${att.name}"></iframe></div>` : ''}
          <span class="attach-doc-icon"><i class="ti ${guessDocIcon(att)}"></i></span>
          <div style="min-width:0">
            <div class="attach-doc-name">${att.name}</div>
            <div class="attach-doc-type">${getExt(att.name) || 'arquivo'}</div>
          </div>
        </div>
        <div class="attach-doc-actions">
          <a class="attach-link-btn" href="${att.url}" target="_blank" rel="noopener noreferrer">Visualizar</a>
          ${canDelete ? `<button class="lb-btn lb-btn-remove" type="button" onclick="confirmRemoveAttachment('${lbKey}','${att.id}','o anexo &quot;${att.name.replace(/"/g, '&quot;')}&quot;')"><i class="ti ti-trash"></i> Excluir</button>` : ''}
        </div>
      </div>`).join('');

  docsWrap.innerHTML = `<div class="attach-section-title">Documentos</div>
    <div class="attach-doc-list">${docItems}</div>`;
}

let pendKey = null;
let pendLbl = null;
const fileInput = document.getElementById('file-input');

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length || !pendKey) return;
  Promise.all(files.map(file => uploadAttachmentToStorage(pendKey, file))).then(newItems => {
    setAttachments(pendKey, [...getAttachments(pendKey), ...newItems]);
    renderBody();
    markDirty();
  }).catch(error => {
    alert(`Não foi possível enviar os anexos. Detalhe: ${error?.message || 'erro desconhecido'}`);
  });
  fileInput.value = '';
});

document.addEventListener('keydown', event => {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox?.classList.contains('open')) return;
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'ArrowLeft') lightboxNav(-1);
  if (event.key === 'ArrowRight') lightboxNav(1);
  if (event.key === '+' || event.key === '=') lightboxZoom(0.2);
  if (event.key === '-') lightboxZoom(-0.2);
  if (event.key === '0') resetLightboxZoom();
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


