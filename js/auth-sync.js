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

function resetForSignedOut() {
  clearTimeout(saveTimer);
  closePresent();
  resetStateData();
  initData();
  renderAll();
}

function buildSnapshotPayload() {
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

    setLoginBusy(true);
    setLoginMessage('Verificando autorização...');
    const signupAllowed = await canStartFirstAccess(emailNormalized);
    setLoginBusy(false);
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
        options: {
          emailRedirectTo: APP_PUBLIC_URL,
        },
      });

      if (error) {
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


