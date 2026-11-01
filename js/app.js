import { saveRecord, updateRecord, deleteRecord, batchSaveRecords, subscribeRecords } from './firebase-config.js';
import { generateDayEntries, generateDateRange, todayStr, UNITS, UNIT_AREAS, STAFF } from './auto-generate.js';

// ── STATE ──────────────────────────────────────────────────────────────────────
let allRecords  = [];
let activeUnit  = localStorage.getItem('rc_active_unit') || 'Unit 11';
let activeDate  = todayStr();   // single-day filter (default = today)
let searchQuery = '';
let editingId   = null;
let isOnline    = navigator.onLine;

// ── HELPERS ───────────────────────────────────────────────────────────────────
const pad     = n => String(n).padStart(2, '0');
const fmtDate = d => { if (!d) return ''; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

function fmtDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function methodClass(method) {
  if (!method) return 'mb-dry';
  const m = method.toLowerCase();
  if (m.includes('vacuum'))   return 'mb-vacuum';
  if (m.includes('sanitize')) return 'mb-sanitize';
  if (m.includes('wet'))      return 'mb-wet';
  if (m.includes('sweep'))    return 'mb-sweep';
  if (m.includes('dry'))      return 'mb-dry';
  if (m.includes('dust'))     return 'mb-dust';
  return 'mb-dry';
}

function methodSVG(method) {
  if (!method) return svgDroplet();
  const m = method.toLowerCase();
  if (m.includes('vacuum'))   return svgVacuum();
  if (m.includes('sanitize')) return svgSanitize();
  if (m.includes('wet'))      return svgDroplet();
  if (m.includes('sweep'))    return svgSweep();
  if (m.includes('dry'))      return svgLeaf();
  if (m.includes('dust'))     return svgWind();
  return svgDroplet();
}

function svgDroplet()  { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`; }
function svgVacuum()   { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`; }
function svgSanitize() { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M12 22C6 22 2 17 2 11V5l10-3 10 3v6c0 6-4 11-10 11z"/></svg>`; }
function svgSweep()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M3 21h18M3 7l9-4 9 4M4 7v14M20 7v14M9 21V7M15 21V7"/></svg>`; }
function svgLeaf()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`; }
function svgWind()     { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>`; }

function clockSVG()    { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="opacity:.5;flex-shrink:0"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`; }

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3500);
}

function showLoader(v) {
  document.getElementById('loader-bar').style.display = v ? 'block' : 'none';
}

function updateCloudBadge() {
  const b = document.getElementById('cloud-badge');
  if (isOnline) {
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><polyline points="8 14 11 17 16 11"/></svg> Cloud Synced`;
    b.className = 'cloud-badge online';
  } else {
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9.34 9.34A5 5 0 0 0 9 11H5a4 4 0 0 0 0 8h13a3 3 0 0 0 .46-5.97"/></svg> Offline`;
    b.className = 'cloud-badge offline';
  }
}
window.addEventListener('online',  () => { isOnline = true;  updateCloudBadge(); });
window.addEventListener('offline', () => { isOnline = false; updateCloudBadge(); });

// ── CHECK TODAY — auto-generate entries for today if missing ──────────────────
let _generatingToday = false; // guard against duplicate writes
function checkAndGenerateToday() {
  if (_generatingToday) return;
  const today = todayStr();
  const missing = UNITS.filter(unit =>
    !allRecords.some(r => r.date === today && (r.unit || 'Unit 11') === unit)
  );
  if (!missing.length) return;
  _generatingToday = true;
  Promise.all(missing.map(unit => {
    const entries = generateDayEntries(today).filter(e => e.unit === unit);
    return batchSaveRecords(entries);
  })).catch(console.error).finally(() => { _generatingToday = false; });
}

// ── DATE CONTROLS ────────────────────────────────────────────────────────────
function syncDateUI() {
  const isToday = activeDate === todayStr();
  const btnToday  = document.getElementById('btn-today');
  const pickerBtn = document.getElementById('btn-pick-date');
  const pickerTxt = document.getElementById('date-picker-text');
  const datePicker= document.getElementById('date-picker');
  const btnNext   = document.getElementById('btn-next-day');

  if (btnToday)   btnToday.classList.toggle('active', isToday);
  if (datePicker) datePicker.value = isToday ? '' : activeDate;
  if (pickerBtn)  pickerBtn.classList.toggle('has-date', !isToday);
  if (pickerTxt)  pickerTxt.textContent = isToday ? 'Select Date' : fmtDate(activeDate);
  if (btnNext)    btnNext.disabled = activeDate >= todayStr();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

window.setToday = function() {
  activeDate = todayStr();
  syncDateUI();
  renderAll();
};

window.goToPrevDay = function() {
  activeDate = addDays(activeDate, -1);
  syncDateUI();
  renderAll();
};

window.goToNextDay = function() {
  if (activeDate >= todayStr()) return;
  activeDate = addDays(activeDate, +1);
  syncDateUI();
  renderAll();
};

// ── UNIT CONTROL ─────────────────────────────────────────────────────────────
window.setActiveUnit = function(unit) {
  activeUnit = unit;
  localStorage.setItem('rc_active_unit', unit);
  document.getElementById('unit-btn-11')?.classList.toggle('active', unit === 'Unit 11');
  document.getElementById('unit-btn-12')?.classList.toggle('active', unit === 'Unit 12');
  renderAll();
};

// ── RENDER ALL ────────────────────────────────────────────────────────────────
function renderAll() {
  renderStatCards();
  renderDateHeading();
  renderTable();
  renderNavBadge();
}

function renderNavBadge() {
  const unitRecs = allRecords.filter(r => (r.unit || 'Unit 11') === activeUnit);
  const el = document.getElementById('nav-count');
  if (el) el.textContent = unitRecs.length;
}

// ── STAT CARDS ────────────────────────────────────────────────────────────────
function renderStatCards() {
  const unitRecs = allRecords.filter(r => (r.unit || 'Unit 11') === activeUnit);
  const todayRecs = unitRecs.filter(r => r.date === todayStr());
  const racks = new Set(todayRecs.map(r => r.rackId)).size;

  document.getElementById('stat-total').textContent   = unitRecs.length;
  document.getElementById('stat-racks').textContent   = racks;
  document.getElementById('stat-pending').textContent = 0; // all auto-generated = done

  // Period card
  const isToday = activeDate === todayStr();
  const periodEl = document.getElementById('stat-period');
  const periodSub = document.getElementById('stat-period-sub');
  if (periodEl) {
    if (isToday) {
      periodEl.textContent = 'Today';
    } else {
      const d = new Date(activeDate + 'T00:00:00');
      periodEl.textContent = d.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
    }
  }
  if (periodSub) periodSub.textContent = 'Current Period';
}

// ── DATE HEADING ──────────────────────────────────────────────────────────────
function renderDateHeading() {
  const headingEl = document.getElementById('records-date-heading');
  const subEl     = document.getElementById('records-date-sub');
  const isToday   = activeDate === todayStr();

  if (headingEl) {
    headingEl.textContent = isToday ? "Today's Cleaning Records" : fmtDateLong(activeDate);
  }
  if (subEl) {
    subEl.textContent = isToday ? fmtDateLong(todayStr()) : '';
  }
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
function renderTable() {
  let recs = allRecords.filter(r =>
    (r.unit || 'Unit 11') === activeUnit && r.date === activeDate
  );

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    recs = recs.filter(r =>
      (r.date || '').includes(q) ||
      (r.rackId || '').toLowerCase().includes(q) ||
      (r.area || '').toLowerCase().includes(q) ||
      (r.checkedBy || '').toLowerCase().includes(q) ||
      (r.method || '').toLowerCase().includes(q) ||
      (r.remarks || '').toLowerCase().includes(q)
    );
  }

  // Sort by time ascending
  recs.sort((a, b) => (a.cleaningTime || '').localeCompare(b.cleaningTime || ''));

  const tbody = document.getElementById('records-tbody');
  if (!recs.length) {
    const msg = searchQuery
      ? `No records match "${searchQuery}".`
      : `No records for ${activeDate === todayStr() ? 'today' : fmtDate(activeDate)}.`;
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:.25;margin-bottom:10px">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
        <rect x="9" y="3" width="6" height="4" rx="1"/>
        <path d="M9 12h6M9 16h4"/>
      </svg>
      <div>${msg}</div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = recs.map((r, i) => {
    const rackKey   = (r.rackId || '').replace(/\s+/g, '').toLowerCase(); // 'rack1','rack2','rack3'
    const rackClass = 'rack-' + rackKey;
    const mClass    = methodClass(r.method);
    const mIcon     = methodSVG(r.method);
    return `<tr>
      <td>${i + 1}</td>
      <td>${fmtDate(r.date)}</td>
      <td><span class="rack-badge ${rackClass}">${r.rackId || '—'}</span></td>
      <td>${r.area || '—'}</td>
      <td><span class="td-time">${clockSVG()}${r.cleaningTime || '—'}</span></td>
      <td><span class="method-badge ${mClass}">${mIcon}${r.method || '—'}</span></td>
      <td>${r.checkedBy || '—'}</td>
      <td class="td-remarks">${r.remarks || '—'}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn" title="Edit" onclick="openEditRecord('${r.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn del" title="Delete" onclick="confirmDelete('${r.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
window.openEditRecord = id => openModal(id);

function openModal(id) {
  editingId = id;
  const rec = id ? allRecords.find(r => r.id === id) : null;
  document.getElementById('modal-title').textContent = id ? 'Edit Cleaning Record' : 'New Cleaning Record';

  const form = document.getElementById('modal-form');
  form['m-date'].value      = rec?.date         || activeDate;
  form['m-unit'].value      = rec?.unit         || activeUnit;
  form['m-rackId'].value    = rec?.rackId       || 'Rack 1';
  form['m-time'].value      = rec?.cleaningTime || '';
  form['m-done'].checked    = rec?.cleaningDone !== false;
  form['m-method'].value    = rec?.method       || 'Dry Wipe';
  form['m-checkedBy'].value = rec?.checkedBy    || '';
  form['m-remarks'].value   = rec?.remarks      || '';

  updateModalAreas();
  if (rec?.area) {
    setTimeout(() => { form['m-area'].value = rec.area; }, 0);
  }

  document.getElementById('modal-overlay').classList.add('open');
}

function updateModalAreas() {
  const unit  = document.getElementById('m-unit').value;
  const areas = UNIT_AREAS[unit] || [];
  document.getElementById('m-area').innerHTML =
    areas.map(a => `<option value="${a}">${a}</option>`).join('');
  const staff = STAFF[unit] || [];
  document.getElementById('dl-staff').innerHTML =
    staff.map(s => `<option value="${s}">`).join('');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

async function saveModal() {
  const form = document.getElementById('modal-form');
  const data = {
    date:          form['m-date'].value,
    unit:          form['m-unit'].value,
    rackId:        form['m-rackId'].value,
    area:          form['m-area'].value,
    cleaningTime:  form['m-time'].value,
    cleaningDone:  form['m-done'].checked,
    method:        form['m-method'].value,
    checkedBy:     form['m-checkedBy'].value.trim(),
    remarks:       form['m-remarks'].value.trim(),
    autoGenerated: false,
  };
  if (!data.date || !data.rackId || !data.unit) {
    showToast('Fill required fields.', 'error'); return;
  }
  const btn = document.getElementById('modal-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (editingId) { await updateRecord(editingId, data); showToast('Updated ✓'); }
    else           { await saveRecord(data);              showToast('Saved ✓'); }
    closeModal();
    // Switch unit + date to match saved record
    activeUnit = data.unit;
    activeDate = data.date;
    localStorage.setItem('rc_active_unit', activeUnit);
    // Sync unit buttons
    document.getElementById('unit-btn-11')?.classList.toggle('active', activeUnit === 'Unit 11');
    document.getElementById('unit-btn-12')?.classList.toggle('active', activeUnit === 'Unit 12');
    // Sync date controls
    syncDateUI();
  } catch (e) {
    console.error(e);
    showToast('Error saving.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Record';
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
window.confirmDelete = function(id) {
  const rec = allRecords.find(r => r.id === id);
  if (!confirm(`Delete record for ${fmtDate(rec?.date)} – ${rec?.rackId || ''}?`)) return;
  deleteRecord(id)
    .then(() => showToast('Deleted.'))
    .catch(() => showToast('Delete failed.', 'error'));
};

// ── EXPORT ────────────────────────────────────────────────────────────────────
function exportCSV() {
  // Export all records for selected unit (all time)
  const recs = allRecords
    .filter(r => (r.unit || 'Unit 11') === activeUnit)
    .sort((a,b) => a.date.localeCompare(b.date) || (a.cleaningTime||'').localeCompare(b.cleaningTime||''));

  const header = ['#','Date','Unit','Rack','Area','Time','Done','Method','Checked By','Remarks'];
  const rows   = recs.map((r, i) => [
    i+1, fmtDate(r.date), r.unit, r.rackId, r.area,
    r.cleaningTime, r.cleaningDone ? 'Yes' : 'No',
    r.method, r.checkedBy, r.remarks
  ].map(v => `"${String(v||'').replace(/"/g,'""')}"`));

  const csv  = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: `RackCleaning_${activeUnit.replace(' ','')}_${todayStr()}.csv`
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported ✓');
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
window.toggleSettings = function() {
  const p = document.getElementById('settings-panel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
};

// ── SIDEBAR TOGGLE (mobile) ───────────────────────────────────────────────────
window.toggleSidebar = function() {
  document.getElementById('sidebar')?.classList.toggle('open');
};

// ── INIT ───────────────────────────────────────────────────────────────────────
function init() {
  updateCloudBadge();
  showLoader(true);

  // Restore unit from storage
  const storedUnit = localStorage.getItem('rc_active_unit') || 'Unit 11';
  activeUnit = storedUnit;
  document.getElementById('unit-btn-11')?.classList.toggle('active', activeUnit === 'Unit 11');
  document.getElementById('unit-btn-12')?.classList.toggle('active', activeUnit === 'Unit 12');

  // Default date = today
  activeDate = todayStr();
  syncDateUI();

  // Today button
  document.getElementById('btn-today')?.addEventListener('click', window.setToday);

  // Prev / Next day arrows
  document.getElementById('btn-prev-day')?.addEventListener('click', window.goToPrevDay);
  document.getElementById('btn-next-day')?.addEventListener('click', window.goToNextDay);

  // Date picker button — use showPicker() API (Chrome 99+, Firefox 101+)
  const datePicker = document.getElementById('date-picker');
  const btnPickDate = document.getElementById('btn-pick-date');
  if (datePicker) {
    datePicker.max = todayStr();
    datePicker.addEventListener('change', e => {
      if (!e.target.value) return;
      activeDate = e.target.value;
      syncDateUI();
      renderAll();
    });
  }
  if (btnPickDate) {
    btnPickDate.addEventListener('click', e => {
      e.preventDefault();
      const dp = document.getElementById('date-picker');
      if (!dp) return;
      try { dp.showPicker(); }
      catch(_) { dp.focus(); dp.click(); }
    });
  }

  // Unit buttons
  document.getElementById('unit-btn-11')?.addEventListener('click', () => window.setActiveUnit('Unit 11'));
  document.getElementById('unit-btn-12')?.addEventListener('click', () => window.setActiveUnit('Unit 12'));

  // Search
  document.getElementById('search-input')?.addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderTable();
  });

  // New Record
  document.getElementById('btn-new')?.addEventListener('click', () => openModal(null));

  // Export
  document.getElementById('btn-export')?.addEventListener('click', exportCSV);

  // Modal events
  document.getElementById('modal-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-save')?.addEventListener('click', saveModal);
  document.getElementById('m-unit')?.addEventListener('change', updateModalAreas);

  // Subscribe Firestore
  subscribeRecords(records => {
    allRecords = records;
    checkAndGenerateToday();
    renderAll();
    showLoader(false);
  });
}

// ── START ─────────────────────────────────────────────────────────────────────
init();
