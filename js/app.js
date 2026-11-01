import { saveRecord, updateRecord, deleteRecord, batchSaveRecords, subscribeRecords } from './firebase-config.js';
import { generateDayEntries, generateDateRange, todayStr, UNITS, UNIT_AREAS, STAFF } from './auto-generate.js';

// ── STATE ──────────────────────────────────────────────────────────────────────
let allRecords  = [];
let activeUnit  = 'Unit 11';
let activeMonth = '';
let searchQuery = '';
let editingId   = null;
let isOnline    = navigator.onLine;

// All months with data (sorted desc) for nav
let monthList   = [];

// ── HELPERS ───────────────────────────────────────────────────────────────────
const pad    = n => String(n).padStart(2, '0');
const mkKey  = d => d ? d.slice(0, 7) : '';
const fmtDate = d => { if (!d) return ''; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

function monthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-');
  return new Date(+y, +m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}
function yesterday() {
  const d = new Date(); d.setDate(d.getDate()-1);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function methodClass(method) {
  if (!method) return '';
  const m = method.toLowerCase();
  if (m.includes('vacuum'))   return 'mb-vacuum';
  if (m.includes('sanitize')) return 'mb-sanitize';
  if (m.includes('wet'))      return 'mb-wet';
  if (m.includes('sweep'))    return 'mb-sweep';
  if (m.includes('dry'))      return 'mb-dry';
  if (m.includes('dust'))     return 'mb-dust';
  return 'mb-dry';
}

function methodIcon(method) {
  if (!method) return '';
  const m = method.toLowerCase();
  if (m.includes('vacuum'))   return '🌀';
  if (m.includes('sanitize')) return '🧴';
  if (m.includes('wet'))      return '💧';
  if (m.includes('sweep'))    return '🧹';
  if (m.includes('dry'))      return '🌿';
  if (m.includes('dust'))     return '🌬️';
  return '🧹';
}

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
  b.textContent = isOnline ? '☁️ Cloud Synced' : '🔴 Offline';
  b.className = `cloud-badge ${isOnline ? 'online' : 'offline'}`;
}
window.addEventListener('online',  () => { isOnline = true;  updateCloudBadge(); });
window.addEventListener('offline', () => { isOnline = false; updateCloudBadge(); });

// ── INIT ───────────────────────────────────────────────────────────────────────
function init() {
  updateCloudBadge();
  showLoader(true);

  // Set current month default
  const today = todayStr();
  activeMonth = mkKey(today);

  // Subscribe realtime
  subscribeRecords(records => {
    allRecords = records;
    checkAndGenerateToday();
    buildMonthList();
    renderAll();
    showLoader(false);
  });

  // Unit buttons (sidebar)
  document.querySelectorAll('.unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeUnit = btn.dataset.unit;
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === activeUnit));
      buildMonthList();
      renderAll();
    });
  });

  // Month nav
  document.getElementById('btn-prev-month').addEventListener('click', () => navMonth(-1));
  document.getElementById('btn-next-month').addEventListener('click', () => navMonth(+1));

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderTable();
  });

  // New Record
  document.getElementById('btn-new').addEventListener('click', () => openModal(null));

  // Export
  document.getElementById('btn-export').addEventListener('click', exportCSV);

  // Backfill
  document.getElementById('btn-backfill').addEventListener('click', runBackfill);

  // Modal
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveModal);
  document.getElementById('m-unit').addEventListener('change', updateModalAreas);
}

// ── MONTH LIST ────────────────────────────────────────────────────────────────
function buildMonthList() {
  const unitRecs = allRecords.filter(r => r.unit === activeUnit);
  const months = new Set(unitRecs.map(r => mkKey(r.date)));
  monthList = [...months].filter(Boolean).sort();

  // Ensure current month exists in list
  const today = todayStr();
  const cur = mkKey(today);
  if (!months.has(cur)) monthList.push(cur);
  monthList.sort();

  // Validate activeMonth
  if (!monthList.includes(activeMonth)) {
    activeMonth = monthList[monthList.length - 1] || cur;
  }
}

function navMonth(dir) {
  const idx = monthList.indexOf(activeMonth);
  const next = idx + dir;
  if (next >= 0 && next < monthList.length) {
    activeMonth = monthList[next];
    renderAll();
  }
}

// ── CHECK TODAY ───────────────────────────────────────────────────────────────
function checkAndGenerateToday() {
  const today = todayStr();
  UNITS.forEach(unit => {
    if (!allRecords.some(r => r.date === today && r.unit === unit)) {
      const entries = generateDayEntries(today).filter(e => e.unit === unit);
      batchSaveRecords(entries).catch(console.error);
    }
  });
}

// ── RENDER ALL ────────────────────────────────────────────────────────────────
function renderAll() {
  renderStatCards();
  renderFilterBar();
  renderTable();
  renderNavBadge();
}

function renderNavBadge() {
  const unitRecs = allRecords.filter(r => r.unit === activeUnit);
  document.getElementById('nav-badge').textContent = unitRecs.length;
}

// ── STAT CARDS ────────────────────────────────────────────────────────────────
function renderStatCards() {
  const unitRecs = allRecords.filter(r => r.unit === activeUnit && mkKey(r.date) === activeMonth);
  const racks = new Set(unitRecs.map(r => r.rackId)).size;
  document.getElementById('stat-total').textContent   = unitRecs.length;
  document.getElementById('stat-racks').textContent   = racks;
  document.getElementById('stat-pending').textContent = 0; // all auto-done
  document.getElementById('stat-month').textContent   = monthLabel(activeMonth).split(' ')[0];
}

// ── FILTER BAR ────────────────────────────────────────────────────────────────
function renderFilterBar() {
  document.getElementById('filter-month-title').textContent = monthLabel(activeMonth);

  const unitRecs = allRecords.filter(r => r.unit === activeUnit && mkKey(r.date) === activeMonth);
  const daysCount = new Set(unitRecs.map(r => r.date)).size;
  const r1 = unitRecs.filter(r => r.rackId === 'Rack 1').length;
  const r2 = unitRecs.filter(r => r.rackId === 'Rack 2').length;
  const r3 = unitRecs.filter(r => r.rackId === 'Rack 3').length;

  document.getElementById('filter-chips').innerHTML = `
    <div class="filter-chip">🗓️ ${daysCount} days</div>
    <div class="filter-chip">📋 ${unitRecs.length} entries</div>
    <div class="filter-chip"><span class="chip-rack chip-r1">Rack 1:</span>&nbsp;<b>${r1}</b></div>
    <div class="filter-chip"><span class="chip-rack chip-r2">Rack 2:</span>&nbsp;<b>${r2}</b></div>
    <div class="filter-chip"><span class="chip-rack chip-r3">Rack 3:</span>&nbsp;<b>${r3}</b></div>
  `;
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
function renderTable() {
  let recs = allRecords.filter(r =>
    r.unit === activeUnit && mkKey(r.date) === activeMonth
  );

  if (searchQuery) {
    recs = recs.filter(r =>
      (r.date || '').includes(searchQuery) ||
      (r.rackId || '').toLowerCase().includes(searchQuery) ||
      (r.area || '').toLowerCase().includes(searchQuery) ||
      (r.checkedBy || '').toLowerCase().includes(searchQuery) ||
      (r.method || '').toLowerCase().includes(searchQuery) ||
      (r.remarks || '').toLowerCase().includes(searchQuery)
    );
  }

  recs.sort((a, b) => {
    const d = b.date.localeCompare(a.date);
    return d !== 0 ? d : (a.cleaningTime || '').localeCompare(b.cleaningTime || '');
  });

  const tbody = document.getElementById('records-tbody');
  if (!recs.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No records for ${monthLabel(activeMonth)}.<br><small style="margin-top:6px;display:block;">Use the backfill button to generate historical data.</small></td></tr>`;
    return;
  }

  tbody.innerHTML = recs.map((r, i) => {
    const rackClass = 'rack-' + (r.rackId || '').replace(' ', '').toLowerCase();
    const mClass = methodClass(r.method);
    const mIcon  = methodIcon(r.method);
    return `<tr>
      <td>${i + 1}</td>
      <td>${fmtDate(r.date)}</td>
      <td><span class="rack-badge ${rackClass}">${r.rackId || '—'}</span></td>
      <td>${r.area || '—'}</td>
      <td><span class="td-time"><span class="time-icon">🕐</span>${r.cleaningTime || '—'}</span></td>
      <td><span class="method-badge ${mClass}">${mIcon} ${r.method || '—'}</span></td>
      <td>${r.checkedBy || '—'}</td>
      <td style="color:#6b7280;font-size:11px;max-width:200px;">${r.remarks || '—'}</td>
      <td>
        <button class="btn-edit-row" title="Edit" onclick="openEditRecord('${r.id}')">✏️</button>
        <button class="btn-del-row"  title="Delete" onclick="confirmDelete('${r.id}')">🗑️</button>
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
  form['m-date'].value      = rec?.date        || todayStr();
  form['m-unit'].value      = rec?.unit        || activeUnit;
  form['m-rackId'].value    = rec?.rackId      || 'Rack 1';
  form['m-time'].value      = rec?.cleaningTime|| '';
  form['m-done'].checked    = rec?.cleaningDone !== false;
  form['m-method'].value    = rec?.method      || 'Dry Wipe';
  form['m-checkedBy'].value = rec?.checkedBy   || '';
  form['m-remarks'].value   = rec?.remarks     || '';

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
  // Staff datalist
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
    date:         form['m-date'].value,
    unit:         form['m-unit'].value,
    rackId:       form['m-rackId'].value,
    area:         form['m-area'].value,
    cleaningTime: form['m-time'].value,
    cleaningDone: form['m-done'].checked,
    method:       form['m-method'].value,
    checkedBy:    form['m-checkedBy'].value.trim(),
    remarks:      form['m-remarks'].value.trim(),
    autoGenerated: false,
  };
  if (!data.date || !data.rackId || !data.unit) {
    showToast('Fill required fields.', 'error'); return;
  }
  const btn = document.getElementById('modal-save');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (editingId) { await updateRecord(editingId, data); showToast('Updated ✓'); }
    else           { await saveRecord(data); showToast('Saved ✓'); }
    closeModal();
    activeUnit  = data.unit;
    activeMonth = mkKey(data.date);
    document.querySelectorAll('.unit-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.unit === activeUnit));
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
  if (!confirm(`Delete record for ${fmtDate(rec?.date)} ${rec?.rackId || ''}?`)) return;
  deleteRecord(id)
    .then(() => showToast('Deleted.'))
    .catch(() => showToast('Delete failed.', 'error'));
};

// ── EXPORT CSV ────────────────────────────────────────────────────────────────
function exportCSV() {
  const recs = allRecords
    .filter(r => r.unit === activeUnit && mkKey(r.date) === activeMonth)
    .sort((a,b) => a.date.localeCompare(b.date) || (a.cleaningTime||'').localeCompare(b.cleaningTime||''));

  const header = ['#','Date','Unit','Rack','Area','Time','Done','Method','Checked By','Remarks'];
  const rows   = recs.map((r,i) => [i+1, fmtDate(r.date), r.unit, r.rackId, r.area,
    r.cleaningTime, r.cleaningDone?'Yes':'No', r.method, r.checkedBy, r.remarks]
    .map(v => `"${String(v||'').replace(/"/g,'""')}"`));

  const csv  = [header, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `RackCleaning_${activeUnit.replace(' ','')}_${activeMonth}.csv`
  });
  a.click(); URL.revokeObjectURL(a.href);
  showToast('Exported ✓');
}

// ── SETTINGS TOGGLE ───────────────────────────────────────────────────────────
window.toggleSettings = function() {
  const p = document.getElementById('settings-panel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
};

// ── BACKFILL ──────────────────────────────────────────────────────────────────
async function runBackfill() {
  if (!confirm('Generate all records from 1 April 2026 to yesterday?\nExisting records will NOT be overwritten.')) return;

  const btn  = document.getElementById('btn-backfill');
  const prog = document.getElementById('backfill-progress');
  btn.disabled = true; btn.textContent = '⏳ Working…';
  prog.style.display = 'block';
  prog.textContent   = 'Building entry list…';

  try {
    const yest = yesterday();
    const allEntries = generateDateRange('2026-04-01', yest);

    const existingKeys = new Set(allRecords.map(r => r.date + '_' + r.unit));
    const toSave = allEntries.filter(e => !existingKeys.has(e.date + '_' + e.unit));

    if (!toSave.length) {
      prog.textContent = '✅ All historical data already exists!';
      showToast('Already up to date ✓'); return;
    }

    const CHUNK = 400;
    let saved = 0;
    for (let i = 0; i < toSave.length; i += CHUNK) {
      await batchSaveRecords(toSave.slice(i, i + CHUNK));
      saved += Math.min(CHUNK, toSave.length - i);
      prog.textContent = `⏳ Saved ${saved} / ${toSave.length} records…`;
    }

    prog.textContent = `✅ Done! ${saved} records added (Apr 2026 – ${yest}).`;
    showToast(`Backfill complete: ${saved} records ✓`);
  } catch (err) {
    console.error(err);
    prog.textContent = '❌ Error during backfill. See console.';
    showToast('Backfill failed.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '📥 Backfill Apr–Today';
    setTimeout(() => { prog.style.display = 'none'; }, 8000);
  }
}

// ── START ─────────────────────────────────────────────────────────────────────
init();
