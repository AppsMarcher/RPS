async function bootstrap() {
  document.addEventListener('copy', handleDocumentCopy);
  state.reminder = getDefaultReminderSettings();
  renderReminderScheduleOptions(state.reminder.recurrence, state.reminder.weekday);
  renderReminderSettings();
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
  document.getElementById('reminder-recurrence')?.addEventListener('change', event => {
    renderReminderScheduleOptions(event.target.value, 1);
  });

  showLoginScreen();
  setLoginMessage('Entre com seu email e senha para acessar a RPS.');
  renderAuthMode();
  loadColumnWidths();
  initData();
  initSupabase();
  if (!supabaseClient) return;

  registerAuthListener();
  renderAll();

  // Trata retorno do link de confirmação de cadastro via email.
  // O Supabase redireciona com #access_token= ou ?code= na URL.
  // Aguardamos o supabase-js processar o hash antes de checar a sessão.
  const hashStr = window.location.hash.replace('#', '?');
  const hashParams = new URLSearchParams(hashStr);
  const searchParams = new URLSearchParams(window.location.search);
  if (
    hashParams.get('access_token') ||
    hashParams.get('code') ||
    searchParams.get('code')
  ) {
    await new Promise(r => setTimeout(r, 800));
    history.replaceState(null, '', window.location.pathname);
  }

  const { data } = await supabaseClient.auth.getSession();
  await applyAuthSession(data.session);
  if (!state.auth.user) {
    document.getElementById('login-email')?.focus();
  }
}

bootstrap();



