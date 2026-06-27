/**
 * Товарний графік — клієнт. Дані: SQLite через PHP API.
 */
(function () {
  'use strict';

  const API = 'api';
  /** Рік графіка з сервера (config schedule_year), збігається з календарем для months. */
  let scheduleYear = 2026;
  /** План годин на місяць: норма та стеля пропорційно ставці (повна ставка 1.0 → 176 / 248). */
  const HOURS_NORM_FULL = 176;
  const HOURS_MAX_FULL = 248;
  const MAX_HOURS_PER_DAY = 12;

  /** @type {Array<{id:string,name:string,days:number,startDay:number}>} */
  let MONTHS = [];
  const DAY_NAMES = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  let employees = [];
  let nextId = 1;
  let currentMonth = '';
  let currentSection = 'all';
  let currentAgeFilter = 'all';
  let currentWeek = 0;
  let editingEmpId = null;
  let empAgeAdult = true;

  /** @type {Array<{id:number,plu:string,art:string,name:string,category:string}>} */
  let products = [];
  let nextProductId = 1;
  let editingProductId = null;
  let productSheetPages = 1;
  const PRODUCT_CATEGORY_ORDER = ['овочі', 'фрукти', 'гриби', 'ягода', 'інше'];
  const PRODUCT_CATEGORY_LABELS = {
    овочі: 'Овочі',
    фрукти: 'Фрукти',
    гриби: 'Гриби',
    ягода: 'Ягода',
    інше: 'Інше',
  };
  const PRODUCT_CATEGORY_COLORS = {
    овочі: '#16a34a',
    фрукти: '#ea580c',
    гриби: '#92400e',
    ягода: '#be185d',
    інше: '#64748b',
  };

  function el(id) {
    return document.getElementById(id);
  }

  async function apiJson(path, opts) {
    const r = await fetch(API + '/' + path, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...opts,
    });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('Некоректна відповідь сервера');
    }
    if (!r.ok) {
      throw new Error(data.error || r.statusText || 'Помилка запиту');
    }
    return data;
  }

  async function loadProducts() {
    const data = await apiJson('products.php', { method: 'GET' });
    products = data.products || [];
    nextProductId = data.nextProductId || 1;
  }

  async function loadState() {
    const data = await apiJson('state.php', { method: 'GET' });
    MONTHS = data.months || [];
    if (typeof data.schedule_year === 'number') {
      scheduleYear = data.schedule_year;
    }
    employees = data.employees || [];
    nextId = data.nextId || 1;
    if (MONTHS.length && !currentMonth) {
      currentMonth = MONTHS[0].id;
    } else if (MONTHS.length) {
      const has = MONTHS.some((m) => m.id === currentMonth);
      if (!has) currentMonth = MONTHS[0].id;
    }
  }

  function getDayName(month, day) {
    const m = MONTHS.find((x) => x.id === month);
    if (!m) return '';
    return DAY_NAMES[(m.startDay + day - 1) % 7];
  }

  function isWeekend(month, day) {
    const d = getDayName(month, day);
    return d === 'нд' || d === 'сб';
  }

  function planNormForRate(rate) {
    return Math.round(Number(rate) * HOURS_NORM_FULL * 100) / 100;
  }

  function planMaxForRate(rate) {
    return Math.round(Number(rate) * HOURS_MAX_FULL * 100) / 100;
  }

  /** Пул «біржі»: (248 − 176) × ставка, узгоджено з округленням norm/max. */
  function planBirzhPoolForRate(rate) {
    const maxH = planMaxForRate(rate);
    const normH = planNormForRate(rate);
    return Math.max(0, Math.round((maxH - normH) * 100) / 100);
  }

  /**
   * Розбивка плану: спочатку до норми 176×ставка, решта до стелі — у біржу до (248−176)×ставка.
   * Якщо план понад макс. — понадстріл у overMax для попередження.
   */
  function splitPlanNormBirzh(planTotal, rate) {
    const normH = planNormForRate(rate);
    const maxH = planMaxForRate(rate);
    const birzhCap = planBirzhPoolForRate(rate);
    const normAttr = Math.min(planTotal, normH);
    const birzhAttr = Math.min(Math.max(planTotal - normH, 0), birzhCap);
    const overMax = Math.max(0, planTotal - maxH);
    return { normAttr, birzhAttr, overMax };
  }

  function fmtHoursDisplay(n) {
    const r = Math.round(Number(n) * 100) / 100;
    if (Math.abs(r - Math.round(r)) < 1e-6) return String(Math.round(r));
    return String(r);
  }

  /** День відпустки в комірці: «В»/«в» або число 0 (не зараховується в суму «План»). */
  function isVacationDayValue(v) {
    if (v === undefined || v === null || v === '') return false;
    if (v === 'В' || v === 'в') return true;
    if (typeof v === 'number' && v === 0) return true;
    const s = String(v).trim().replace(',', '.');
    if (s === '') return false;
    const n = parseFloat(s);
    return !isNaN(n) && n === 0;
  }

  function contributionFromStoredValue(v) {
    if (v === undefined || v === null || v === '') return 0;
    if (isVacationDayValue(v)) return 0;
    const n = parseFloat(typeof v === 'number' ? v : String(v).trim().replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  function sumPlanHoursObj(monthHours) {
    return Object.values(monthHours || {}).reduce((s, v) => s + contributionFromStoredValue(v), 0);
  }

  // ---------- NAV ----------
  function showPage(id) {
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    const page = el('page-' + id);
    if (page) page.classList.add('active');
    const order = ['schedule', 'employees', 'products', 'export'];
    document.querySelectorAll('header .nav-btn').forEach((b, i) => {
      b.classList.toggle('active', order[i] === id);
    });
    if (id === 'export') renderExport();
    if (id === 'products') renderProductsPage();
  }

  function bindNav() {
    document.querySelectorAll('header .nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => showPage(btn.dataset.page));
    });
  }

  function renderMonthNav() {
    const nav = el('monthNav');
    if (!nav || !MONTHS.length) return;
    nav.innerHTML = MONTHS.map(
      (m) => `
    <div class="sidebar-item ${m.id === currentMonth ? 'active' : ''}" data-month="${m.id}">
      <div class="dot" style="background:var(--accent)"></div>${m.name}
    </div>
  `
    ).join('');
    nav.querySelectorAll('.sidebar-item').forEach((item) => {
      item.addEventListener('click', () => selectMonth(item.dataset.month, item));
    });
  }

  function selectMonth(m, clickedEl) {
    currentMonth = m;
    currentWeek = 0;
    document.querySelectorAll('#monthNav .sidebar-item').forEach((e) => e.classList.remove('active'));
    if (clickedEl) clickedEl.classList.add('active');
    document.querySelectorAll('#monthTabs .month-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.month === m)
    );
    document.querySelectorAll('#exportMonthTabs .month-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.month === m)
    );
    renderSchedule();
    renderExport();
    updateStats();
  }

  function renderMonthTabs() {
    const tabs = el('monthTabs');
    if (!tabs || !MONTHS.length) return;
    tabs.innerHTML = MONTHS.map(
      (m) =>
        `<button type="button" class="month-tab ${m.id === currentMonth ? 'active' : ''}" data-month="${m.id}">${m.name}</button>`
    ).join('');
    tabs.querySelectorAll('.month-tab').forEach((btn) => {
      btn.addEventListener('click', () => selectMonthTab(btn.dataset.month, btn));
    });
  }

  function selectMonthTab(m, clickedBtn) {
    currentMonth = m;
    currentWeek = 0;
    document.querySelectorAll('#monthTabs .month-tab').forEach((t) => t.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');
    document.querySelectorAll('#exportMonthTabs .month-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.month === m)
    );
    MONTHS.forEach((mo, i) => {
      const items = document.querySelectorAll('#monthNav .sidebar-item');
      if (items[i]) items[i].classList.toggle('active', mo.id === m);
    });
    renderSchedule();
    renderExport();
    updateStats();
  }

  function renderExportMonthTabs() {
    const exp = el('exportMonthTabs');
    if (!exp || !MONTHS.length) return;
    exp.innerHTML = MONTHS.map(
      (m) =>
        `<button type="button" class="month-tab ${m.id === currentMonth ? 'active' : ''}" data-month="${m.id}">${m.name}</button>`
    ).join('');
    exp.querySelectorAll('.month-tab').forEach((btn) => {
      btn.addEventListener('click', () => selectExportMonth(btn.dataset.month, btn));
    });
  }

  function selectExportMonth(m, clickedBtn) {
    currentMonth = m;
    document.querySelectorAll('#exportMonthTabs .month-tab').forEach((t) => t.classList.remove('active'));
    if (clickedBtn) clickedBtn.classList.add('active');
    document.querySelectorAll('#monthTabs .month-tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.month === m)
    );
    MONTHS.forEach((mo, i) => {
      const items = document.querySelectorAll('#monthNav .sidebar-item');
      if (items[i]) items[i].classList.toggle('active', mo.id === m);
    });
    renderExport();
  }

  // ---------- FILTERS ----------
  function bindSidebarFilters() {
    document.querySelectorAll('[data-filter-section]').forEach((item) => {
      item.addEventListener('click', () => {
        currentSection = item.dataset.filterSection || 'all';
        document
          .querySelectorAll('.sidebar-section:first-child .sidebar-item')
          .forEach((e) => e.classList.remove('active'));
        item.classList.add('active');
        renderSchedule();
        updateStats();
      });
    });
    document.querySelectorAll('[data-filter-age]').forEach((item) => {
      item.addEventListener('click', () => {
        currentAgeFilter = item.dataset.filterAge || 'all';
        document
          .querySelectorAll('.sidebar-section:nth-child(2) .sidebar-item')
          .forEach((e) => e.classList.remove('active'));
        item.classList.add('active');
        renderSchedule();
      });
    });
  }

  function getFilteredEmps() {
    return employees.filter((e) => {
      if (currentSection !== 'all' && !e.section.includes(currentSection)) return false;
      if (currentAgeFilter === 'adult' && !e.adult) return false;
      if (currentAgeFilter === 'minor' && e.adult) return false;
      return true;
    });
  }

  // ---------- WEEKS ----------
  function getWeeks(month) {
    const m = MONTHS.find((x) => x.id === month);
    if (!m) return [];
    const weeks = [];
    let day = 1;
    while (day <= m.days) {
      let end = day;
      while (end <= m.days && getDayName(month, end) !== 'нд') end++;
      if (end > m.days) end = m.days;
      weeks.push({ start: day, end, label: day + '–' + end });
      day = end + 1;
    }
    return weeks;
  }

  function renderWeekSelector(month) {
    const ws = document.getElementById('weekSelector');
    if (!ws) return;
    const weeks = getWeeks(month);
    ws.innerHTML =
      `<button type="button" class="week-btn ${currentWeek === 0 ? 'active' : ''}" data-week="0">Весь місяць</button>` +
      weeks
        .map(
          (w, i) =>
            `<button type="button" class="week-btn ${currentWeek === i + 1 ? 'active' : ''}" data-week="${i + 1}">Тиж. ${i + 1} (${w.label})</button>`
        )
        .join('');
    ws.querySelectorAll('.week-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentWeek = parseInt(btn.dataset.week, 10) || 0;
        ws.querySelectorAll('.week-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderSchedule();
      });
    });
  }

  function getDaysToShow(month) {
    const m = MONTHS.find((mx) => mx.id === month);
    if (!m) return [];
    if (currentWeek === 0) return Array.from({ length: m.days }, (_, i) => i + 1);
    const weeks = getWeeks(month);
    const w = weeks[currentWeek - 1];
    if (!w) return [];
    const days = [];
    for (let d = w.start; d <= w.end; d++) days.push(d);
    return days;
  }

  // ---------- SCHEDULE ----------
  const SECTION_ORDER = ['сборка', 'ягода', 'стеллажка', 'склад'];
  const SECTION_LABELS = {
    сборка: 'Сборка',
    ягода: 'Ягода',
    стеллажка: 'Стеллажка',
    склад: 'Склад',
  };
  const SECTION_BADGE = {
    сборка: 'badge-green',
    ягода: 'badge-purple',
    стеллажка: 'badge-blue',
    склад: 'badge-green',
  };

  function renderSchedule() {
    const title = el('scheduleTitle');
    if (title) title.textContent = 'Графік — ' + currentMonth;
    renderWeekSelector(currentMonth);
    const days = getDaysToShow(currentMonth);
    const filtered = getFilteredEmps();
    const sections =
      currentSection === 'all'
        ? SECTION_ORDER.filter((s) => filtered.some((e) => e.section === s))
        : [currentSection];

    let html = '';
    for (const sec of sections) {
      const emps = filtered.filter(
        (e) => e.section === sec && (e.hours[currentMonth] || e.vacation)
      );
      if (!emps.length) continue;
      html += renderSectionTable(sec, emps, days);
    }
    if (!html) {
      html =
        '<div class="empty-state"><div class="icon">📭</div>Немає співробітників для відображення</div>';
    }
    const wrap = el('scheduleTables');
    if (wrap) wrap.innerHTML = html;
  }

  function renderSectionTable(sec, emps, days) {
    const dayHeaders = days
      .map((d) => {
        const dn = getDayName(currentMonth, d);
        const wknd = dn === 'нд' || dn === 'сб';
        return `<th class="day-col ${wknd ? 'weekend-col' : ''}">
      <div class="day-num">${d}</div>
      <div class="day-name-h">${dn}</div>
    </th>`;
      })
      .join('');

    const rows = emps.map((e) => renderEmployeeRow(e, days)).join('');

    return `
  <div class="schedule-wrapper" style="margin-bottom:20px">
    <div class="schedule-header">
      <h3>${SECTION_LABELS[sec] || sec}</h3>
      <span class="section-badge ${SECTION_BADGE[sec] || 'badge-blue'}">${emps.length} осіб</span>
    </div>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th class="name-col">Ім'я</th>
        <th class="rate-col">Ставка</th>
        ${dayHeaders}
        <th class="total-col split-col" title="До ${HOURS_NORM_FULL} год × ставка (звичайний час)">Норма</th>
        <th class="total-col split-col" title="Понад норму, до (${HOURS_MAX_FULL}−${HOURS_NORM_FULL}) год × ставка">Біржа</th>
        <th class="total-col">План</th>
        <th class="total-col">Відп.</th>
        <th class="total-col">Всього</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </div>`;
  }

  function renderEmployeeRow(e, days) {
    const monthHours = e.hours[currentMonth] || {};
    const vac = (e.vacation && e.vacation[currentMonth]) || 0;

    const cells = days
      .map((d) => {
        const dn = getDayName(currentMonth, d);
        const wknd = dn === 'нд' || dn === 'сб';
        const val = monthHours[String(d)];
        const isEmpty = val === undefined || val === null || val === '';
        const isVac = isVacationDayValue(val);
        const cls = ['hours-input', isEmpty ? 'empty' : 'has-value', isVac ? 'vacation' : '', wknd ? '' : '']
          .join(' ')
          .trim();
        const displayVal = isEmpty ? '' : String(val);
        return `<td class="hours-cell ${wknd ? 'weekend-col' : ''}">
      <input type="text" class="${cls}" value="${displayVal.replace(/"/g, '&quot;')}"
        data-emp="${e.id}" data-day="${d}" data-month="${currentMonth}"
        title="День ${d}, ${dn}">
    </td>`;
      })
      .join('');

    const planTotal = sumPlanHoursObj(monthHours);
    const grandTotal = planTotal + (parseFloat(vac) || 0);
    const normH = planNormForRate(e.rate);
    const maxH = planMaxForRate(e.rate);
    const { normAttr, birzhAttr, overMax } = splitPlanNormBirzh(planTotal, e.rate);
    let planCellClass = 'total-cell';
    if (planTotal > maxH + 0.01) planCellClass += ' total-plan-over';
    else if (planTotal + 0.01 >= normH) planCellClass += ' total-plan-ok';
    else planCellClass += ' total-plan-under';
    const birzhTitle =
      overMax > 0.01
        ? `Біржа (у межах пулу до ${fmtHoursDisplay(normH + planBirzhPoolForRate(e.rate))}), понадстріл +${fmtHoursDisplay(overMax)} год`
        : `Із плану: до ${fmtHoursDisplay(normH)} год — звичайний час, далі до ${fmtHoursDisplay(maxH)} — біржа`;

    const ageBadge = e.adult
      ? '<span class="age-badge age-adult">18+</span>'
      : '<span class="age-badge age-minor">-18</span>';

    return `<tr>
    <td><div class="name-cell">
      ${ageBadge}
      <span>${escapeHtml(e.name)}</span>
      <span style="margin-left:auto;color:var(--muted);font-size:11px;cursor:pointer"
        data-edit="${e.id}" title="Редагувати">✏️</span>
    </div></td>
    <td class="rate-cell">${e.rate}</td>
    ${cells}
    <td class="total-cell total-cell-norm" title="Частина плану в межах ${fmtHoursDisplay(normH)} год (норма)">${fmtHoursDisplay(normAttr)}</td>
    <td class="total-cell total-cell-birzh" title="${birzhTitle.replace(/"/g, '&quot;')}">${fmtHoursDisplay(birzhAttr)}</td>
    <td class="${planCellClass}" title="Σ план · норма ${fmtHoursDisplay(normH)} год, макс. ${fmtHoursDisplay(maxH)} год (ставка ${e.rate})${
      overMax > 0.01 ? ' · перевищення максимуму!' : ''
    }">${fmtHoursDisplay(planTotal)}${overMax > 0.01 ? '<span class="over-badge">!</span>' : ''}</td>
    <td class="total-cell" style="color:var(--orange)">${fmtHoursDisplay(vac || 0)}</td>
    <td class="total-cell">${fmtHoursDisplay(grandTotal)}</td>
  </tr>`;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function bindScheduleDelegation() {
    const container = el('scheduleTables');
    if (!container) return;
    container.addEventListener('focusin', (ev) => {
      const t = ev.target;
      if (t && t.matches('.hours-input')) {
        t.dataset.prevValue = t.value;
      }
    });
    container.addEventListener('change', async (ev) => {
      const t = ev.target;
      if (t && t.matches('.hours-input')) {
        const empId = parseInt(t.dataset.emp, 10);
        const day = parseInt(t.dataset.day, 10);
        const month = t.dataset.month || currentMonth;
        await updateHours(empId, month, day, t.value, t);
      }
    });
    container.addEventListener('click', (ev) => {
      const ed = ev.target.closest('[data-edit]');
      if (ed && ed.dataset.edit) {
        openEditEmployee(parseInt(ed.dataset.edit, 10));
      }
    });
  }

  async function updateHours(empId, month, day, val, inputEl) {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    if (!emp.hours[month]) emp.hours[month] = {};
    const key = String(day);
    const mh = emp.hours[month];
    const oldContrib = contributionFromStoredValue(mh[key]);

    const revert = () => {
      if (inputEl) {
        inputEl.value = inputEl.dataset.prevValue != null ? inputEl.dataset.prevValue : '';
      }
    };

    const trimmed = val != null ? String(val).trim() : '';
    let newContrib = 0;
    if (trimmed === '' || val === null) {
      newContrib = 0;
    } else if (isVacationDayValue(trimmed) || isVacationDayValue(val)) {
      newContrib = 0;
    } else {
      const num = parseFloat(trimmed.replace(',', '.'));
      if (!isNaN(num)) {
        newContrib = num;
        if (newContrib > MAX_HOURS_PER_DAY + 1e-6) {
          revert();
          showToast('За один день не більше ' + MAX_HOURS_PER_DAY + ' год. плану.', 'error');
          return;
        }
      } else {
        newContrib = 0;
      }
    }

    const totalWithout = sumPlanHoursObj(mh) - oldContrib;
    const newTotal = totalWithout + newContrib;
    const cap = planMaxForRate(emp.rate);

    const parsedNum = parseFloat(trimmed.replace(',', '.'));
    if (trimmed === '' || val === null) {
      delete mh[key];
    } else if (val === 'В' || val === 'в' || trimmed === 'В' || trimmed === 'в') {
      mh[key] = 'В';
    } else if (!isNaN(parsedNum)) {
      mh[key] = parsedNum === 0 ? 0 : parsedNum;
    } else {
      mh[key] = val;
    }

    updateStats();
    try {
      await apiJson('hours.php', {
        method: 'POST',
        body: JSON.stringify({
          employee_id: empId,
          month: month,
          day: day,
          value: val,
        }),
      });
      if (inputEl) inputEl.dataset.prevValue = inputEl.value;
      if (newTotal > cap + 0.01) {
        showToast(
          'Збережено. Увага: план ' +
            fmtHoursDisplay(newTotal) +
            ' год понад індикаторний максимум ' +
            fmtHoursDisplay(cap) +
            ' год (ставка ' +
            emp.rate +
            ').',
          'warn'
        );
      } else {
        showToast('Збережено', 'success');
      }
      renderSchedule();
      updateStats();
    } catch (err) {
      if (inputEl) {
        const saved = inputEl.dataset.prevValue;
        if (saved !== undefined) inputEl.value = saved;
      }
      try {
        await loadState();
      } catch {}
      renderSchedule();
      updateStats();
      showToast(err.message || 'Помилка збереження', 'error');
    }
  }

  // ---------- STATS ----------
  function updateStats() {
    const bar = el('statsBar');
    if (!bar) return;
    const emps = employees.filter((e) => currentSection === 'all' || e.section === currentSection);
    const totalHours = emps.reduce((s, e) => s + sumPlanHoursObj(e.hours[currentMonth] || {}), 0);
    const sumNormCaps = emps.reduce((s, e) => s + planNormForRate(e.rate), 0);
    const sumNormAttr = emps.reduce((s, e) => {
      const pt = sumPlanHoursObj(e.hours[currentMonth] || {});
      return s + splitPlanNormBirzh(pt, e.rate).normAttr;
    }, 0);
    const sumBirzhAttr = emps.reduce((s, e) => {
      const pt = sumPlanHoursObj(e.hours[currentMonth] || {});
      return s + splitPlanNormBirzh(pt, e.rate).birzhAttr;
    }, 0);
    const sumMax = emps.reduce((s, e) => s + planMaxForRate(e.rate), 0);
    const overCount = emps.filter((e) => {
      const p = sumPlanHoursObj(e.hours[currentMonth] || {});
      return p > planMaxForRate(e.rate) + 0.01;
    }).length;
    const totalVac = emps.reduce((s, e) => s + ((e.vacation && e.vacation[currentMonth]) || 0), 0);
    const adults = emps.filter((e) => e.adult).length;
    const minors = emps.filter((e) => !e.adult).length;
    const planVsMaxClass =
      totalHours > sumMax + 0.01 ? 'val-red' : totalHours + 0.01 >= sumNormCaps ? 'val-green' : 'val-blue';

    bar.innerHTML = `
    <div class="stat-card"><div class="val val-blue">${emps.length}</div><div class="lbl">Співробітників</div></div>
    <div class="stat-card"><div class="val val-green">${fmtHoursDisplay(totalHours)}</div><div class="lbl">Год. план (∑)</div></div>
    <div class="stat-card"><div class="val val-green">${fmtHoursDisplay(sumNormAttr)}</div><div class="lbl">У нормі (∑)</div></div>
    <div class="stat-card"><div class="val val-purple">${fmtHoursDisplay(sumBirzhAttr)}</div><div class="lbl">Біржа (∑)</div></div>
    <div class="stat-card"><div class="val val-muted">${fmtHoursDisplay(sumNormCaps)}</div><div class="lbl">Стеля норми (∑)</div></div>
    <div class="stat-card"><div class="val ${planVsMaxClass}">${fmtHoursDisplay(totalHours)} / ${fmtHoursDisplay(sumMax)}</div><div class="lbl">План / макс. (∑)${overCount ? ' · <span style="color:var(--red)">' + overCount + ' понад макс.</span>' : ''}</div></div>
    <div class="stat-card"><div class="val val-orange">${totalVac}</div><div class="lbl">Год. відпустка</div></div>
    <div class="stat-card"><div class="val val-green">${adults}</div><div class="lbl">18+ / <span style="color:var(--red)">${minors}</span> до 18</div></div>
  `;
  }

  // ---------- EMPLOYEES PAGE ----------
  const SECTION_COLORS = { сборка: '#29d988', ягода: '#be185d', стеллажка: '#4f8cff', склад: '#ffd166' };

  function renderEmployees() {
    const searchEl = el('empSearch');
    const secEl = el('empSectionFilter');
    const search = (searchEl && searchEl.value.toLowerCase()) || '';
    const secFilter = (secEl && secEl.value) || 'all';
    let emps = employees.filter((e) => {
      if (search && !e.name.toLowerCase().includes(search)) return false;
      if (secFilter !== 'all' && !e.section.includes(secFilter)) return false;
      return true;
    });

    const grid = el('employeesGrid');
    if (!grid) return;
    if (!emps.length) {
      grid.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1"><div class="icon">🔍</div>Нічого не знайдено</div>';
      return;
    }

    grid.innerHTML = emps
      .map((e) => {
        const color = SECTION_COLORS[e.section] || '#4f8cff';
        const initials = e.name
          .split(' ')
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2);
        const totalHours = MONTHS.reduce((s, m) => {
          const mh = e.hours[m.id] || {};
          return s + Object.values(mh).reduce((ss, v) => ss + (parseFloat(v) || 0), 0);
        }, 0);
        const totalVac = MONTHS.reduce((s, m) => s + ((e.vacation && e.vacation[m.id]) || 0), 0);
        return `
    <div class="employee-card">
      <div class="emp-header">
        <div class="emp-avatar" style="background:${color}22;color:${color}">${initials}</div>
        <div class="emp-info">
          <h4>${escapeHtml(e.name)}</h4>
          <div class="emp-section">${SECTION_LABELS[e.section] || e.section} · ставка ${e.rate} · ${
            e.adult ? '18+' : 'до 18'
          }</div>
        </div>
      </div>
      <div class="emp-stats">
        <div class="emp-stat"><div class="emp-stat-val" style="color:${color}">${totalHours}</div><div class="emp-stat-label">Год. всього</div></div>
        <div class="emp-stat"><div class="emp-stat-val" style="color:var(--orange)">${totalVac}</div><div class="emp-stat-label">Год. відпустка</div></div>
        <div class="emp-stat"><div class="emp-stat-val" style="color:var(--yellow)">${e.rate}</div><div class="emp-stat-label">Ставка</div></div>
      </div>
      <div class="emp-actions">
        <button type="button" class="btn btn-ghost btn-sm" style="flex:1" data-edit-card="${e.id}">✏️ Редагувати</button>
        <button type="button" class="btn btn-sm" style="background:rgba(255,77,109,0.15);color:var(--red)" data-del="${e.id}">🗑️</button>
      </div>
    </div>`;
      })
      .join('');
    grid.querySelectorAll('[data-edit-card]').forEach((btn) => {
      btn.addEventListener('click', () => openEditEmployee(parseInt(btn.dataset.editCard, 10)));
    });
    grid.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => deleteEmployee(parseInt(btn.dataset.del, 10)));
    });
  }

  // ---------- MODAL ----------
  function openAddEmployee() {
    editingEmpId = null;
    el('empModalTitle').textContent = 'Додати співробітника';
    el('empLastName').value = '';
    el('empFirstName').value = '';
    el('empRate').value = '1';
    el('empSection').value = 'сборка';
    empAgeAdult = true;
    updateAgeToggle();
    el('empModal').classList.add('open');
  }

  function openEditEmployee(id) {
    const emp = employees.find((e) => e.id === id);
    if (!emp) return;
    editingEmpId = id;
    const parts = emp.name.split(' ');
    el('empModalTitle').textContent = 'Редагувати співробітника';
    el('empLastName').value = parts[0] || '';
    el('empFirstName').value = parts.slice(1).join(' ') || '';
    el('empRate').value = String(emp.rate);
    el('empSection').value = emp.section;
    empAgeAdult = emp.adult;
    updateAgeToggle();
    el('empModal').classList.add('open');
  }

  function toggleAge() {
    empAgeAdult = !empAgeAdult;
    updateAgeToggle();
  }

  function updateAgeToggle() {
    const t = el('empAgeToggle');
    const l = el('empAgeLabel');
    t.className = 'toggle' + (empAgeAdult ? ' on' : '');
    l.textContent = empAgeAdult ? 'Так — 18+' : 'Ні — до 18 років';
    t.setAttribute('aria-pressed', empAgeAdult ? 'true' : 'false');
  }

  async function saveEmployee() {
    const last = el('empLastName').value.trim();
    const first = el('empFirstName').value.trim();
    if (!last) {
      showToast("Вкажіть прізвище", 'error');
      return;
    }
    const name = last + (first ? ' ' + first : '');
    const rate = parseFloat(el('empRate').value);
    const section = el('empSection').value;

    try {
      if (editingEmpId) {
        await apiJson('employees.php?id=' + editingEmpId, {
          method: 'PUT',
          body: JSON.stringify({ name, rate, section, adult: empAgeAdult }),
        });
        const emp = employees.find((e) => e.id === editingEmpId);
        if (emp) {
          emp.name = name;
          emp.rate = rate;
          emp.section = section;
          emp.adult = empAgeAdult;
        }
        showToast('Збережено', 'success');
      } else {
        const res = await apiJson('employees.php', {
          method: 'POST',
          body: JSON.stringify({ name, rate, section, adult: empAgeAdult }),
        });
        if (res.employee) {
          employees.push(res.employee);
          nextId = Math.max(nextId, res.employee.id + 1);
        }
        showToast('Додано', 'success');
      }
      closeModal('empModal');
      renderEmployees();
      renderSchedule();
      updateStats();
    } catch (err) {
      showToast(err.message || 'Помилка', 'error');
    }
  }

  async function deleteEmployee(id) {
    if (!confirm('Видалити співробітника?')) return;
    try {
      await apiJson('employees.php?id=' + id, { method: 'DELETE' });
      employees = employees.filter((e) => e.id !== id);
      renderEmployees();
      renderSchedule();
      updateStats();
      showToast('Видалено', 'error');
    } catch (err) {
      showToast(err.message || 'Помилка', 'error');
    }
  }

  function closeModal(id) {
    el(id).classList.remove('open');
  }

  // ---------- PRODUCTS PAGE ----------
  function sortProductsByName(list) {
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'uk', { sensitivity: 'base' }));
  }

  function getFilteredProducts() {
    const searchEl = el('productSearch');
    const catEl = el('productCategoryFilter');
    const search = ((searchEl && searchEl.value) || '').toLowerCase().trim();
    const catFilter = (catEl && catEl.value) || 'all';
    const filtered = products.filter((p) => {
      if (catFilter !== 'all' && p.category !== catFilter) return false;
      if (!search) return true;
      const hay = (p.name + ' ' + p.plu + ' ' + p.art).toLowerCase();
      return hay.includes(search);
    });
    return sortProductsByName(filtered);
  }

  function getProductsForSheet() {
    const ordered = [];
    PRODUCT_CATEGORY_ORDER.forEach((cat) => {
      sortProductsByName(products.filter((p) => p.category === cat)).forEach((p) => ordered.push(p));
    });
    sortProductsByName(products.filter((p) => !PRODUCT_CATEGORY_ORDER.includes(p.category))).forEach((p) =>
      ordered.push(p)
    );
    return ordered;
  }

  function getProductSheetSettings(count, pages) {
    if (pages === 2) {
      if (count <= 70) return { cols: 2, font: 8.2, row: 7.6 };
      if (count <= 105) return { cols: 3, font: 7.3, row: 6.8 };
      return { cols: 4, font: 6.5, row: 6.1 };
    }
    if (count <= 45) return { cols: 2, font: 8.2, row: 7.6 };
    if (count <= 84) return { cols: 3, font: 7.2, row: 6.7 };
    if (count <= 150) return { cols: 4, font: 6.2, row: 5.85 };
    return { cols: 5, font: 5.35, row: 5.05 };
  }

  function buildProductsA4Sheet(pageList, pageNo, pageCount, totalCount) {
    const settings = getProductSheetSettings(pageList.length, pageCount);
    const rows = Math.ceil(pageList.length / settings.cols);
    const dateStr = new Date().toLocaleDateString('uk-UA');
    const columns = [];

    for (let col = 0; col < settings.cols; col++) {
      const items = pageList.slice(col * rows, (col + 1) * rows);
      const itemRows = items
        .map((item) => {
          const catColor = PRODUCT_CATEGORY_COLORS[item.category] || '#64748b';
          return `<div class="products-a4-row" style="border-left-color:${catColor}">
            <div class="product-plu">${escapeHtml(item.plu)}</div>
            <div class="product-art">${escapeHtml(item.art || '-')}</div>
            <div class="product-name">${escapeHtml(item.name)}</div>
          </div>`;
        })
        .join('');
      columns.push(`
        <div class="products-a4-col">
          <div class="products-a4-col-head"><span>PLU</span><span>ART</span><span>NAME</span></div>
          ${itemRows}
        </div>`);
    }

    return `
      <div class="products-a4-sheet" style="--sheet-cols:${settings.cols};--sheet-font:${settings.font}px;--sheet-row:${settings.row}mm">
        <div class="products-a4-head">
          <h2>PLU LIST</h2>
          <div>${totalCount} items · page ${pageNo}/${pageCount} · ${dateStr}</div>
        </div>
        <div class="products-a4-columns">${columns.join('')}</div>
      </div>`;
  }

  function buildProductsA4Sheets() {
    const list = getProductsForSheet();
    const pageCount = Math.min(2, Math.max(1, productSheetPages));
    const perPage = Math.ceil(list.length / pageCount);
    const sheets = [];
    for (let page = 0; page < pageCount; page++) {
      const pageList = list.slice(page * perPage, (page + 1) * perPage);
      if (pageList.length) {
        sheets.push(buildProductsA4Sheet(pageList, page + 1, pageCount, list.length));
      }
    }
    return `<div class="products-a4-pack" id="productsExportTable" data-pages="${pageCount}">${sheets.join('')}</div>`;
  }

  function renderProductsManage() {
    const box = el('productsManage');
    if (!box) return;
    const filtered = getFilteredProducts();
    if (!filtered.length) {
      box.innerHTML =
        '<div class="empty-state"><div class="icon">📦</div>Немає товарів. Натисніть «+ Додати товар».</div>';
      return;
    }
    box.innerHTML = `
      <table class="products-manage-table">
        <thead>
          <tr>
            <th>PLU</th>
            <th>ART</th>
            <th>Назва</th>
            <th>Група</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filtered
            .map((p) => {
              const color = PRODUCT_CATEGORY_COLORS[p.category] || '#64748b';
              return `<tr>
                <td class="mono">${escapeHtml(p.plu)}</td>
                <td class="mono">${escapeHtml(p.art || '—')}</td>
                <td>${escapeHtml(p.name)}</td>
                <td><span class="product-cat-badge" style="background:${color}22;color:${color}">${PRODUCT_CATEGORY_LABELS[p.category] || p.category}</span></td>
                <td class="product-actions-cell">
                  <button type="button" class="btn btn-ghost btn-sm" data-edit-product="${p.id}">✏️</button>
                  <button type="button" class="btn btn-sm product-del-btn" data-del-product="${p.id}">🗑️</button>
                </td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;
    box.querySelectorAll('[data-edit-product]').forEach((btn) => {
      btn.addEventListener('click', () => openEditProduct(parseInt(btn.dataset.editProduct, 10)));
    });
    box.querySelectorAll('[data-del-product]').forEach((btn) => {
      btn.addEventListener('click', () => deleteProduct(parseInt(btn.dataset.delProduct, 10)));
    });
  }

  function renderProductsTable() {
    const preview = el('productsTablePreview');
    if (!preview) return;
    if (!products.length) {
      preview.innerHTML = '';
      return;
    }
    preview.innerHTML = buildProductsA4Sheets();
    return;

    const categories = PRODUCT_CATEGORY_ORDER.filter((c) => products.some((p) => p.category === c));
    const thBase =
      'padding:8px 10px;border:1px solid #64748b;font-size:11px;font-weight:700;text-align:center;white-space:nowrap';
    const tdBase = 'padding:7px 10px;border:1px solid #cbd5e1;font-size:11px;text-align:center;vertical-align:middle';

    let html = '';
    for (const cat of categories) {
      const items = sortProductsByName(products.filter((p) => p.category === cat));
      const color = PRODUCT_CATEGORY_COLORS[cat] || '#475569';
      const rows = items
        .map((p, i) => {
          const zebra = i % 2 === 0 ? '#f8fafc' : '#ffffff';
          return `<tr>
            <td style="${tdBase};background:${zebra};font-weight:700;font-family:Consolas,monospace">${escapeHtml(p.plu)}</td>
            <td style="${tdBase};background:${zebra};font-family:Consolas,monospace">${escapeHtml(p.art || '—')}</td>
            <td style="${tdBase};background:${zebra};text-align:left;font-weight:600">${escapeHtml(p.name)}</td>
          </tr>`;
        })
        .join('');

      html += `
        <div style="margin-bottom:24px;break-inside:avoid">
          <div style="background:linear-gradient(90deg,${color}22,${color}11);border:2px solid ${color};padding:10px 14px;margin-bottom:8px;border-radius:6px;font-family:Arial,sans-serif;font-size:13px;font-weight:800;color:#0f172a;letter-spacing:0.04em">${PRODUCT_CATEGORY_LABELS[cat] || cat} <span style="font-weight:600;color:#475569">(${items.length})</span></div>
          <table style="border-collapse:separate;border-spacing:0;width:100%;font-family:Arial,Helvetica,sans-serif;box-shadow:0 1px 0 #334155,0 0 0 1px #334155;border-radius:4px;overflow:hidden">
            <thead><tr>
              <th style="${thBase};background:#0f172a;color:#f8fafc;min-width:80px;border-bottom:2px solid #334155">PLU</th>
              <th style="${thBase};background:#0f172a;color:#f8fafc;min-width:80px;border-bottom:2px solid #334155">ART</th>
              <th style="${thBase};background:#0f172a;color:#f8fafc;text-align:left;min-width:200px;border-bottom:2px solid #334155">Назва</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    const dateStr = new Date().toLocaleDateString('uk-UA');
    preview.innerHTML = `
      <div class="export-preview export-shot" id="productsExportTable">
        <div style="border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:18px">
          <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;margin:0 0 6px;color:#0f172a;letter-spacing:-0.02em">ТОВАРНИЙ — КАТАЛОГ PLU</h2>
          <p style="font-family:Arial,sans-serif;font-size:12px;color:#475569;margin:0;font-weight:600;line-height:1.4">Всього позицій: <strong>${products.length}</strong> · згенеровано ${dateStr}</p>
        </div>
        ${html}
      </div>`;
  }

  function renderProductsPage() {
    renderProductsManage();
    renderProductsTable();
  }

  function setProductSheetPages(pages) {
    productSheetPages = pages === 2 ? 2 : 1;
    document.querySelectorAll('[data-products-pages]').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.productsPages, 10) === productSheetPages);
    });
    renderProductsTable();
  }

  function openAddProduct() {
    editingProductId = null;
    el('productModalTitle').textContent = 'Додати товар';
    el('productPlu').value = '';
    el('productArt').value = '';
    el('productName').value = '';
    el('productCategory').value = 'овочі';
    el('productModal').classList.add('open');
    el('productPlu').focus();
  }

  function openEditProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingProductId = id;
    el('productModalTitle').textContent = 'Редагувати товар';
    el('productPlu').value = p.plu;
    el('productArt').value = p.art;
    el('productName').value = p.name;
    el('productCategory').value = p.category;
    el('productModal').classList.add('open');
  }

  async function saveProduct() {
    const plu = el('productPlu').value.trim();
    const art = el('productArt').value.trim();
    const name = el('productName').value.trim();
    const category = el('productCategory').value;
    if (!plu) {
      showToast('Вкажіть PLU', 'error');
      return;
    }
    if (!name) {
      showToast('Вкажіть назву', 'error');
      return;
    }

    try {
      if (editingProductId) {
        const res = await apiJson('products.php?id=' + editingProductId, {
          method: 'PUT',
          body: JSON.stringify({ plu, art, name, category }),
        });
        const idx = products.findIndex((x) => x.id === editingProductId);
        if (idx >= 0 && res.product) products[idx] = res.product;
        showToast('Збережено', 'success');
      } else {
        const res = await apiJson('products.php', {
          method: 'POST',
          body: JSON.stringify({ plu, art, name, category }),
        });
        if (res.product) {
          products.push(res.product);
          nextProductId = Math.max(nextProductId, res.product.id + 1);
        }
        showToast('Товар додано — таблицю оновлено', 'success');
      }
      closeModal('productModal');
      renderProductsPage();
    } catch (err) {
      showToast(err.message || 'Помилка', 'error');
    }
  }

  async function deleteProduct(id) {
    if (!confirm('Видалити товар?')) return;
    try {
      await apiJson('products.php?id=' + id, { method: 'DELETE' });
      products = products.filter((p) => p.id !== id);
      renderProductsPage();
      showToast('Видалено', 'error');
    } catch (err) {
      showToast(err.message || 'Помилка', 'error');
    }
  }

  function downloadProductsImage() {
    const tableEl = el('productsExportTable');
    if (!tableEl) {
      showToast('Спочатку додайте товари', 'warn');
      return;
    }
    if (typeof html2canvas !== 'function') {
      showToast('html2canvas недоступний', 'error');
      return;
    }
    showToast('Генерую зображення…', 'success');
    const scale = 2;
    const shotWidth = Math.ceil(tableEl.scrollWidth);
    const shotHeight = Math.ceil(tableEl.scrollHeight);
    html2canvas(tableEl, {
      backgroundColor: '#ffffff',
      scale: scale,
      useCORS: true,
      logging: false,
      width: shotWidth,
      height: shotHeight,
      windowWidth: shotWidth,
      windowHeight: shotHeight,
      onclone: function (doc) {
        const shot = doc.getElementById('productsExportTable');
        if (shot) {
          shot.style.width = '210mm';
          shot.style.maxWidth = 'none';
          shot.style.background = '#ffffff';
        }
      },
    })
      .then((canvas) => {
        const link = document.createElement('a');
        link.download = `Каталог_PLU_${new Date().toISOString().slice(0, 10)}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
        showToast('Зображення збережено!', 'success');
      })
      .catch(() => showToast('Помилка генерації', 'error'));
  }

  function printProductsTable() {
    try {
      const tableEl = el('productsExportTable');
      if (!tableEl) {
        showToast('Спочатку додайте товари', 'warn');
        console.error('Таблиця товарів не знайдена');
        return;
      }
      const w = window.open('about:blank', 'BanB1yat');
      if (!w) {
        showToast('Браузер заблокував вікно. Дозвольте спливаючі вікна в настройках.', 'error');
        console.error('window.open було заблоковано браузером');
        return;
      }
      const printContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>PLU list</title>
  <link rel="stylesheet" href="assets/css/main.css">
  <style>
    @page{size:A4 portrait;margin:0}
    html,body{margin:0;background:#fff}
    body{padding:0}
    .products-a4-pack{gap:0!important}
    .products-a4-sheet{box-shadow:none!important;border:0!important;margin:0!important;max-width:none!important}
  </style></head><body>${tableEl.outerHTML}</body></html>`;
      w.document.write(printContent);
      w.document.close();
      setTimeout(() => {
        w.focus();
        w.print();
      }, 500);
      return;
      
      // Збираємо дані з таблиці та групуємо по категоріям
      const rows = tableEl.querySelectorAll('tbody tr');
      const categories = {};
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 4) {
          const category = cells[3]?.textContent?.trim() || 'інше';
          if (!categories[category]) categories[category] = [];
          categories[category].push({
            plu: cells[0]?.textContent?.trim() || '',
            art: cells[1]?.textContent?.trim() || '',
            name: cells[2]?.textContent?.trim() || ''
          });
        }
      });

      const today = new Date().toLocaleDateString('uk-UA');
      const totalCount = rows.length;
      
      let categoryHTML = '';
      const categoryOrder = ['овочі', 'фрукти', 'гриби', 'ягода', 'інше'];
      
      categoryOrder.forEach((cat) => {
        if (!categories[cat]) return;
        const items = categories[cat];
        const itemRows = items
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.plu)}</td><td>${escapeHtml(item.art)}</td><td style="text-align:left;">${escapeHtml(
                item.name
              )}</td></tr>`
          )
          .join('');
        categoryHTML += `<div class="category" style="page-break-inside:avoid;margin-bottom:12px">
    <div class="category-header">${cat.charAt(0).toUpperCase() + cat.slice(1)} (${items.length})</div>
    <table class="data-table"><thead><tr><th style="width:15%;">PLU</th><th style="width:20%;">ART</th><th style="width:65%;">Назва</th></tr></thead><tbody>${itemRows}</tbody></table>
  </div>`;
      });

      const content = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Каталог PLU</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Arial', sans-serif;
      font-size: 7px;
      color: #1a1a1a;
      margin: 0;
      padding: 8mm;
      background: #fff;
      line-height: 1.3;
    }
    .header {
      border-bottom: 3px solid #1a1a1a;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .header h1 {
      margin: 0 0 3px 0;
      font-size: 16px;
      font-weight: bold;
      color: #000;
      letter-spacing: 1px;
    }
    .header p {
      margin: 2px 0;
      font-size: 6px;
      color: #555;
      font-weight: 600;
    }
    .category {
      margin-bottom: 10px;
      break-inside: avoid;
    }
    .category-header {
      background: linear-gradient(to right, #f0f0f0, #ffffff);
      border: 2px solid #666;
      padding: 5px 8px;
      font-weight: bold;
      font-size: 8px;
      color: #1a1a1a;
      margin-bottom: 4px;
      border-radius: 2px;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #999;
      font-size: 6px;
      background: #fff;
    }
    .data-table thead {
      background: #1a1a1a;
      color: #fff;
    }
    .data-table th {
      padding: 4px 3px;
      text-align: center;
      font-weight: bold;
      border: 1px solid #1a1a1a;
      font-size: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .data-table td {
      padding: 3px 4px;
      border: 1px solid #ddd;
      text-align: center;
      font-size: 6px;
    }
    .data-table tbody tr:nth-child(odd) {
      background: #f9f9f9;
    }
    .data-table tbody tr:nth-child(even) {
      background: #fff;
    }
    
    @media print {
      body {
        margin: 8mm;
        padding: 6mm;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .category { page-break-inside: avoid; }
      .data-table { page-break-inside: avoid; }
      .data-table thead { display: table-header-group; }
    }
  </style></head><body>
  <div class="header">
    <h1>ТОВАРНИЙ — КАТАЛОГ PLU</h1>
    <p>Всього позицій: \${totalCount} · генеровано \${today}</p>
  </div>
  \${categoryHTML}
  </body></html>`;

      w.document.write(content);
      w.document.close();
      setTimeout(() => {
        w.focus();
        w.print();
      }, 800);
    } catch (err) {
      console.error('Помилка друку:', err);
      showToast('Помилка: ' + err.message, 'error');
    }
  }

  // ---------- EXPORT ----------
  function renderExport() {
    const m = MONTHS.find((mx) => mx.id === currentMonth);
    if (!m) return;
    const days = Array.from({ length: m.days }, (_, i) => i + 1);
    const sections = SECTION_ORDER.filter((s) => employees.some((e) => e.section === s));

    const cellBorder = '1px solid #64748b';
    const thBase =
      'padding:4px 2px;text-align:center;font-weight:700;font-size:7px;border:' +
      cellBorder +
      ';vertical-align:middle;line-height:1.15';
    const tdBase =
      'padding:3px 2px;text-align:center;font-size:7px;border:' +
      cellBorder +
      ';vertical-align:middle;color:#0f172a';

    let html = '';

    for (const sec of sections) {
      const emps = employees.filter((e) => e.section === sec);
      if (!emps.length) continue;

      const dayHeaders = days
        .map((d) => {
          const dn = getDayName(currentMonth, d);
          const wknd = dn === 'нд' || dn === 'сб';
          const bg = wknd ? '#ffedd5' : '#1e293b';
          const fg = wknd ? '#9a3412' : '#f8fafc';
          return `<th style="${thBase};background:${bg};color:${fg};min-width:22px">${d}<br><span style="font-weight:600;opacity:0.9;font-size:6px">${dn}</span></th>`;
        })
        .join('');

      const rows = emps
        .map((e, rowIdx) => {
          const mh = e.hours[currentMonth] || {};
          const vac = (e.vacation && e.vacation[currentMonth]) || 0;
          const zebra = rowIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
          const cells = days
            .map((d) => {
              const v = mh[String(d)];
              const dn = getDayName(currentMonth, d);
              const wknd = dn === 'нд' || dn === 'сб';
              const bg = wknd ? '#fff7ed' : zebra;
              if (v === undefined || v === null || v === '')
                return `<td style="${tdBase};background:${bg};color:#94a3b8;font-weight:600">—</td>`;
              const vacCell = isVacationDayValue(v);
              const cellColor = vacCell ? '#c2410c' : wknd ? '#c2410c' : '#0f172a';
              const cellStyle = vacCell ? `${tdBase};background:${bg};font-weight:700;color:${cellColor};font-style:italic` : `${tdBase};background:${bg};font-weight:700;color:${cellColor}`;
              return `<td style="${cellStyle}">${v}</td>`;
            })
            .join('');
          const plan = sumPlanHoursObj(mh);
          const normCap = planNormForRate(e.rate);
          const maxH = planMaxForRate(e.rate);
          const { normAttr, birzhAttr } = splitPlanNormBirzh(plan, e.rate);
          const age = e.adult ? '✅' : '🔴';
          const planBg = plan > maxH + 0.01 ? '#fecaca' : plan + 0.01 >= normCap ? '#bbf7d0' : '#e0e7ff';
          return `<tr>
        <td style="${tdBase};text-align:left;font-weight:700;background:${zebra};min-width:100px;border-left:2px solid #334155;font-size:6px">${age} ${escapeHtml(
            e.name
          )}</td>
        <td style="${tdBase};background:${zebra};font-weight:700">${e.rate}</td>
        ${cells}
        <td style="${tdBase};background:${zebra};font-weight:700;color:#166534">${fmtHoursDisplay(normAttr)}</td>
        <td style="${tdBase};background:${zebra};font-weight:700;color:#6b21a8">${fmtHoursDisplay(birzhAttr)}</td>
        <td style="${tdBase};background:${planBg};font-weight:800;color:#1e3a8a;border-left:2px solid #2563eb">${fmtHoursDisplay(plan)}</td>
        <td style="${tdBase};background:#ffedd5;font-weight:700;color:#9a3412">${vac || 0}</td>
        <td style="${tdBase};background:#dbeafe;font-weight:800;color:#1e40af">${fmtHoursDisplay(plan + (parseFloat(vac) || 0))}</td>
      </tr>`;
        })
        .join('');

      html += `
    <div style="margin-bottom:12px;break-inside:avoid">
      <div style="background:linear-gradient(90deg,#e2e8f0,#f1f5f9);border:1px solid #475569;padding:6px 8px;margin-bottom:6px;border-radius:3px;font-family:Arial,sans-serif;font-size:9px;font-weight:800;color:#0f172a;letter-spacing:0.03em">${SECTION_LABELS[sec] || sec}</div>
      <table style="border-collapse:separate;border-spacing:0;width:100%;font-family:Arial,Helvetica,sans-serif;box-shadow:0 1px 0 #334155,0 0 0 1px #334155;border-radius:3px;overflow:hidden">
        <thead><tr>
          <th style="${thBase};text-align:left;background:#0f172a;color:#f8fafc;min-width:96px;border-bottom:1px solid #334155">Ім'я</th>
          <th style="${thBase};background:#0f172a;color:#f8fafc;min-width:32px;border-bottom:1px solid #334155">Ст.</th>
          ${dayHeaders}
          <th style="${thBase};background:#14532d;color:#fff;border-bottom:1px solid #166534">Норма</th>
          <th style="${thBase};background:#581c87;color:#fff;border-bottom:1px solid #6b21a8">Біржа</th>
          <th style="${thBase};background:#1d4ed8;color:#fff;border-bottom:1px solid #1e3a8a">План</th>
          <th style="${thBase};background:#c2410c;color:#fff;border-bottom:1px solid #9a3412">Відп.</th>
          <th style="${thBase};background:#1d4ed8;color:#fff;border-bottom:1px solid #1e3a8a">Всього</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    }

    const preview = el('exportPreview');
    if (preview) {
      preview.innerHTML = `
    <div class="export-preview export-shot" id="exportTable">
      <div style="border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:10px">
        <h2 style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:800;margin:0 0 3px;color:#0f172a;letter-spacing:-0.02em">ТОВАРНИЙ — ГРАФІК</h2>
        <p style="font-family:Arial,sans-serif;font-size:8px;color:#475569;margin:0;font-weight:600;line-height:1.3">${currentMonth} ${scheduleYear} · норма <strong>${HOURS_NORM_FULL}×ст.</strong>; біржа <strong>${HOURS_MAX_FULL}×ст.</strong>; <strong>0</strong> або <strong>В</strong> = відпустка.</p>
      </div>
      ${html}
    </div>`;
    }
  }

  function downloadTableImage() {
    const tableEl = el('exportTable');
    if (!tableEl || typeof html2canvas !== 'function') {
      showToast('html2canvas недоступний', 'error');
      return;
    }
    showToast('Генерую зображення (вища якість)…', 'success');
    const rect = tableEl.getBoundingClientRect();
    const scale = 2;
    html2canvas(tableEl, {
      backgroundColor: '#ffffff',
      scale: scale,
      useCORS: true,
      logging: false,
      width: Math.ceil(tableEl.scrollWidth),
      height: Math.ceil(tableEl.scrollHeight),
      windowWidth: Math.ceil(rect.width),
      windowHeight: Math.ceil(rect.height),
      onclone: function (doc) {
        const shot = doc.getElementById('exportTable');
        if (shot) {
          shot.style.padding = '12px';
          shot.style.background = '#ffffff';
        }
      },
    })
      .then((canvas) => {
        const link = document.createElement('a');
        link.download = `Графік_${currentMonth}_${new Date().toISOString().slice(0, 10)}.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
        showToast('Зображення збережено!', 'success');
      })
      .catch(() => showToast('Помилка генерації', 'error'));
  }

  function printTable() {
    try {
      const tableEl = el('exportTable');
      if (!tableEl) {
        showToast('Графік не знайдений', 'warn');
        console.error('Графік не знайдений');
        return;
      }
      const w = window.open('about:blank', 'BanB1yat');
      if (!w) {
        showToast('Браузер заблокував вікно. Дозвольте спливаючі вікна в настройках.', 'error');
        console.error('window.open було заблоковано браузером');
        return;
      }
      const html = tableEl.outerHTML;
      const monthName = MONTHS.find(m => m.id === currentMonth)?.id || currentMonth;
      const today = new Date().toLocaleDateString('uk-UA');
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Графік ${monthName}</title>
  <style>
    *{box-sizing:border-box}
    body{
      font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
      font-size:9px;
      color:#1a202c;
      margin:0;
      padding:10px;
      background:#f8fafc;
    }
    .header{
      text-align:center;
      margin-bottom:10px;
      border-bottom:2px solid #059669;
      padding-bottom:6px;
    }
    .header h1{
      margin:0 0 2px 0;
      font-size:15px;
      color:#065f46;
      font-weight:700;
    }
    .header p{
      margin:1px 0;
      color:#64748b;
      font-size:8px;
    }
    table{
      border-collapse:collapse;
      width:100%;
      background:#fff;
      border-radius:4px;
      overflow:hidden;
      font-size:7px;
    }
    thead{
      background:linear-gradient(135deg,#059669 0%,#047857 100%);
      color:#fff;
    }
    th{
      padding:4px 2px;
      text-align:center;
      font-weight:600;
      border:1px solid #066e46;
      font-size:7px;
      text-transform:uppercase;
      letter-spacing:0.2px;
    }
    tbody tr{
      border-bottom:1px solid #e2e8f0;
    }
    tbody tr:nth-child(even){
      background:#ecfdf5;
    }
    tbody tr:nth-child(odd){
      background:#f0fdf4;
    }
    td{
      padding:3px 2px;
      text-align:center;
      border:1px solid #cbd5e1;
      font-size:7px;
    }
    .footer{
      margin-top:8px;
      text-align:right;
      font-size:7px;
      color:#94a3b8;
      border-top:1px solid #e2e8f0;
      padding-top:5px;
    }
    @media print{
      body{margin:6mm;background:#fff;padding:8px;-webkit-print-color-adjust:exact}
      .header{margin-bottom:8px;padding-bottom:4px}
      .header h1{font-size:13px;margin-bottom:1px}
      .header p{font-size:7px}
      table{page-break-inside:avoid}
      tr{page-break-inside:avoid}
      th{padding:3px 1px;font-size:6px}
      td{padding:2px 1px;font-size:6px}
      .footer{display:none}
    }
  </style></head><body>
  <div class="header">
    <h1>📅 ГРАФІК РОБОТИ: ${monthName.toUpperCase()}</h1>
    <p>Дата: ${today}</p>
  </div>
  ${html}
  <div class="footer">Генеровано автоматично • Товарний графік BanB1yat</div>
  </body></html>`);
      w.document.close();
      setTimeout(() => {
        w.focus();
        w.print();
      }, 600);
    } catch (err) {
      console.error('Помилка друку:', err);
      showToast('Помилка: ' + err.message, 'error');
    }
  }

  // ---------- EXPORT ----------
  function exportTableToCSV(tableEl, filename) {
    if (!tableEl) return;
    const rows = tableEl.querySelectorAll('tr');
    const csv = [];
    rows.forEach((row) => {
      const cells = row.querySelectorAll('th, td');
      const rowData = Array.from(cells).map((cell) => {
        let text = cell.textContent.trim();
        text = text.replace(/"/g, '""');
        return text.includes(',') ? `"${text}"` : text;
      });
      csv.push(rowData.join(','));
    });
    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,%EF%BB%BF' + encodeURIComponent(csv.join('\n'));
    link.download = filename + '.csv';
    link.click();
  }

  function exportTableToPDF(tableEl, filename) {
    if (!tableEl) {
      showToast('Таблиця не знайдена', 'warn');
      return;
    }
    const pdf = window.html2pdf || window.html2PDF;
    if (typeof pdf === 'undefined') {
      console.error('html2pdf не доступна. Попытайтесь еще раз.');
      showToast('Библиотека загружается... Попытайтесь знову', 'warn');
      setTimeout(() => exportTableToPDF(tableEl, filename), 1000);
      return;
    }
    try {
      showToast('Генерирую PDF...', 'success');
      const element = tableEl.cloneNode(true);
      const opt = {
        margin: 3,
        filename: filename + '.pdf',
        image: { type: 'png' },
        html2canvas: { scale: 1.5, useCORS: true, logging: false },
        jsPDF: { orientation: 'landscape', unit: 'mm', format: 'a4' },
      };
      pdf(opt).from(element).save();
      showToast('PDF сохранен!', 'success');
    } catch (err) {
      console.error('Ошибка при сохранении PDF:', err);
      showToast('Ошибка: ' + err.message, 'error');
    }
  }

  function exportGraphToCSV() {
    try {
      const tableEl = el('exportTable');
      if (!tableEl) {
        showToast('Таблиця не знайдена', 'warn');
        return;
      }
      exportTableToCSV(tableEl, `Графік-${currentMonth}`);
      showToast('Експортовано в CSV', 'success');
    } catch (err) {
      console.error('Помилка CSV:', err);
      showToast('Помилка при експорті: ' + err.message, 'error');
    }
  }

  function exportGraphToPDF() {
    try {
      const tableEl = el('exportTable');
      if (!tableEl) {
        showToast('Таблиця не знайдена', 'warn');
        return;
      }
      if (typeof window.html2pdf === 'undefined') {
        console.error('html2pdf не завантажена');
        showToast('Бібліотека html2pdf недоступна. Використайте «Друк»', 'warn');
        return;
      }
      exportTableToPDF(tableEl, `Графік-${currentMonth}`);
    } catch (err) {
      console.error('Помилка PDF:', err);
      showToast('Помилка при експорті: ' + err.message, 'error');
    }
  }

  function exportProductsToCSV() {
    try {
      const tableEl = el('productsExportTable');
      if (!tableEl) {
        showToast('Таблиця не знайдена', 'warn');
        return;
      }
      exportTableToCSV(tableEl, 'Каталог-PLU');
      showToast('Експортовано в CSV', 'success');
    } catch (err) {
      console.error('Помилка CSV:', err);
      showToast('Помилка при експорті: ' + err.message, 'error');
    }
  }

  function exportProductsToPDF() {
    try {
      const tableEl = el('productsExportTable');
      if (!tableEl) {
        showToast('Таблиця не знайдена', 'warn');
        return;
      }
      if (typeof window.html2pdf === 'undefined') {
        console.error('html2pdf не завантажена');
        showToast('Бібліотека html2pdf недоступна. Використайте «Друк»', 'warn');
        return;
      }
      showToast('Генерирую PDF A4...', 'success');
      const element = tableEl.cloneNode(true);
      element.style.width = '210mm';
      element.style.maxWidth = 'none';
      const opt = {
        margin: 0,
        filename: 'Каталог-PLU.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { orientation: 'portrait', unit: 'mm', format: 'a4' },
        pagebreak: { mode: ['css', 'avoid-all'] },
      };
      window.html2pdf().set(opt).from(element).save();
    } catch (err) {
      console.error('Помилка PDF:', err);
      showToast('Помилка при експорті: ' + err.message, 'error');
    }
  }

  // ---------- SYNC ----------
  async function saveAll() {
    try {
      const data = await apiJson('sync.php', {
        method: 'POST',
        body: JSON.stringify({ employees }),
      });
      employees = data.employees || employees;
      nextId = data.nextId || nextId;
      MONTHS = data.months || MONTHS;
      if (typeof data.schedule_year === 'number') {
        scheduleYear = data.schedule_year;
      }
      showToast('Усі дані записано в базу', 'success');
      renderMonthNav();
      renderMonthTabs();
      renderExportMonthTabs();
      renderSchedule();
      renderEmployees();
      updateStats();
    } catch (err) {
      showToast(err.message || 'Помилка збереження', 'error');
    }
  }

  // ---------- TOAST ----------
  let toastTimer;
  function showToast(msg, type) {
    type = type || 'success';
    const t = el('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    const ms = type === 'warn' ? 4200 : 2600;
    toastTimer = setTimeout(() => {
      t.className = 'toast';
    }, ms);
  }

  // ---------- INIT ----------
  async function init() {
    document.body.classList.add('is-loading');
    try {
      await loadState();
      await loadProducts();
    } catch (e) {
      showToast(e.message || 'Не вдалося завантажити дані (запустіть PHP-сервер)', 'error');
      document.body.classList.remove('is-loading');
      return;
    }
    document.body.classList.remove('is-loading');

    renderMonthNav();
    renderMonthTabs();
    renderExportMonthTabs();
    renderSchedule();
    renderEmployees();
    renderProductsPage();
    renderExport();
    updateStats();

    bindNav();
    bindSidebarFilters();
    bindScheduleDelegation();

    el('btnAddEmployee').addEventListener('click', openAddEmployee);
    el('btnAddEmployee2').addEventListener('click', openAddEmployee);
    el('btnSaveAll').addEventListener('click', saveAll);
    el('empSearch').addEventListener('input', renderEmployees);
    el('empSectionFilter').addEventListener('change', renderEmployees);

    el('btnDownloadImage').addEventListener('click', downloadTableImage);
    el('btnPrint').addEventListener('click', printTable);
    el('btnExportGraphPDF').addEventListener('click', exportGraphToPDF);
    el('btnExportGraphCSV').addEventListener('click', exportGraphToCSV);

    el('btnAddProduct').addEventListener('click', openAddProduct);
    el('productSearch').addEventListener('input', renderProductsManage);
    el('productCategoryFilter').addEventListener('change', renderProductsManage);
    el('btnDownloadProductsImage').addEventListener('click', downloadProductsImage);
    el('btnPrintProducts').addEventListener('click', printProductsTable);
    el('btnExportProductsPDF').addEventListener('click', exportProductsToPDF);
    el('btnExportProductsCSV').addEventListener('click', exportProductsToCSV);
    document.querySelectorAll('[data-products-pages]').forEach((btn) => {
      btn.addEventListener('click', () => setProductSheetPages(parseInt(btn.dataset.productsPages, 10)));
    });
    el('productModalCancel').addEventListener('click', () => closeModal('productModal'));
    el('productModalSave').addEventListener('click', saveProduct);

    el('empModalCancel').addEventListener('click', () => closeModal('empModal'));
    el('empModalSave').addEventListener('click', saveEmployee);
    el('empAgeToggle').addEventListener('click', toggleAge);

    document.querySelectorAll('.modal-overlay').forEach((m) => {
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.remove('open');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
