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
    th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-week" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>${s}`, s);
    tr.appendChild(th);
  });

  th = document.createElement('th');
  th.className = 'mes-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-month" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Mês`, 'mes');
  tr.appendChild(th);

  th = document.createElement('th');
  th.className = 'meta-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-target" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Meta`, 'meta');
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
    const safeAreaId = escapeJsString(area.id);
    const aRow = document.createElement('tr');
    aRow.className = 'area-header-row';
    const aTd = document.createElement('td');
    aTd.colSpan = state.semanas.length + 5;
    const areaLabel = document.createElement('span');
    areaLabel.className = 'area-icon';
    const areaIcon = document.createElement('i');
    areaIcon.className = `ti ${area.icon}`;
    areaIcon.style.fontSize = '14px';
    areaIcon.style.color = area.cor;
    areaLabel.appendChild(areaIcon);
    areaLabel.appendChild(document.createTextNode(area.nome));
    aTd.appendChild(areaLabel);
    aRow.appendChild(aTd);
    tbody.appendChild(aRow);

    getIndicators(area.id).forEach((ind, ii) => {
      if (isSpacerIndicator(ind)) {
        const spacerRow = document.createElement('tr');
        spacerRow.className = 'indicator-row spacer-row';
        const spacerTd = document.createElement('td');
        spacerTd.colSpan = state.semanas.length + 5;
        spacerTd.innerHTML = `<span class="spacer-row-actions">
          <button onclick="insertSpacerAt('${safeAreaId}',${ii})"
            class="row-action-btn"
            title="Inserir espaço abaixo"
            style="visibility:${canEditRows ? 'visible' : 'hidden'}"><i class="ti ti-layout-rows"></i></button>
          <button onclick="removeIndicador('${safeAreaId}',${ii})"
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
      if (isEditorUser() && isFormulaIndicatorRow(area.id, ind)) {
        row.classList.add('editor-formula-row');
      }
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
        <span contenteditable="${canEditLabel}" title="${escapeHtml(policyLabel)}" style="flex:1;outline:none;padding:2px 3px 2px ${isChild ? '18px' : '3px'};border-radius:3px;font-weight:${isAggregate ? '600' : '400'};white-space:break-spaces"
          onblur="renameIndicador('${safeAreaId}',${ii},this.textContent)"></span>
        <span style="display:inline-flex;align-items:center;gap:6px">
          <button onclick="configureIndicadorEdit('${safeAreaId}',${ii})"
            class="row-action-btn"
            title="Configurar campos digitáveis"
            style="visibility:${canEditRows && !isAggregate ? 'visible' : 'hidden'}"><i class="ti ti-lock-cog"></i></button>
          <button onclick="insertIndicadorAt('${safeAreaId}',${ii})"
            class="row-action-btn"
            title="Inserir linha abaixo"
            style="visibility:${canEditRows ? 'visible' : 'hidden'}"><i class="ti ti-plus"></i></button>
          <button onclick="removeIndicador('${safeAreaId}',${ii})"
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
        inp.oninput = e => {
          if (canEditRows && e.target.value === '=') {
            showFormulaHint(e.target);
          } else {
            hideFormulaHint();
          }
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
          openAttachmentManager(ak, lbl);
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
      <button class="add-btn" style="width:auto;padding-left:20px" onclick="addIndicador('${safeAreaId}')">
        <i class="ti ti-plus" style="font-size:11px;vertical-align:-1px"></i> adicionar indicador</button>
      <button class="add-btn" style="width:auto;padding-left:0" onclick="addSpacer('${safeAreaId}')">
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

function applyPresentationPreferences() {
  const overlay = document.getElementById('present-overlay');
  if (!overlay) return;
  overlay.classList.toggle('present-dark-mode', !!state.presentation.darkMode);
  overlay.classList.toggle('present-font-boost', !!state.presentation.fontBoost);
  updatePresentationToolbar();
}

function updatePresentationToolbar() {
  const darkBtn = document.getElementById('present-dark-toggle');
  const fontBtn = document.getElementById('present-font-toggle');
  if (darkBtn) {
    darkBtn.classList.toggle('is-active', !!state.presentation.darkMode);
    darkBtn.setAttribute('aria-pressed', state.presentation.darkMode ? 'true' : 'false');
  }
  if (fontBtn) {
    fontBtn.classList.toggle('is-active', !!state.presentation.fontBoost);
    fontBtn.setAttribute('aria-pressed', state.presentation.fontBoost ? 'true' : 'false');
  }
}

function togglePresentDarkMode() {
  state.presentation.darkMode = !state.presentation.darkMode;
  savePresentationPreferences();
  applyPresentationPreferences();
}

function togglePresentFontBoost() {
  state.presentation.fontBoost = !state.presentation.fontBoost;
  savePresentationPreferences();
  applyPresentationPreferences();
}

function openPresent() {
  state.presentIdx = state.focusIdx !== null ? state.focusIdx : 0;
  const overlay = document.getElementById('present-overlay');
  overlay.classList.add('open');
  applyPresentationPreferences();
  syncLightboxHost();
  document.getElementById('p-month-label').textContent = `${MESES[state.mesIdx]} ${state.ano}`;
  document.getElementById('p-header-sub').textContent = 'Acompanhamento de indicadores';
  renderPresentBody();
  enterFullscreen(overlay);
}

function closePresent() {
  document.getElementById('present-overlay').classList.remove('open');
  syncLightboxHost();
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
    th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-week" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>${s}`, s);
    tr.appendChild(th);
  });

  th = document.createElement('th');
  th.className = 'mes-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-calendar-month" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Mês`, 'mes');
  tr.appendChild(th);

  th = document.createElement('th');
  th.className = 'meta-col';
  th.innerHTML = makeHeaderContent(`<i class="ti ti-target" style="font-size:11px;vertical-align:-1px;margin-right:3px"></i>Meta`, 'meta');
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
    const areaLabel = document.createElement('span');
    areaLabel.className = 'area-icon';
    const areaIcon = document.createElement('i');
    areaIcon.className = `ti ${area.icon}`;
    areaIcon.style.fontSize = '14px';
    areaIcon.style.color = area.cor;
    areaLabel.appendChild(areaIcon);
    areaLabel.appendChild(document.createTextNode(area.nome));
    aTd.appendChild(areaLabel);
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
        applyCellCommentState(td, comentarioK(area.id, ind.id, s));
        const ak = anexoKey(area.id, ind.id, s);
        const countAtt = getAttachmentCount(ak);
        const hasAtt = countAtt > 0;
        const val = calcWeekValue(area.id, ind, s);
        const wrap = document.createElement('div');
        wrap.className = 'present-cell-wrap';
        const valueSpan = document.createElement('span');
        valueSpan.className = 'present-cell-val';
        valueSpan.textContent = val !== null ? formatNum(val, unit) : '-';
        wrap.appendChild(valueSpan);
        if (hasAtt) {
          const clipBtn = document.createElement('button');
          clipBtn.className = 'present-clip-btn';
          clipBtn.type = 'button';
          clipBtn.onclick = () => openLightbox(ak, `${ind.label} - ${s}`);

          const clipIcon = document.createElement('i');
          clipIcon.className = 'ti ti-paperclip';
          const countSpan = document.createElement('span');
          countSpan.className = 'present-count';
          countSpan.textContent = String(countAtt);

          clipBtn.appendChild(clipIcon);
          clipBtn.appendChild(countSpan);
          wrap.appendChild(clipBtn);
        }
        td.appendChild(wrap);
        row.appendChild(td);
      });

      const valMes = calcMes(area.id, ind, { focusedSemana });
      const valMeta = calcMeta(area.id, ind, { focusedSemana });
      const vv = calcVarDiff(valMes, valMeta);
      const vp = calcVar(valMes, valMeta);

      const tdMes = document.createElement('td');
      tdMes.className = 'mes-cell';
      applyCellCommentState(tdMes, comentarioK(area.id, ind.id, 'mes'));
      tdMes.innerHTML = `<div class="present-cell-wrap"><span class="present-cell-val">${formatNum(valMes, unit)}</span></div>`;
      row.appendChild(tdMes);

      const tdMeta = document.createElement('td');
      tdMeta.className = 'meta-cell';
      applyCellCommentState(tdMeta, comentarioK(area.id, ind.id, 'meta'));
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
  if (syncVisibleInputsToState()) {
    state.sync.dirty = true;
  }
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

// --- Tooltip de ajuda de fórmulas (aparece ao digitar "=" numa célula) --------
const FORMULA_HINT_HTML = `
  <div style="font-weight:700;font-size:12px;margin-bottom:8px;color:#1a1a1a">
    <i class="ti ti-function" style="color:#185FA5"></i> Fórmulas disponíveis
  </div>
  <div style="display:grid;gap:5px;font-size:11px;line-height:1.5;color:#333">
    <div><code>=SOMA(S1;S2;S3)</code> — soma valores</div>
    <div><code>=MÉDIA(S1;S2;S3;S4)</code> — média</div>
    <div><code>=MÍNIMO(S1;S2)</code> / <code>MÁXIMO(S1;S2)</code></div>
    <div><code>=ARRED(Faturamento/4;2)</code> — arredonda</div>
    <div><code>=ABS(Meta-Faturamento)</code> — valor absoluto</div>
    <div><code>=SE(Faturamento&gt;1000;"Atingiu";"Abaixo")</code></div>
    <div><code>=SEERRO(Nacional/Faturamento;0)</code></div>
    <div style="margin-top:6px;color:#666">
      <strong>Referências:</strong><br>
      <code>S1 S2 S3 S4 S5</code> — semanas da linha<br>
      <code>MES</code> <code>META</code> — consolidado / meta<br>
      <code>NomeIndicador</code> — outro indicador desta área<br>
      <code>area.Indicador</code> — indicador de outra área<br>
      <code>{Nome com espaços}</code> — nome entre chaves
    </div>
  </div>
`;

function showFormulaHint(inputEl) {
  hideFormulaHint();
  if (!canEditStructure()) return;
  const hint = document.createElement('div');
  hint.id = 'formula-hint';
  hint.innerHTML = FORMULA_HINT_HTML;
  hint.style.cssText = `
    position:fixed; z-index:9000;
    background:#fff; border:1px solid rgba(0,0,0,0.12);
    border-radius:12px; padding:14px 16px;
    box-shadow:0 8px 28px rgba(0,0,0,0.14);
    min-width:280px; max-width:340px;
    pointer-events:none;
  `;
  document.body.appendChild(hint);

  // Posiciona abaixo do input
  const rect = inputEl.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = Math.min(rect.left, window.innerWidth - 350);
  hint.style.top = `${top}px`;
  hint.style.left = `${Math.max(8, left)}px`;
}

function hideFormulaHint() {
  document.getElementById('formula-hint')?.remove();
}

document.addEventListener('focusout', () => {
  setTimeout(hideFormulaHint, 200);
}, true);


