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

let backupRestoreState = {
  entries: [],
  selectedDate: '',
  loading: false,
  restoring: false,
};

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

async function loadReminderSettings() {
  if (!supabaseClient || !isAdminUser()) return;
  const { data, error } = await supabaseClient
    .from(APP_REMINDER_TABLE)
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    state.reminder = getDefaultReminderSettings();
    renderReminderSettings();
    setReminderMessage('Não foi possível carregar a configuração de lembretes.', 'error');
    return;
  }

  state.reminder = normalizeReminderSettings(data || {});
  renderReminderSettings();
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

function cloneSnapshotValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeSnapshotPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    version: Number(source.version) || 2,
    areas: Array.isArray(source.areas) ? cloneSnapshotValue(source.areas) : JSON.parse(JSON.stringify(AREAS)),
    indicadores: source.indicadores && typeof source.indicadores === 'object' ? cloneSnapshotValue(source.indicadores) : {},
    unidades: source.unidades && typeof source.unidades === 'object' ? cloneSnapshotValue(source.unidades) : {},
    dados: source.dados && typeof source.dados === 'object' ? cloneSnapshotValue(source.dados) : {},
    cellStyles: source.cellStyles && typeof source.cellStyles === 'object' ? cloneSnapshotValue(source.cellStyles) : {},
    comentarios: source.comentarios && typeof source.comentarios === 'object' ? cloneSnapshotValue(source.comentarios) : {},
    dadosMes: source.dadosMes && typeof source.dadosMes === 'object' ? cloneSnapshotValue(source.dadosMes) : {},
    dadosMeta: source.dadosMeta && typeof source.dadosMeta === 'object' ? cloneSnapshotValue(source.dadosMeta) : {},
    anexos: source.anexos && typeof source.anexos === 'object' ? cloneSnapshotValue(source.anexos) : {},
    modoMes: source.modoMes && typeof source.modoMes === 'object' ? cloneSnapshotValue(source.modoMes) : {},
    modoMeta: source.modoMeta && typeof source.modoMeta === 'object' ? cloneSnapshotValue(source.modoMeta) : {},
  };
}

function setSyncBasePayload(payload) {
  state.sync.basePayload = normalizeSnapshotPayload(payload);
}

function getSyncBasePayload() {
  return normalizeSnapshotPayload(state.sync.basePayload);
}

function buildDefaultSnapshotShape() {
  const indicadores = {};
  Object.entries(INDICADORES_DEFAULT).forEach(([areaId, items]) => {
    indicadores[areaId] = items.map((item, idx) => normalizeIndicator(item, idx));
  });

  return {
    areas: JSON.parse(JSON.stringify(AREAS)),
    indicadores,
  };
}

function normalizeAreasForShape(areas) {
  return (Array.isArray(areas) ? areas : []).map(area => ({
    id: String(area?.id || ''),
    nome: String(area?.nome || ''),
    icon: String(area?.icon || ''),
    cor: String(area?.cor || ''),
  }));
}

function normalizeIndicadoresForShape(indicadores) {
  const source = indicadores && typeof indicadores === 'object' ? indicadores : {};
  return Object.fromEntries(
    Object.entries(source).map(([areaId, items]) => [
      areaId,
      (Array.isArray(items) ? items : []).map((item, idx) => {
        const normalized = normalizeIndicator(item, idx);
        return {
          id: String(normalized.id || ''),
          label: String(normalized.label || ''),
          parentId: normalized.parentId || null,
          aggregate: normalized.aggregate || null,
          type: normalized.type || 'item',
          editableFields: normalizeEditableFields(normalized),
        };
      }),
    ])
  );
}

function isDefaultSnapshotShape(payload) {
  const normalized = normalizeSnapshotPayload(payload);
  const defaults = buildDefaultSnapshotShape();
  return areSnapshotValuesEqual(
    normalizeAreasForShape(normalized.areas),
    normalizeAreasForShape(defaults.areas)
  ) && areSnapshotValuesEqual(
    normalizeIndicadoresForShape(normalized.indicadores),
    normalizeIndicadoresForShape(defaults.indicadores)
  );
}

function hasMeaningfulSnapshotContent(payload) {
  const normalized = normalizeSnapshotPayload(payload);
  const hasNonEmptyMapValue = map => Object.values(map || {}).some(value => {
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== null && value !== undefined && value !== false;
  });

  return hasNonEmptyMapValue(normalized.dados) ||
    hasNonEmptyMapValue(normalized.dadosMes) ||
    hasNonEmptyMapValue(normalized.dadosMeta) ||
    hasNonEmptyMapValue(normalized.comentarios) ||
    hasNonEmptyMapValue(normalized.cellStyles) ||
    hasNonEmptyMapValue(normalized.anexos);
}

function shouldProtectRemoteSnapshot(basePayload, remotePayload, localPayload) {
  if (basePayload) return false;
  if (!remotePayload) return false;
  if (!isDefaultSnapshotShape(localPayload)) return false;
  if (!isDefaultSnapshotShape(remotePayload)) {
    return !hasMeaningfulSnapshotContent(localPayload);
  }
  return false;
}

function getDraftOwnerKey() {
  return state.auth.user?.id || state.auth.user?.email || 'anonymous';
}

function getLocalDraftStorageKey(year = state.ano, month = state.mesIdx + 1) {
  return `${LOCAL_DRAFT_PREFIX}:${getDraftOwnerKey()}:${year}:${month}`;
}

function loadLocalDraft(year = state.ano, month = state.mesIdx + 1) {
  try {
    const raw = localStorage.getItem(getLocalDraftStorageKey(year, month));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.payload) return null;
    return {
      savedAt: parsed.savedAt || null,
      payload: normalizeSnapshotPayload(parsed.payload),
    };
  } catch (error) {
    return null;
  }
}

function persistLocalDraft(payload = buildSnapshotPayload()) {
  try {
    localStorage.setItem(
      getLocalDraftStorageKey(),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        payload: normalizeSnapshotPayload(payload),
      })
    );
  } catch (error) {
    // Ignora falhas de quota/storage para não bloquear a edição.
  }
}

function clearLocalDraft(year = state.ano, month = state.mesIdx + 1) {
  try {
    localStorage.removeItem(getLocalDraftStorageKey(year, month));
  } catch (error) {
    // Sem ação: remoção local é apenas melhor esforço.
  }
}

function recoverLocalDraftIfNeeded(remotePayload, remoteUpdatedAt = null) {
  const draft = loadLocalDraft();
  if (!draft) return false;

  const normalizedRemote = remotePayload ? normalizeSnapshotPayload(remotePayload) : null;
  if (normalizedRemote && areSnapshotValuesEqual(draft.payload, normalizedRemote)) {
    clearLocalDraft();
    return false;
  }

  const draftSavedAt = draft.savedAt ? Date.parse(draft.savedAt) : NaN;
  const remoteSavedAt = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : NaN;
  const draftHasContent = hasMeaningfulSnapshotContent(draft.payload);
  const remoteHasContent = hasMeaningfulSnapshotContent(normalizedRemote);

  // Se o banco tem snapshot mais novo (ou o rascunho local nem traz conteúdo real),
  // não deixamos um draft velho sobrescrever/esconder os dados remotos em tela.
  if (normalizedRemote) {
    if (remoteHasContent && !draftHasContent) {
      clearLocalDraft();
      return false;
    }
    if (Number.isFinite(remoteSavedAt) && Number.isFinite(draftSavedAt) && remoteSavedAt >= draftSavedAt) {
      clearLocalDraft();
      return false;
    }
  }

  applySnapshotPayload(draft.payload);
  setSyncBasePayload(remotePayload || null);
  renderAll();
  setSyncStatus('dirty', `Rascunho local recuperado para ${getPeriodoLabel()}`, true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveToCloud(true);
  }, 400);
  return true;
}

function flushPendingChanges() {
  const visibleInputChanged = syncVisibleInputsToState();
  if (visibleInputChanged) {
    state.sync.dirty = true;
  }
  if (!state.sync.enabled || !state.sync.dirty) return;
  persistLocalDraft(buildSnapshotPayload());
  saveToCloud(true);
}

function areSnapshotValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getSnapshotEntry(obj, key) {
  if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
    return { exists: true, value: obj[key] };
  }
  return { exists: false, value: undefined };
}

function areSnapshotEntriesEqual(left, right) {
  return left.exists === right.exists && areSnapshotValuesEqual(left.value, right.value);
}

function resolveMergedEntry(baseEntry, remoteEntry, localEntry, mergeMeta) {
  const localChanged = !areSnapshotEntriesEqual(localEntry, baseEntry);
  const remoteChanged = !areSnapshotEntriesEqual(remoteEntry, baseEntry);

  if (localChanged && !remoteChanged) return localEntry;
  if (!localChanged && remoteChanged) return remoteEntry;
  if (!localChanged && !remoteChanged) return remoteEntry;
  if (areSnapshotEntriesEqual(localEntry, remoteEntry)) return localEntry;

  mergeMeta.conflicts += 1;
  return localEntry;
}

function getEntityId(entity) {
  if (!entity || typeof entity !== 'object') return '';
  return String(entity.id || '');
}

function resolveMergedEntityEntry(baseEntry, remoteEntry, localEntry, mergeMeta) {
  const localChanged = !areSnapshotEntriesEqual(localEntry, baseEntry);
  const remoteChanged = !areSnapshotEntriesEqual(remoteEntry, baseEntry);

  if (localChanged && !remoteChanged) return localEntry;
  if (!localChanged && remoteChanged) return remoteEntry;
  if (!localChanged && !remoteChanged) return remoteEntry;
  if (areSnapshotEntriesEqual(localEntry, remoteEntry)) return localEntry;

  mergeMeta.conflicts += 1;

  if (localEntry.exists && !remoteEntry.exists) return localEntry;
  if (!localEntry.exists && remoteEntry.exists) return remoteEntry;
  return localEntry;
}

function mergeOrderedEntityLists(baseList, remoteList, localList, mergeMeta, normalizer = value => value) {
  const baseItems = Array.isArray(baseList) ? baseList.map((item, idx) => normalizer(item, idx)) : [];
  const remoteItems = Array.isArray(remoteList) ? remoteList.map((item, idx) => normalizer(item, idx)) : [];
  const localItems = Array.isArray(localList) ? localList.map((item, idx) => normalizer(item, idx)) : [];

  const baseMap = new Map(baseItems.map(item => [getEntityId(item), item]));
  const remoteMap = new Map(remoteItems.map(item => [getEntityId(item), item]));
  const localMap = new Map(localItems.map(item => [getEntityId(item), item]));
  const baseObject = Object.fromEntries(baseMap);
  const remoteObject = Object.fromEntries(remoteMap);
  const localObject = Object.fromEntries(localMap);
  const mergedMap = new Map();

  const ids = new Set([
    ...baseItems.map(getEntityId),
    ...remoteItems.map(getEntityId),
    ...localItems.map(getEntityId),
  ]);

  ids.forEach(id => {
    if (!id) return;
    const baseEntry = getSnapshotEntry(baseObject, id);
    const remoteEntry = getSnapshotEntry(remoteObject, id);
    const localEntry = getSnapshotEntry(localObject, id);
    const chosen = resolveMergedEntityEntry(baseEntry, remoteEntry, localEntry, mergeMeta);
    if (chosen.exists) {
      mergedMap.set(id, cloneSnapshotValue(chosen.value));
    }
  });

  const result = [];
  const seen = new Set();
  const appendFrom = items => {
    items.forEach(item => {
      const id = getEntityId(item);
      if (!id || seen.has(id) || !mergedMap.has(id)) return;
      result.push(cloneSnapshotValue(mergedMap.get(id)));
      seen.add(id);
    });
  };

  appendFrom(localItems);
  appendFrom(remoteItems);
  appendFrom(baseItems);

  return result;
}

function mergeSnapshotAreasSection(baseAreas, remoteAreas, localAreas, mergeMeta) {
  return mergeOrderedEntityLists(baseAreas, remoteAreas, localAreas, mergeMeta);
}

function mergeSnapshotIndicadoresSection(baseSection, remoteSection, localSection, mergeMeta) {
  const base = baseSection || {};
  const remote = remoteSection || {};
  const local = localSection || {};
  const result = {};
  const areaIds = new Set([
    ...Object.keys(base),
    ...Object.keys(remote),
    ...Object.keys(local),
  ]);

  areaIds.forEach(areaId => {
    const mergedList = mergeOrderedEntityLists(
      base[areaId],
      remote[areaId],
      local[areaId],
      mergeMeta,
      normalizeIndicator
    );
    if (mergedList.length) {
      result[areaId] = mergedList;
    }
  });

  return result;
}

function mergeSnapshotMapSection(baseSection, remoteSection, localSection, mergeMeta) {
  const base = baseSection || {};
  const remote = remoteSection || {};
  const local = localSection || {};
  const result = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(remote),
    ...Object.keys(local),
  ]);

  keys.forEach(key => {
    const chosen = resolveMergedEntry(
      getSnapshotEntry(base, key),
      getSnapshotEntry(remote, key),
      getSnapshotEntry(local, key),
      mergeMeta
    );
    if (chosen.exists) {
      result[key] = cloneSnapshotValue(chosen.value);
    }
  });

  return result;
}

function mergeSnapshotWholeSection(baseValue, remoteValue, localValue, mergeMeta) {
  const localChanged = !areSnapshotValuesEqual(localValue, baseValue);
  const remoteChanged = !areSnapshotValuesEqual(remoteValue, baseValue);

  if (localChanged && !remoteChanged) return cloneSnapshotValue(localValue);
  if (!localChanged && remoteChanged) return cloneSnapshotValue(remoteValue);
  if (!localChanged && !remoteChanged) return cloneSnapshotValue(remoteValue);
  if (areSnapshotValuesEqual(localValue, remoteValue)) return cloneSnapshotValue(localValue);

  mergeMeta.conflicts += 1;
  return cloneSnapshotValue(localValue);
}

function mergeSnapshotPayloads(basePayload, remotePayload, localPayload) {
  const base = normalizeSnapshotPayload(basePayload);
  const remote = normalizeSnapshotPayload(remotePayload);
  const local = normalizeSnapshotPayload(localPayload);
  const mergeMeta = { conflicts: 0 };

  return {
    payload: {
      version: Math.max(base.version || 2, remote.version || 2, local.version || 2, 2),
      areas: mergeSnapshotAreasSection(base.areas, remote.areas, local.areas, mergeMeta),
      indicadores: mergeSnapshotIndicadoresSection(base.indicadores, remote.indicadores, local.indicadores, mergeMeta),
      unidades: mergeSnapshotMapSection(base.unidades, remote.unidades, local.unidades, mergeMeta),
      dados: mergeSnapshotMapSection(base.dados, remote.dados, local.dados, mergeMeta),
      cellStyles: mergeSnapshotMapSection(base.cellStyles, remote.cellStyles, local.cellStyles, mergeMeta),
      comentarios: mergeSnapshotMapSection(base.comentarios, remote.comentarios, local.comentarios, mergeMeta),
      dadosMes: mergeSnapshotMapSection(base.dadosMes, remote.dadosMes, local.dadosMes, mergeMeta),
      dadosMeta: mergeSnapshotMapSection(base.dadosMeta, remote.dadosMeta, local.dadosMeta, mergeMeta),
      anexos: mergeSnapshotMapSection(base.anexos, remote.anexos, local.anexos, mergeMeta),
      modoMes: mergeSnapshotMapSection(base.modoMes, remote.modoMes, local.modoMes, mergeMeta),
      modoMeta: mergeSnapshotMapSection(base.modoMeta, remote.modoMeta, local.modoMeta, mergeMeta),
    },
    conflicts: mergeMeta.conflicts,
  };
}

async function writeSnapshotWithRetry(localPayload, silent = false) {
  const basePayload = getSyncBasePayload();
  let lastError = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: remoteData, error: remoteError } = await supabaseClient
      .from(SUPABASE_TABLE)
      .select('payload, version')
      .eq('ano', state.ano)
      .eq('mes', state.mesIdx + 1)
      .maybeSingle();

    if (remoteError) {
      return { ok: false, errorMessage: 'Falha ao validar dados remotos antes de salvar' };
    }

    const protectedLocalPayload = shouldProtectRemoteSnapshot(basePayload, remoteData?.payload, localPayload)
      ? normalizeSnapshotPayload(remoteData?.payload)
      : localPayload;

    const { payload: mergedPayload, conflicts } = mergeSnapshotPayloads(basePayload, remoteData?.payload, protectedLocalPayload);

    // Sem linha remota: tenta inserir como version 1. O UNIQUE(ano, mes)
    // garante que apenas um INSERT concorrente vence; o perdedor recebe 23505,
    // relê e cai no ramo de UPDATE abaixo.
    if (!remoteData) {
      const { error: insertError } = await supabaseClient
        .from(SUPABASE_TABLE)
        .insert({
          ano: state.ano,
          mes: state.mesIdx + 1,
          payload: mergedPayload,
          version: 1,
        });

      if (!insertError) {
        return { ok: true, payload: mergedPayload, conflicts };
      }

      lastError = insertError;
      if (String(insertError.code || '') === '23505') {
        continue;
      }
      return { ok: false, errorMessage: 'Falha ao salvar no Supabase' };
    }

    // CAS por inteiro: só grava se a version remota ainda for a que lemos.
    // Comparação exata, sem fuso horário nem precisão de timestamp.
    // O updated_at é setado pela trigger before-update no banco.
    const currentVersion = Number(remoteData.version) || 0;

    const { data: updatedRows, error: updateError } = await supabaseClient
      .from(SUPABASE_TABLE)
      .update({
        payload: mergedPayload,
        version: currentVersion + 1,
      })
      .eq('ano', state.ano)
      .eq('mes', state.mesIdx + 1)
      .eq('version', currentVersion)
      .select('version')
      .limit(1);

    if (updateError) {
      lastError = updateError;
      return { ok: false, errorMessage: 'Falha ao salvar no Supabase' };
    }

    if (Array.isArray(updatedRows) && updatedRows.length) {
      return { ok: true, payload: mergedPayload, conflicts };
    }
    // updatedRows vazio: outro editor avançou a version entre o select e o
    // update. Relê (pega o payload já gravado por ele) e remescla na próxima
    // iteração do loop.
  }

  if (!silent) {
    console.warn('Falha de concorrência ao salvar snapshot após múltiplas tentativas.', lastError);
  }
  return { ok: false, errorMessage: 'Não foi possível concluir o salvamento concorrente com segurança' };
}

function resetForSignedOut() {
  clearTimeout(saveTimer);
  state.sync.basePayload = null;
  closePresent();
  resetStateData();
  initData();
  renderAll();
}

function buildSnapshotPayload(syncInputs = true) {
  if (syncInputs) {
    syncVisibleInputsToState();
  }
  const serializedAttachments = Object.fromEntries(
    Object.entries(state.anexos).map(([cellKey, items]) => [
      cellKey,
      (Array.isArray(items) ? items : []).map(att => ({
        id: att.id,
        name: att.name,
        type: att.type,
        isImage: !!att.isImage,
        bucket: att.bucket || null,
        path: att.path || null,
      })),
    ])
  );

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
    anexos: serializedAttachments,
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

function stripFormulaEntries(entries = {}) {
  return Object.fromEntries(
    Object.entries(entries).filter(([, raw]) =>
      !(typeof raw === 'string' && raw.trim().startsWith('='))
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

function getSaoPauloDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function formatBackupDateKey(value) {
  const parts = getSaoPauloDateParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function parseBackupDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map(Number);
  if (!year || !month || !day) return new Date(NaN);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getRecentBackupDateKeys(days = 30) {
  const dates = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let offset = 0; offset < days; offset++) {
    const current = new Date(today);
    current.setDate(today.getDate() - offset);
    dates.push(formatBackupDateKey(current));
  }
  return dates;
}

function setBackupRestoreMessage(message, type = '') {
  const el = document.getElementById('backup-restore-message');
  if (!el) return;
  el.textContent = message;
  el.className = `login-message${type ? ` is-${type}` : ''}`;
}

function getBackupRestoreSelectedEntry() {
  return backupRestoreState.entries.find(entry => entry.backupDate === backupRestoreState.selectedDate) || null;
}

function getBackupRestoreStatusLabel(entry) {
  if (!entry) return 'Nenhum backup selecionado';
  if (entry.isRestorable) return 'Backup completo disponível';
  if (entry.hasDatabase || entry.hasStorage) return 'Backup parcial';
  return 'Sem backup';
}

function buildBackupRestorePreviewHtml(entry) {
  if (backupRestoreState.loading) {
    return '<strong>Carregando backups</strong><span>Buscando os backups disponíveis dos últimos 30 dias.</span>';
  }

  if (!entry) {
    return '<strong>Escolha uma data</strong><span>Selecione um dia com backup completo para habilitar a restauração automática.</span>';
  }

  const periods = Array.isArray(entry.databasePeriods) ? entry.databasePeriods.join(', ') : '';
  const storageLabel = entry.storageBackupPrefix
    ? (entry.storageBackupDate && entry.storageBackupDate !== entry.backupDate
      ? `${entry.storageBackupPrefix} (${formatDateLabel(parseBackupDateKey(entry.storageBackupDate))})`
      : entry.storageBackupPrefix)
    : 'Não encontrado';
  return `
    <strong>${escapeHtml(getBackupRestoreStatusLabel(entry))}</strong>
    <div class="backup-restore-preview-grid">
      <div>
        <strong>Data do backup</strong>
        <span>${escapeHtml(formatDateLabel(parseBackupDateKey(entry.backupDate)))}</span>
      </div>
      <div>
        <strong>Snapshot(s) do banco</strong>
        <span>${entry.databaseSnapshotCount || 0}</span>
      </div>
      <div>
        <strong>Backup do storage</strong>
        <span>${escapeHtml(storageLabel)}</span>
      </div>
      <div>
        <strong>Arquivos no storage</strong>
        <span>${entry.storageFilesCopied ?? 0}</span>
      </div>
      <div style="grid-column:1 / -1">
        <strong>Períodos incluídos</strong>
        <span>${periods ? escapeHtml(periods) : 'Nenhum snapshot disponível para esta data.'}</span>
      </div>
    </div>
  `;
}

function renderBackupRestorePreview() {
  const preview = document.getElementById('backup-restore-preview');
  const confirmBtn = document.getElementById('backup-restore-confirm-btn');
  if (!preview) return;
  const entry = getBackupRestoreSelectedEntry();
  preview.innerHTML = buildBackupRestorePreviewHtml(entry);
  if (confirmBtn) {
    confirmBtn.disabled = !entry?.isRestorable || backupRestoreState.restoring || backupRestoreState.loading;
  }
}

function selectBackupRestoreDate(dateKey) {
  backupRestoreState.selectedDate = dateKey;
  renderBackupRestoreCalendar();
}

function renderBackupRestoreCalendar() {
  const host = document.getElementById('backup-restore-months');
  if (!host) return;

  const recentKeys = getRecentBackupDateKeys(30).reverse();
  const recentKeySet = new Set(recentKeys);
  const availabilityMap = Object.fromEntries(backupRestoreState.entries.map(entry => [entry.backupDate, entry]));
  const monthKeys = [...new Set(recentKeys.map(key => key.slice(0, 7)))];
  const weekdayLabels = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  host.innerHTML = monthKeys.map(monthKey => {
    const [year, month] = monthKey.split('-').map(Number);
    const titleDate = new Date(year, month - 1, 1, 12, 0, 0, 0);
    const firstWeekday = titleDate.getDay();
    const totalDays = new Date(year, month, 0).getDate();
    const weekdayRow = weekdayLabels.map(label => `<div class="backup-weekday">${label}</div>`).join('');

    const cells = [];
    for (let i = 0; i < firstWeekday; i++) {
      cells.push('<div class="backup-day-spacer" aria-hidden="true"></div>');
    }

    const todayKey = formatBackupDateKey(new Date());
    for (let day = 1; day <= totalDays; day++) {
      const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`;
      const entry = availabilityMap[dateKey] || null;
      const isRecent = recentKeySet.has(dateKey);
      const hasAny = !!(entry?.hasDatabase || entry?.hasStorage);
      const isSelected = backupRestoreState.selectedDate === dateKey;
      const classes = [
        'backup-day-btn',
        entry?.isRestorable ? 'is-available' : '',
        hasAny && !entry?.isRestorable ? 'is-partial' : '',
        isSelected ? 'is-selected' : '',
        todayKey === dateKey ? 'is-today' : '',
      ].filter(Boolean).join(' ');

      if (!isRecent) {
        cells.push(`<button class="backup-day-btn" type="button" disabled><span class="backup-day-number">${day}</span></button>`);
        continue;
      }

      const badges = `
        <span class="backup-day-badges">
          ${entry?.hasDatabase ? '<span class="backup-day-badge is-db" title="Database"></span>' : ''}
          ${entry?.hasStorage ? '<span class="backup-day-badge is-storage" title="Storage"></span>' : ''}
        </span>
      `;

      if (!hasAny) {
        cells.push(`<button class="${classes}" type="button" disabled><span class="backup-day-number">${day}</span>${badges}</button>`);
        continue;
      }

      cells.push(`
        <button class="${classes}" type="button" onclick="selectBackupRestoreDate('${escapeJsString(dateKey)}')">
          <span class="backup-day-number">${day}</span>
          ${badges}
        </button>
      `);
    }

    return `
      <div class="backup-month-card">
        <div class="backup-month-title">${escapeHtml(titleDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }))}</div>
        <div class="backup-weekday-row">${weekdayRow}</div>
        <div class="backup-days-grid">${cells.join('')}</div>
      </div>
    `;
  }).join('');

  renderBackupRestorePreview();
}

async function callBackupManagerFunction(payload) {
  if (!supabaseClient) {
    throw new Error('Supabase não configurado para gerenciar backups.');
  }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const accessToken = sessionData?.session?.access_token || '';
  const anonKey = window.SUPABASE_CONFIG?.anonKey || '';
  const functionUrl = getFunctionInvokeUrl(BACKUP_MANAGER_FUNCTION_NAME);

  if (!functionUrl || !accessToken || !anonKey) {
    throw new Error('Não foi possível preparar a autenticação para o gerenciamento de backups.');
  }

  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `${response.status} ${response.statusText}`);
  }

  return data;
}

async function loadBackupRestoreEntries() {
  backupRestoreState.loading = true;
  backupRestoreState.restoring = false;
  setBackupRestoreMessage('Carregando backups disponíveis...');
  renderBackupRestoreCalendar();

  try {
    const data = await callBackupManagerFunction({ action: 'list', days: 30 });
    backupRestoreState.entries = Array.isArray(data?.backups) ? data.backups : [];
    const firstRestorable = backupRestoreState.entries.find(entry => entry.isRestorable);
    const firstPartial = backupRestoreState.entries.find(entry => entry.hasDatabase || entry.hasStorage);
    backupRestoreState.selectedDate = firstRestorable?.backupDate || firstPartial?.backupDate || '';
    setBackupRestoreMessage(firstRestorable
      ? 'Escolha um backup completo para restaurar o app.'
      : 'Nenhum backup completo foi encontrado nos últimos 30 dias.', firstRestorable ? '' : 'error');
  } catch (error) {
    backupRestoreState.entries = [];
    backupRestoreState.selectedDate = '';
    setBackupRestoreMessage(`Não foi possível carregar os backups. Detalhe: ${error?.message || 'erro desconhecido'}`, 'error');
  } finally {
    backupRestoreState.loading = false;
    renderBackupRestoreCalendar();
  }
}

function openBackupRestoreEditor() {
  if (!isAdminUser()) return;
  if (!supabaseClient) {
    alert('A restauração automática depende da sincronização com o Supabase.');
    return;
  }

  backupRestoreState = {
    entries: [],
    selectedDate: '',
    loading: true,
    restoring: false,
  };

  document.getElementById('backup-restore-overlay')?.classList.add('open');
  renderBackupRestoreCalendar();
  loadBackupRestoreEntries();
}

function closeBackupRestoreEditor() {
  if (backupRestoreState.restoring) return;
  document.getElementById('backup-restore-overlay')?.classList.remove('open');
}

async function confirmBackupRestoreSelection() {
  if (!isAdminUser() || backupRestoreState.restoring) return;

  const selectedEntry = getBackupRestoreSelectedEntry();
  if (!selectedEntry?.isRestorable) {
    setBackupRestoreMessage('Escolha uma data com backup completo para restaurar.', 'error');
    return;
  }

  if (syncVisibleInputsToState()) {
    state.sync.dirty = true;
  }

  const confirmationLines = [
    `Restaurar o backup de ${formatDateLabel(parseBackupDateKey(selectedEntry.backupDate))}?`,
    '',
    'Isso vai restaurar os dados do banco e os anexos do storage.',
    'O conteúdo atual do app poderá ser substituído pelos dados desse backup.',
  ];
  if (state.sync.dirty) {
    confirmationLines.push('', 'Existem alterações locais abertas no navegador. Após a restauração, o app será recarregado.');
  }

  if (!confirm(confirmationLines.join('\n'))) {
    return;
  }

  backupRestoreState.restoring = true;
  setBackupRestoreMessage(`Restaurando o backup de ${formatDateLabel(parseBackupDateKey(selectedEntry.backupDate))}...`);
  renderBackupRestorePreview();

  try {
    const result = await callBackupManagerFunction({
      action: 'restore',
      backup_date: selectedEntry.backupDate,
      storage_backup_date: selectedEntry.storageBackupDate || selectedEntry.backupDate,
    });
    clearLocalDraft();
    state.sync.dirty = false;
    backupRestoreState.restoring = false;
    closeBackupRestoreEditor();
    await reloadFromCloud(true);
    alert(`Backup restaurado com sucesso.\n\nSnapshots restaurados: ${result?.databaseRestoredCount ?? 0}\nArquivos restaurados: ${result?.storageRestoredCount ?? 0}`);
  } catch (error) {
    setBackupRestoreMessage(`Não foi possível restaurar o backup. Detalhe: ${error?.message || 'erro desconhecido'}`, 'error');
  } finally {
    backupRestoreState.restoring = false;
    renderBackupRestorePreview();
  }
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

  if (syncVisibleInputsToState()) {
    state.sync.dirty = true;
  }

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

  const structurePayload = buildStructureOnlyPayload();

  // Usa merge seguro: lê o snapshot atual do mês destino, mescla apenas a
  // estrutura (áreas, indicadores, fórmulas, modoMes/modoMeta) preservando
  // os dados já preenchidos (dados, dadosMes, dadosMeta, comentarios, anexos).
  // Usa CAS por version para evitar sobrescrita concorrente.
  const { data: remoteData, error: fetchError } = await supabaseClient
    .from(SUPABASE_TABLE)
    .select('payload, version')
    .eq('ano', year)
    .eq('mes', month)
    .maybeSingle();

  if (fetchError) {
    alert(fetchError.message || 'Não foi possível verificar os dados do mês destino antes de copiar.');
    return;
  }

  // Monta o payload mesclado: estrutura vem da origem, dados vêm do destino.
  const remotePayload = remoteData?.payload ? normalizeSnapshotPayload(remoteData.payload) : null;
  const preservedTargetData = stripFormulaEntries(remotePayload?.dados || {});
  const mergedPayload = {
    ...structurePayload,
    dados:       { ...preservedTargetData, ...structurePayload.dados },
    cellStyles:  remotePayload?.cellStyles  || {},
    comentarios: remotePayload?.comentarios || {},
    dadosMes:    remotePayload?.dadosMes    || {},
    dadosMeta:   remotePayload?.dadosMeta   || {},
    anexos:      remotePayload?.anexos      || {},
  };

  let saveError;
  if (!remoteData) {
    const { error } = await supabaseClient.from(SUPABASE_TABLE).insert({
      ano: year,
      mes: month,
      payload: mergedPayload,
      version: 1,
    });
    saveError = error;
  } else {
    // CAS por version: impede sobrescrita se outro usuário salvou entre o
    // fetch acima e o update agora. O updated_at é setado pela trigger.
    const currentVersion = Number(remoteData.version) || 0;
    const { data: updatedRows, error } = await supabaseClient
      .from(SUPABASE_TABLE)
      .update({ payload: mergedPayload, version: currentVersion + 1 })
      .eq('ano', year).eq('mes', month).eq('version', currentVersion)
      .select('version').limit(1);
    if (!error && (!Array.isArray(updatedRows) || !updatedRows.length)) {
      alert('O mês destino foi modificado por outro usuário durante a operação. Tente novamente.');
      return;
    }
    saveError = error;
  }

  if (saveError) {
    alert(saveError.message || 'Não foi possível copiar a configuração para o mês escolhido.');
    return;
  }

  closeCopyConfigEditor();
  alert(`Configuração copiada com sucesso para ${targetLabel}.`);
}

function applySnapshotPayload(payload) {
  resetStateData();
  const normalized = normalizeSnapshotPayload(payload);
  if (!payload || typeof payload !== 'object') {
    initData();
    return;
  }
  state.areas = normalized.areas;
  state.indicadores = normalized.indicadores;
  state.unidades = normalized.unidades;
  state.dados = normalized.dados;
  state.cellStyles = normalized.cellStyles;
  state.comentarios = normalized.comentarios;
  state.dadosMes = normalized.dadosMes;
  state.dadosMeta = normalized.dadosMeta;
  state.anexos = normalized.anexos;
  state.modoMes = normalized.modoMes;
  state.modoMeta = normalized.modoMeta;
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
  setReminderMessage('Configure o envio automático e manual dos lembretes por e-mail.');
  renderReminderSettings();
  loadAdminUsers();
  loadReminderSettings();
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

  const rows = visibleUsers.map(user => {
    const safeUserId = escapeJsString(user.id);
    const safeName = escapeHtml(getStoredPersonName(user));
    const safeEmail = escapeHtml(user.email);
    return `
    <div class="admin-user-row">
      <div>
        <input
          class="admin-user-name-input"
          type="text"
          value="${safeName}"
          placeholder="Nome do usuário"
          onchange="updateAppUserName('${safeUserId}', this.value)">
      </div>
      <div class="admin-user-email">${safeEmail}</div>
      <div>
        <select class="admin-select" onchange="updateAppUserRole('${safeUserId}', this.value)" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="editor" ${user.role === 'editor' ? 'selected' : ''}>Editor</option>
          <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        </select>
      </div>
      <div>
        <label class="admin-check">
          <input type="checkbox" ${user.active ? 'checked' : ''} onchange="updateAppUserFlags('${safeUserId}', 'active', this.checked)" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <span>Ativo</span>
        </label>
      </div>
      <div>
        <label class="admin-check">
          <input type="checkbox" ${user.can_access ? 'checked' : ''} onchange="updateAppUserFlags('${safeUserId}', 'can_access', this.checked)" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <span>Acesso</span>
        </label>
      </div>
      <div class="admin-user-actions">
        <button class="row-action-btn row-action-remove" type="button" title="Revogar acesso" onclick="revokeAppUserAccess('${safeUserId}')" ${user.email === ADMIN_EMAIL ? 'disabled' : ''}>
          <i class="ti ti-trash"></i>
        </button>
      </div>
    </div>
  `;
  }).join('');

  list.innerHTML = `
    <div class="admin-user-row header">
      <div>Nome</div>
      <div>Email</div>
      <div>Perfil</div>
      <div>Ativo</div>
      <div>Acesso</div>
      <div>Ação</div>
    </div>
    ${rows}
  `;
}

function markDirty(options = {}) {
  const {
    autosave = true,
    autosaveDelayMs = 1200,
    syncInputs = true,
  } = options;
  if (!state.sync.enabled) return;
  state.sync.dirty = true;
  persistLocalDraft(buildSnapshotPayload(syncInputs));
  setSyncStatus('dirty', `Alterações locais em ${getPeriodoLabel()}`, true);
  clearTimeout(saveTimer);
  if (autosave) {
    saveTimer = setTimeout(() => {
      saveToCloud(true);
    }, autosaveDelayMs);
  }
}

async function saveToCloud(silent = false) {
  if (!supabaseClient) return false;

  clearTimeout(saveTimer);
  setSyncStatus('saving', `Salvando ${getPeriodoLabel()}...`, state.sync.dirty);

  const localPayload = buildSnapshotPayload();
  persistLocalDraft(localPayload);
  const saveResult = await writeSnapshotWithRetry(localPayload, silent);

  if (!saveResult.ok) {
    setSyncStatus('error', saveResult.errorMessage, true);
    return false;
  }

  const mergedPayload = saveResult.payload;
  const conflicts = saveResult.conflicts;
  state.sync.lastSuccessAt = formatSyncTimestamp();
  const livePayload = buildSnapshotPayload();
  const liveChangedDuringSave = !areSnapshotValuesEqual(livePayload, localPayload);

  if (liveChangedDuringSave) {
    const { payload: reconciledPayload } = mergeSnapshotPayloads(localPayload, mergedPayload, livePayload);
    applySnapshotPayload(reconciledPayload);
    setSyncBasePayload(mergedPayload);
    persistLocalDraft(reconciledPayload);
    renderAll();
    setSyncStatus('dirty', `Alterações locais em ${getPeriodoLabel()}`, true);
    saveTimer = setTimeout(() => {
      saveToCloud(true);
    }, 400);
    return true;
  }

  applySnapshotPayload(mergedPayload);
  setSyncBasePayload(mergedPayload);
  clearLocalDraft();
  renderAll();
  setSyncStatus(
    'ready',
    conflicts
      ? `Salvo com mesclagem segura: ${getPeriodoLabel()}`
      : `Salvo em nuvem: ${getPeriodoLabel()}`,
    false
  );
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
    .select('payload, updated_at')
    .eq('ano', state.ano)
    .eq('mes', state.mesIdx + 1)
    .maybeSingle();

  if (error) {
    setSyncStatus('error', 'Falha ao carregar do Supabase', state.sync.dirty);
    return false;
  }

  if (!data || !data.payload) {
    if (recoverLocalDraftIfNeeded(null, null)) {
      return true;
    }
    resetStateData();
    initData();
    setSyncBasePayload(null);
    renderAll();
    state.sync.lastSuccessAt = formatSyncTimestamp();
    setSyncStatus('ready', `Sem dados salvos para ${getPeriodoLabel()}`, false);
    if (!silent) scheduleSyncMessageReset();
    return true;
  }

  if (recoverLocalDraftIfNeeded(data.payload, data.updated_at)) {
    return true;
  }

  applySnapshotPayload(data.payload);
  setSyncBasePayload(data.payload);
  clearLocalDraft();
  renderAll();
  state.sync.lastSuccessAt = formatSyncTimestamp();
  setSyncStatus('ready', `Dados carregados: ${getPeriodoLabel()}`, false);
  if (!silent) scheduleSyncMessageReset();
  return true;
}

async function manualSaveSnapshot() {
  if (!state.sync.enabled || !canEditData()) return false;
  const visibleInputChanged = syncVisibleInputsToState();
  if (visibleInputChanged) {
    state.sync.dirty = true;
  }
  return saveToCloud(false);
}

async function manualReloadSnapshot() {
  if (!state.sync.enabled) return false;
  const visibleInputChanged = syncVisibleInputsToState();
  if (visibleInputChanged) {
    state.sync.dirty = true;
  }
  if (state.sync.dirty) {
    const shouldDiscard = confirm(`Existem alterações locais em ${getPeriodoLabel()} ainda não sincronizadas.\n\nDeseja recarregar do banco mesmo assim?`);
    if (!shouldDiscard) return false;
  }
  return reloadFromCloud(false);
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
    const visibleInputChanged = syncVisibleInputsToState();
    if (state.sync.enabled && (state.sync.dirty || visibleInputChanged)) {
      state.sync.dirty = true;
      persistLocalDraft(buildSnapshotPayload());
    }
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

function registerPersistenceLifecycle() {
  window.addEventListener('pagehide', () => {
    flushPendingChanges();
  });
  window.addEventListener('beforeunload', () => {
    const visibleInputChanged = syncVisibleInputsToState();
    if (visibleInputChanged) {
      state.sync.dirty = true;
    }
    if (state.sync.dirty) {
      persistLocalDraft(buildSnapshotPayload());
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingChanges();
    }
  });
}

async function submitLogin(event) {
  event.preventDefault();
  if (!supabaseClient) {
    setLoginMessage('Supabase não configurado para autenticação.', 'error');
    return;
  }
  if (state.auth.pendingRequest) return;

  state.auth.pendingRequest = true;

  try {
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

      setLoginBusy(true);
      if (isSignup) {
      const confirmPassword = document.getElementById('login-password-confirm')?.value || '';
      if (password !== confirmPassword) {
        setLoginMessage('A confirmação da senha não confere.', 'error');
        return;
      }

      setLoginMessage('Verificando autorização...');
      const signupAllowed = await canStartFirstAccess(emailNormalized);
      if (!signupAllowed) {
        setLoginMessage('Este email ainda não foi liberado pelo administrador.', 'error');
        return;
      }
    }

    setLoginMessage(isSignup ? 'Criando seu acesso...' : 'Validando credenciais...');

    try {
      if (isSignup) {
        const { data, error } = await withClientTimeout(
          supabaseClient.auth.signUp({
            email: emailNormalized,
            password,
            options: {
              emailRedirectTo: APP_PUBLIC_URL,
            },
          }),
          20000,
          'O cadastro'
        );

        if (error) {
          const rateLimitMessage = getAuthRateLimitMessage(error, 'confirmar este cadastro');
          if (rateLimitMessage) {
            setLoginMessage(rateLimitMessage, 'error');
            showEmailConfirmModal(emailNormalized);
            return;
          }
          setLoginMessage(error.message || 'Não foi possível criar seu acesso.', 'error');
          return;
        }

        state.auth.mode = 'login';
        renderAuthMode();
        setLoginMessage('');

        if (!data.session) {
          // Supabase exige confirmação de email — mostra modal
          showEmailConfirmModal(emailNormalized);
        } else {
          // Confirmação desativada no Supabase — já autenticado
          setLoginMessage('Acesso criado com sucesso. Você já está autenticado.', 'success');
        }
        return;
      }

      const { error } = await supabaseClient.auth.signInWithPassword({ email: emailNormalized, password });
      if (error) {
        setLoginMessage(error.message || 'Email ou senha inválidos.', 'error');
        return;
      }
    } catch (error) {
      if (error?.code === 'client_timeout') {
        setLoginMessage('O cadastro demorou demais para responder. Revise o SMTP do Supabase e tente novamente.', 'error');
        return;
      }
      setLoginMessage(error?.message || 'Falha inesperada durante a autenticação.', 'error');
    }
  } finally {
    setLoginBusy(false);
    state.auth.pendingRequest = false;
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

async function saveReminderSettings() {
  if (!supabaseClient || !isAdminUser()) return;
  const payload = collectReminderSettingsFromForm();

  if (!payload.subject_template) {
    setReminderMessage('Informe um assunto para o e-mail de lembrete.', 'error');
    return;
  }

  if (!payload.body_template.trim()) {
    setReminderMessage('Informe o texto padrão do e-mail de lembrete.', 'error');
    return;
  }

  const savePayload = {
    enabled: payload.enabled,
    subject_template: payload.subject_template,
    body_template: payload.body_template,
    recurrence: payload.recurrence,
    weekday: payload.weekday,
    time_hhmm: payload.time_hhmm,
    timezone: payload.timezone || 'America/Sao_Paulo',
    updated_by: state.auth.user?.email || null,
  };

  let response;
  if (payload.id) {
    response = await supabaseClient
      .from(APP_REMINDER_TABLE)
      .update(savePayload)
      .eq('id', payload.id)
      .select('*')
      .single();
  } else {
    response = await supabaseClient
      .from(APP_REMINDER_TABLE)
      .insert(savePayload)
      .select('*')
      .single();
  }

  if (response.error) {
    setReminderMessage(`Não foi possível salvar a configuração de lembretes. Detalhe: ${response.error.message || 'erro desconhecido'}`, 'error');
    return;
  }

  state.reminder = normalizeReminderSettings(response.data || savePayload);
  renderReminderSettings();
  setReminderMessage('Configuração de lembretes salva com sucesso.', 'success');
}

async function triggerReminderNow() {
  if (!supabaseClient || !isAdminUser()) return;
  if (!ensureReminderState().id) {
    await saveReminderSettings();
    if (!ensureReminderState().id) return;
  }

  setReminderMessage('Disparando lembrete manual...', '');
  const payload = {
    trigger: 'manual',
    reminderId: state.reminder.id,
    periodLabel: getPeriodoLabel(),
    focusedSemana: getFocusedSemana(),
    appUrl: getReminderAppUrl(),
    triggeredBy: state.auth.user?.email || '',
  };

  const { data: sessionData } = await supabaseClient.auth.getSession();
  const accessToken = sessionData?.session?.access_token || '';
  const anonKey = window.SUPABASE_CONFIG?.anonKey || '';
  const functionUrl = getFunctionInvokeUrl(REMINDER_FUNCTION_NAME);

  if (!functionUrl || !accessToken || !anonKey) {
    setReminderMessage('Não foi possível preparar a autenticação do disparo manual.', 'error');
    return;
  }

  let response;
  let data = null;
  try {
    response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
    });
    data = await response.json().catch(() => null);
  } catch (error) {
    setReminderMessage(`Não foi possível disparar o lembrete. Detalhe: ${error?.message || 'falha de rede'}`, 'error');
    return;
  }

  if (!response.ok) {
    const detail = data?.error || data?.message || `${response.status} ${response.statusText}`;
    setReminderMessage(`Não foi possível disparar o lembrete. Detalhe: ${detail}`, 'error');
    return;
  }

  state.reminder = normalizeReminderSettings({
    ...state.reminder,
    last_sent_at: data?.lastSentAt || new Date().toISOString(),
    last_sent_by: data?.lastSentBy || state.auth.user?.email || 'manual',
  });
  renderReminderSettings();
  setReminderMessage(`Lembrete enviado com sucesso para ${data?.recipientCount ?? 'os destinatários configurados'}.`, 'success');
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
  const result = await persistAppUserName({ id: userId }, rawName);

  if (result.error) {
    const detail = result.error?.message ? ` Detalhe: ${result.error.message}` : '';
    setAdminMessage(`Não foi possível atualizar o nome desse usuário.${detail}`, 'error');
    await loadAdminUsers();
    return;
  }

  state.auth.users = state.auth.users.map(item => (
    item.id === userId ? { ...item, [result.field]: result.value } : item
  ));
  if (state.auth.profile?.id === userId) {
    state.auth.profile = { ...state.auth.profile, [result.field]: result.value };
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
    const n = parseLocalizedNumber(raw);
    if (isNaN(n)) return raw;
    const h = Math.floor(Math.abs(n));
    const m = Math.round((Math.abs(n) - h) * 60);
    const sign = n < 0 ? '-' : '';
    return `${sign}${h}:${String(m).padStart(2,'0')}`;
  }
  const n = parseLocalizedNumber(raw);
  if (isNaN(n)) return raw;
  if (unit === '%') {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  }
  if (unit === 'R$') {
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  if (unit === 'dias') {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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


