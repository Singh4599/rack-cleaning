import { saveRecord, updateRecord, deleteRecord, batchSaveRecords, subscribeRecords } from './firebase-config.js';
import { generateDayEntries, generateDateRange, todayStr, STAFF } from './auto-generate.js';

// ── STATE ──────────────────────────────────────────────────────────────────────
let allRecords  = [];
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

// ── CHECK TODAY — auto-generate entries if missing ────────────────────────────
let _todayConfirmed = false;

function checkAndGenerateToday() {
  if (_todayConfirmed) return;
  const today = todayStr();
  const hasEntries = allRecords.some(r => r.date === today);
  if (hasEntries) {
    _todayConfirmed = true;
  } else {
    _todayConfirmed = true;
    const entries = generateDayEntries(today);
    batchSaveRecords(entries).catch(err => {
      _todayConfirmed = false;
      console.error(err);
    });
  }
}

// ── DEDUP — remove duplicate Firestore records for a given date ────────────────
async function deduplicateDate(dateStr) {
  const dayRecs = allRecords.filter(r => r.date === dateStr);
  const seen = new Map();
  const toDelete = [];
  // Sort oldest first (keep oldest, delete newer duplicates)
  [...dayRecs]
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
    .forEach(r => {
      // Key: rack + time (unique per cleaning event)
      const key = `${r.rackId}|${r.cleaningTime}`;
      if (seen.has(key)) {
        toDelete.push(r.id);
      } else {
        seen.set(key, r.id);
      }
    });
  if (toDelete.length) {
    await Promise.all(toDelete.map(id => deleteRecord(id)));
    console.log(`🧹 Deduped ${toDelete.length} records for ${dateStr}`);
    showToast(`Removed ${toDelete.length} duplicate entries ✓`);
  }
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

// ── RENDER ALL ────────────────────────────────────────────────────────────────
function renderAll() {
  renderStatCards();
  renderDateHeading();
  renderTable();
  renderNavBadge();
}

function renderNavBadge() {
  const el = document.getElementById('nav-count');
  if (el) el.textContent = allRecords.length;
}

// ── STAT CARDS ────────────────────────────────────────────────────────────────
function renderStatCards() {
  const todayRecs = allRecords.filter(r => r.date === todayStr());
  const racks = new Set(todayRecs.map(r => r.rackId)).size;

  document.getElementById('stat-total').textContent   = allRecords.length;
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
  let recs = allRecords.filter(r => r.date === activeDate);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    recs = recs.filter(r =>
      (r.date || '').includes(q) ||
      (r.rackId || '').toLowerCase().includes(q) ||
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
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">
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
  form['m-rackId'].value    = rec?.rackId       || 'Rack 1';
  form['m-time'].value      = rec?.cleaningTime || '';
  form['m-done'].checked    = rec?.cleaningDone !== false;
  form['m-method'].value    = rec?.method       || 'Dry Wipe';
  form['m-checkedBy'].value = rec?.checkedBy    || '';
  form['m-remarks'].value   = rec?.remarks      || '';

  updateModalStaff();
  document.getElementById('modal-overlay').classList.add('open');
}

function updateModalStaff() {
  document.getElementById('dl-staff').innerHTML =
    STAFF.map(s => `<option value="${s}">`).join('');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

async function saveModal() {
  const form = document.getElementById('modal-form');
  const data = {
    date:          form['m-date'].value,
    rackId:        form['m-rackId'].value,
    cleaningTime:  form['m-time'].value,
    cleaningDone:  form['m-done'].checked,
    method:        form['m-method'].value,
    checkedBy:     form['m-checkedBy'].value.trim(),
    remarks:       form['m-remarks'].value.trim(),
    autoGenerated: false,
  };
  if (!data.date || !data.rackId) {
    showToast('Fill required fields.', 'error'); return;
  }
  const btn = document.getElementById('modal-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (editingId) { await updateRecord(editingId, data); showToast('Updated ✓'); }
    else           { await saveRecord(data);              showToast('Saved ✓'); }
    closeModal();
    // Switch date to match saved record
    activeDate = data.date;
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
  // Export all records (all time)
  const recs = allRecords
    .sort((a,b) => a.date.localeCompare(b.date) || (a.cleaningTime||'').localeCompare(b.cleaningTime||''));

  const header = ['#','Date','Rack','Time','Done','Method','Checked By','Remarks'];
  const rows   = recs.map((r, i) => [
    i+1, fmtDate(r.date), r.rackId,
    r.cleaningTime, r.cleaningDone ? 'Yes' : 'No',
    r.method, r.checkedBy, r.remarks
  ].map(v => `"${String(v||'').replace(/"/g,'""')}"`));

  const csv  = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: `RackCleaning_${todayStr()}.csv`
  });
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Exported ✓');
}

// ── PRINT A4 ──────────────────────────────────────────────────────────────────
let _printTab = 'day';

window.setPrintTab = function(tab) {
  _printTab = tab;
  document.getElementById('print-panel-day').style.display   = tab === 'day'   ? '' : 'none';
  document.getElementById('print-panel-range').style.display = tab === 'range' ? '' : 'none';
  document.getElementById('ptab-day').classList.toggle('active',   tab === 'day');
  document.getElementById('ptab-range').classList.toggle('active', tab === 'range');
  updatePrintInfo();
};

function updatePrintInfo() {
  const info = document.getElementById('print-info');
  if (!info) return;
  const today = todayStr();
  if (_printTab === 'day') {
    const d = document.getElementById('pm-single-date')?.value || today;
    const recs = allRecords.filter(r => r.date === d);
    info.textContent = `📋 ${recs.length} record${recs.length !== 1 ? 's' : ''} on ${fmtDate(d) || 'selected date'}`;
  } else {
    const from = document.getElementById('pm-from-date')?.value;
    const to   = document.getElementById('pm-to-date')?.value;
    if (!from || !to) { info.textContent = 'Select from and to dates'; return; }
    if (from > to)    { info.textContent = '⚠️ From must be before To date'; return; }
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    const recs = allRecords.filter(r => r.date >= from && r.date <= to);
    info.textContent = `📅 ${days} day${days !== 1 ? 's' : ''} • ${recs.length} records total`;
  }
}

function openPrintModal() {
  const today = todayStr();
  const sEl = document.getElementById('pm-single-date');
  const fEl = document.getElementById('pm-from-date');
  const tEl = document.getElementById('pm-to-date');
  if (sEl) { sEl.value = activeDate; sEl.max = today; }
  if (fEl) { fEl.value = activeDate; fEl.max = today; }
  if (tEl) { tEl.value = today;      tEl.max = today; }
  setPrintTab('day');
  document.getElementById('print-modal').classList.add('open');
  updatePrintInfo();
}

function closePrintModal() {
  document.getElementById('print-modal').classList.remove('open');
}

function executePrint() {
  const today = todayStr();
  let dates = [];
  if (_printTab === 'day') {
    const d = document.getElementById('pm-single-date')?.value;
    if (!d) { alert('Please select a date.'); return; }
    dates = [d];
  } else {
    const from = document.getElementById('pm-from-date')?.value;
    const to   = document.getElementById('pm-to-date')?.value;
    if (!from || !to)  { alert('Please select From and To dates.'); return; }
    if (from > to)     { alert('From date must be before To date.'); return; }
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > 62 && !confirm(`Printing ${days} days. Continue?`)) return;
    let cur = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
    while (cur <= end) {
      dates.push(cur.toISOString().split('T')[0]);
      cur.setDate(cur.getDate() + 1);
    }
  }
  closePrintModal();
  printRackRecords(dates);
}

function printRackRecords(dates) {
  function esc(v) { return v ? String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '—'; }
  const rackBg    = { 'Rack 1':'#DBEAFE','Rack 2':'#DCFCE7','Rack 3':'#FFEDD5' };
  const rackColor = { 'Rack 1':'#1D4ED8','Rack 2':'#15803D','Rack 3':'#C2410C' };

  const isRange = dates.length > 1;

  if (isRange) {
    // ── RANGE MODE: all records in ONE continuous table, compact rows ──
    const allRows = [];
    dates.forEach(ds => {
      const recs = allRecords.filter(r => r.date === ds)
                             .sort((a,b) => (a.cleaningTime||'').localeCompare(b.cleaningTime||''));
      const [y,m,d] = ds.split('-');
      const dateStr = `${d}/${m}/${y}`;
      recs.forEach((r,i) => {
        allRows.push(`<tr>
          <td style="text-align:center;color:#6b7280;font-weight:700">${allRows.length+1}</td>
          <td style="white-space:nowrap;font-weight:600">${esc(dateStr)}</td>
          <td><span style="background:${rackBg[r.rackId]||'#f3f4f6'};color:${rackColor[r.rackId]||'#374151'};padding:1pt 6pt;border-radius:3pt;font-size:7pt;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact">${esc(r.rackId)}</span></td>
          <td>${esc(r.cleaningTime)}</td>
          <td>${esc(r.method)}</td>
          <td style="text-align:center"><span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:1pt 5pt;border-radius:3pt;font-size:6.5pt;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact">${r.cleaningDone!==false?'\u2713 YES':'\u2717 NO'}</span></td>
          <td>${esc(r.checkedBy)}</td>
          <td style="color:#6b7280;font-size:7.5pt">${esc(r.remarks)}</td>
        </tr>`);
      });
    });

    const [sy,sm,sd] = dates[0].split('-');
    const [ey,em,ed] = dates[dates.length-1].split('-');
    const rangeStr = `${sd}/${sm}/${sy} – ${ed}/${em}/${ey}`;
    const totalRecs = allRows.length;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Rack Cleaning Record — LV Spices</title>
<style>
  @page{size:A4 landscape;margin:8mm}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{font-family:Arial,sans-serif;font-size:8pt;color:#000;background:#fff}
  table{width:100%;border-collapse:collapse;margin-top:5pt}
  thead{display:table-header-group}
  tr{page-break-inside:avoid}
  th{background:#1a1a1a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:7pt;padding:4pt 4pt;border:0.75pt solid #000;text-align:left}
  td{font-size:7.5pt;padding:2.5pt 4pt;border:0.5pt solid #ccc;vertical-align:middle}
</style></head><body>
<div style="border:2pt solid #000;padding:5pt 10pt;margin-bottom:5pt">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <h1 style="font-size:12pt;font-weight:800;text-transform:uppercase;letter-spacing:0.5px">Rack Cleaning Record — LV Spices</h1>
      <p style="font-size:7pt;color:#444;margin-top:2pt">FSSAI Compliance Log • Daily Rack Sanitation</p>
    </div>
    <div style="text-align:right;font-size:7.5pt;color:#444;line-height:1.6">
      <div><b>Date Range:</b> ${rangeStr}</div>
      <div><b>Total Records:</b> ${totalRecs}</div>
    </div>
  </div>
</div>
<table>
  <thead><tr>
    <th style="width:4%;text-align:center">SR.</th><th style="width:9%">DATE</th>
    <th style="width:8%">RACK</th>
    <th style="width:7%;text-align:center">TIME</th><th style="width:15%">METHOD</th>
    <th style="width:8%;text-align:center">DONE</th><th style="width:14%">CHECKED BY</th>
    <th>REMARKS</th>
  </tr></thead>
  <tbody>${allRows.join('')}</tbody>
</table>
<script>window.onload=function(){window.print();setTimeout(function(){window.close();},900);};<\/script>
</body></html>`;

    const pw = window.open('','_blank','width=1200,height=850');
    if (pw) { pw.document.write(html); pw.document.close(); }
    else alert('Allow popups to use Print.');
    return;
  }

  // ── SINGLE DAY MODE: one page per day (original behaviour) ──
  const pagesHtml = dates.map((ds, pi) => {
    const recs = allRecords.filter(r => r.date === ds)
                           .sort((a,b) => (a.cleaningTime||'').localeCompare(b.cleaningTime||''));
    const [y,m,d] = ds.split('-');
    const dateStr = `${d}/${m}/${y}`;
    const dayName = new Date(ds+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long'});
    const rowH = recs.length ? Math.max(12, Math.floor(155/Math.max(recs.length,3))) : 22;
    const rowsHtml = recs.length
      ? recs.map((r,i) => `<tr style="height:${rowH}mm;${i%2===1?'background:#f9fafb':''}">
          <td style="text-align:center;color:#6b7280;font-weight:700">${i+1}</td>
          <td style="white-space:nowrap;font-weight:600">${esc(dateStr)}</td>
          <td><span style="background:${rackBg[r.rackId]||'#f3f4f6'};color:${rackColor[r.rackId]||'#374151'};padding:2pt 7pt;border-radius:4pt;font-size:7pt;font-weight:800;-webkit-print-color-adjust:exact;print-color-adjust:exact">${esc(r.rackId)}</span></td>
          <td>${esc(r.cleaningTime)}</td>
          <td>${esc(r.method)}</td>
          <td style="text-align:center"><span style="background:#dcfce7;color:#15803d;border:1px solid #86efac;padding:1.5pt 5pt;border-radius:3pt;font-size:6.5pt;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact">${r.cleaningDone!==false?'\u2713 YES':'\u2717 NO'}</span></td>
          <td>${esc(r.checkedBy)}</td>
          <td style="color:#6b7280;font-size:7.5pt">${esc(r.remarks)}</td>
        </tr>`).join('')
      : `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20pt;font-style:italic">No records for this date</td></tr>`;
    return `<div style="page-break-after:${pi<dates.length-1?'always':'avoid'}">
<div style="border:2pt solid #000;padding:6pt 10pt;margin-bottom:6pt">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      <h1 style="font-size:13pt;font-weight:800;text-transform:uppercase;letter-spacing:0.5px">Rack Cleaning Record — LV Spices</h1>
      <p style="font-size:7.5pt;color:#444;margin-top:2pt">FSSAI Compliance Log • Daily Rack Sanitation</p>
    </div>
    <div style="text-align:right;font-size:7.5pt;color:#444;line-height:1.6">
      <div><b>Date:</b> ${dateStr} &nbsp; <b>Day:</b> ${dayName}</div>
    </div>
  </div>
  <div style="display:flex;gap:8pt;margin-top:5pt">
    <span style="border:1pt solid #555;padding:1pt 7pt;font-size:7pt;border-radius:3pt">📋 Records: <b>${recs.length}</b></span>
    <span style="border:1pt solid #555;padding:1pt 7pt;font-size:7pt;border-radius:3pt">🧹 Racks Cleaned: <b>${[...new Set(recs.map(r=>r.rackId))].join(', ')||'—'}</b></span>
  </div>
</div>
<table>
  <thead><tr>
    <th style="width:4%;text-align:center">SR.</th><th style="width:9%">DATE</th>
    <th style="width:8%">RACK</th>
    <th style="width:7%;text-align:center">TIME</th><th style="width:15%">METHOD</th>
    <th style="width:8%;text-align:center">DONE</th><th style="width:14%">CHECKED BY</th>
    <th>REMARKS</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
</div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>Rack Cleaning Record — LV Spices</title>
<style>
  @page{size:A4 landscape;margin:8mm}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{font-family:Arial,sans-serif;font-size:8.5pt;color:#000;background:#fff}
  table{width:100%;border-collapse:collapse;margin-top:5pt}
  thead{display:table-header-group}
  tr{page-break-inside:avoid}
  th{background:#1a1a1a;color:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-size:7pt;padding:5pt 4pt;border:0.75pt solid #000;text-align:left}
  td{font-size:8pt;padding:3pt 4pt;border:0.5pt solid #ccc;vertical-align:middle}
</style></head><body>${pagesHtml}
<script>window.onload=function(){window.print();setTimeout(function(){window.close();},900);};<\/script>
</body></html>`;

  const pw = window.open('','_blank','width=1200,height=850');
  if (pw) { pw.document.write(html); pw.document.close(); }
  else alert('Allow popups to use Print.');
}
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
  document.getElementById('m-unit')?.addEventListener('change', updateModalStaff);

  // Print button
  document.getElementById('btn-print')?.addEventListener('click', openPrintModal);
  document.getElementById('print-modal-close')?.addEventListener('click', closePrintModal);
  document.getElementById('print-modal-cancel')?.addEventListener('click', closePrintModal);
  document.getElementById('print-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closePrintModal();
  });
  document.getElementById('print-modal-execute')?.addEventListener('click', executePrint);

  // Wire print tab date pickers to update info
  ['pm-single-date','pm-from-date','pm-to-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updatePrintInfo);
  });

  // Subscribe Firestore
  let _firstLoad = true;
  subscribeRecords(records => {
    allRecords = records;
    checkAndGenerateToday();
    if (_firstLoad) {
      _firstLoad = false;
      // Auto-dedup today on first load to clean up any existing duplicates
      deduplicateDate(todayStr()).catch(console.error);
    }
    renderAll();
    showLoader(false);
  });
}

// ── START ─────────────────────────────────────────────────────────────────────
init();
