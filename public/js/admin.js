/* Admin panel */
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { authenticated } = await api('GET', '/api/admin/check-auth');
  if (authenticated) showDashboard();
  else showLogin();
});

// ── Auth ──────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('adminShell').style.display = 'none';
}
function showDashboard() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('adminShell').style.display = 'flex';
  switchTab('today');
}

async function doLogin(e) {
  e.preventDefault();
  const pw = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';
  errEl.textContent = '';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (r.ok) { showDashboard(); }
    else {
      const d = await r.json();
      errEl.textContent = d.error || 'Login failed';
      errEl.style.display = 'block';
    }
  } catch {
    errEl.textContent = 'Network error';
    errEl.style.display = 'block';
  }
}

async function doLogout() {
  await api('POST', '/api/admin/logout');
  showLogin();
}

// ── Tabs ──────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.toggle('active', s.id === `sec-${name}`));

  if (name === 'today') loadToday();
  else if (name === 'appointments') loadAppointments();
  else if (name === 'services') loadServices();
  else if (name === 'hours') loadHours();
  else if (name === 'settings') loadSettings();
  else if (name === 'account') loadAccount();
}

// ── Today ──────────────────────────────────────────────────────────────
async function loadToday() {
  const today = localDateStr(new Date());
  const appts = await api('GET', `/api/admin/appointments?date=${today}`);

  const confirmed = appts.filter(a => a.status === 'confirmed');
  const completed = appts.filter(a => a.status === 'completed');
  const cancelled = appts.filter(a => a.status === 'cancelled');

  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  document.getElementById('statConfirmed').textContent = confirmed.length;
  document.getElementById('statCompleted').textContent = completed.length;
  document.getElementById('statCancelled').textContent = cancelled.length;

  const tbody = document.getElementById('todayBody');
  if (!appts.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No appointments today.</td></tr>';
    return;
  }
  tbody.innerHTML = appts.map(a => apptRow(a, true)).join('');
}

// ── Appointments ───────────────────────────────────────────────────────
async function loadAppointments(date) {
  const qs = date ? `?date=${date}` : '';
  const appts = await api('GET', `/api/admin/appointments${qs}`);
  const tbody = document.getElementById('apptBody');
  if (!appts.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No appointments found.</td></tr>';
    return;
  }
  tbody.innerHTML = appts.map(a => apptRow(a, false)).join('');
}

function apptRow(a, isToday) {
  const date = isToday ? '' : `<td>${fmtDate(a.appointment_date)}</td>`;
  const actions = a.status === 'confirmed'
    ? `<button class="btn btn-sm btn-primary" onclick="markComplete(${a.id})">Done</button>
       <button class="btn btn-sm btn-danger" style="margin-left:.4rem" onclick="cancelAppt(${a.id})">Cancel</button>`
    : '';
  return `<tr id="appt-${a.id}">
    ${date}
    <td><strong>${esc(a.customer_name)}</strong><br><span style="color:#888;font-size:.8rem">${esc(a.customer_phone||'')}</span></td>
    <td>${esc(a.service_name||'')}</td>
    <td>${fmtTime(a.appointment_time)}</td>
    <td><span class="badge badge-${a.status}">${a.status}</span></td>
    <td>${actions}</td>
  </tr>`;
}

async function cancelAppt(id) {
  if (!confirm('Cancel this appointment?')) return;
  await api('PUT', `/api/admin/appointments/${id}/cancel`);
  refreshCurrentSection();
}

async function markComplete(id) {
  await api('PUT', `/api/admin/appointments/${id}/complete`);
  refreshCurrentSection();
}

function filterAppointments() {
  const date = document.getElementById('apptDateFilter').value;
  loadAppointments(date || undefined);
}

// ── Services ──────────────────────────────────────────────────────────
async function loadServices() {
  const services = await api('GET', '/api/admin/services');
  const tbody = document.getElementById('servicesBody');

  if (!services.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No services yet. Add one above.</td></tr>';
    return;
  }

  tbody.innerHTML = services.map(s => serviceRow(s)).join('');
}

function serviceRow(s) {
  return `<tr id="srow-${s.id}">
    <td>${esc(s.name)}</td>
    <td>${s.duration_minutes} min</td>
    <td>${s.price ? '$'+parseFloat(s.price).toFixed(2) : '—'}</td>
    <td><span class="badge ${s.active ? 'badge-confirmed' : 'badge-cancelled'}">${s.active ? 'Active' : 'Hidden'}</span></td>
    <td>
      <button class="btn btn-sm btn-secondary" onclick="editService(${s.id})">Edit</button>
      <button class="btn btn-sm btn-danger" style="margin-left:.4rem" onclick="deleteService(${s.id})">Remove</button>
    </td>
  </tr>`;
}

function editService(id) {
  const row = document.getElementById(`srow-${id}`);
  const cells = row.querySelectorAll('td');
  const name     = cells[0].textContent;
  const dur      = parseInt(cells[1].textContent);
  const price    = cells[2].textContent.replace('$','').replace('—','');
  const isActive = cells[3].querySelector('.badge').textContent === 'Active';

  row.classList.add('service-edit-row');
  row.innerHTML = `
    <td><input class="edit-input" id="ename-${id}" value="${esc(name)}" style="min-width:120px"></td>
    <td>${durationSelect('edur-'+id, dur)}</td>
    <td><input class="edit-input" id="eprice-${id}" value="${price}" placeholder="0.00" style="width:80px" type="number" min="0" step="0.01"></td>
    <td>
      <label class="closed-toggle">
        <input type="checkbox" id="eactive-${id}" ${isActive ? 'checked' : ''}> Active
      </label>
    </td>
    <td>
      <button class="btn btn-sm btn-primary" onclick="saveService(${id})">Save</button>
      <button class="btn btn-sm btn-secondary" style="margin-left:.4rem" onclick="loadServices()">Cancel</button>
    </td>
  `;
}

async function saveService(id) {
  const name     = document.getElementById(`ename-${id}`).value.trim();
  const dur      = document.getElementById(`edur-${id}`).value;
  const price    = document.getElementById(`eprice-${id}`).value;
  const active   = document.getElementById(`eactive-${id}`).checked;

  if (!name) return alert('Name is required');

  await api('PUT', `/api/admin/services/${id}`, { name, duration_minutes: dur, price: price || null, active, display_order: 0 });
  loadServices();
}

async function addService(e) {
  e.preventDefault();
  const name  = document.getElementById('newName').value.trim();
  const dur   = document.getElementById('newDur').value;
  const price = document.getElementById('newPrice').value;

  if (!name) return;

  const err = document.getElementById('addSvcErr');
  err.textContent = '';
  err.style.display = 'none';
  try {
    const r = await fetch('/api/admin/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, duration_minutes: dur, price: price || null }),
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error; err.style.display = 'block'; return; }
    document.getElementById('newName').value = '';
    document.getElementById('newPrice').value = '';
    loadServices();
  } catch { err.textContent = 'Error adding service'; }
}

async function deleteService(id) {
  if (!confirm('Remove this service? It will be hidden from customers.')) return;
  await api('DELETE', `/api/admin/services/${id}`);
  loadServices();
}

function durationSelect(id, selected) {
  const opts = [];
  for (let m = 15; m <= 120; m += 15) {
    const label = m < 60 ? `${m} min` : (m % 60 === 0 ? `${m/60} hr` : `${Math.floor(m/60)}h ${m%60}min`);
    opts.push(`<option value="${m}" ${m === selected ? 'selected' : ''}>${label}</option>`);
  }
  return `<select class="edit-input" id="${id}">${opts.join('')}</select>`;
}

// ── Hours ─────────────────────────────────────────────────────────────
async function loadHours() {
  const hours = await api('GET', '/api/admin/hours');
  const tbody = document.getElementById('hoursBody');

  tbody.innerHTML = hours.map(h => `
    <tr>
      <td>${DAYS[h.day_of_week]}</td>
      <td><input class="hours-input" type="time" id="open-${h.day_of_week}" value="${h.open_time.slice(0,5)}" ${h.is_closed?'disabled':''}></td>
      <td><input class="hours-input" type="time" id="close-${h.day_of_week}" value="${h.close_time.slice(0,5)}" ${h.is_closed?'disabled':''}></td>
      <td>
        <label class="closed-toggle">
          <input type="checkbox" id="closed-${h.day_of_week}" ${h.is_closed?'checked':''}
                 onchange="toggleClosed(${h.day_of_week})"> Closed
        </label>
      </td>
    </tr>
  `).join('');
}

function toggleClosed(day) {
  const closed = document.getElementById(`closed-${day}`).checked;
  document.getElementById(`open-${day}`).disabled = closed;
  document.getElementById(`close-${day}`).disabled = closed;
}

async function saveHours() {
  const hours = [];
  for (let d = 0; d < 7; d++) {
    hours.push({
      day_of_week: d,
      open_time:   document.getElementById(`open-${d}`).value || '09:00',
      close_time:  document.getElementById(`close-${d}`).value || '18:00',
      is_closed:   document.getElementById(`closed-${d}`).checked,
    });
  }

  const r = await fetch('/api/admin/hours', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });

  if (r.ok) showToast('Hours saved!');
  else showToast('Save failed', 'error');
}

// ── Settings ──────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await api('GET', '/api/admin/settings');
  if (data.max_booking_days) document.getElementById('maxBookingDays').value = data.max_booking_days;
  const mode = data.payment_mode || (data.deposit_required === 'true' ? 'deposit' : 'in_person');
  document.getElementById({ in_person: 'modeInPersonRadio', deposit: 'modeDepositRadio', full: 'modeFullRadio' }[mode] || 'modeInPersonRadio').checked = true;
  if (data.deposit_amount) document.getElementById('depositAmount').value = data.deposit_amount;
  togglePaymentMode();

  const reqLogin = data.require_login === 'true';
  document.getElementById('requireLogin').checked = reqLogin;
  document.getElementById('allowGuest').checked = data.allow_guest !== 'false';
  toggleLoginSettings();
}

function togglePaymentMode() {
  const isDeposit = document.getElementById('modeDepositRadio').checked;
  document.getElementById('depositAmtGroup').style.display = isDeposit ? 'block' : 'none';
}

function selectedPaymentMode() {
  if (document.getElementById('modeDepositRadio').checked) return 'deposit';
  if (document.getElementById('modeFullRadio').checked) return 'full';
  return 'in_person';
}

function toggleLoginSettings() {
  const checked = document.getElementById('requireLogin').checked;
  document.getElementById('loginSettingsGroup').style.display = checked ? 'block' : 'none';
}

async function saveSettings() {
  const errEl = document.getElementById('settingsErr');
  errEl.style.display = 'none';
  const body = {
    max_booking_days: document.getElementById('maxBookingDays').value,
    payment_mode:     selectedPaymentMode(),
    deposit_amount:   document.getElementById('depositAmount').value || '0',
    require_login:    document.getElementById('requireLogin').checked,
    allow_guest:      document.getElementById('allowGuest').checked,
  };
  const r = await fetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (r.ok) showToast('Settings saved!');
  else { errEl.textContent = d.error; errEl.style.display = 'block'; }
}

// ── Account / Profile ─────────────────────────────────────────────────
function updateProfileHero(name) {
  const avatar = document.getElementById('profileHeroAvatar');
  const nameEl = document.getElementById('profileHeroName');
  if (avatar) avatar.textContent = (name || 'A')[0].toUpperCase();
  if (nameEl) nameEl.textContent = name || 'Admin';
}

async function loadAccount() {
  try {
    const data = await api('GET', '/api/admin/profile');
    if (data.name)  document.getElementById('profileName').value  = data.name;
    if (data.email) document.getElementById('profileEmail').value = data.email;
    if (data.phone) document.getElementById('profilePhone').value = data.phone;
    updateProfileHero(data.name);
  } catch {}
}

async function saveProfile() {
  const name  = document.getElementById('profileName').value.trim();
  const email = document.getElementById('profileEmail').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();
  const errEl = document.getElementById('profileErr');
  errEl.style.display = 'none';

  const r = await fetch('/api/admin/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, phone }),
  });
  if (r.ok) { showToast('Profile saved!'); updateProfileHero(name); }
  else { errEl.textContent = 'Save failed'; errEl.style.display = 'block'; }
}

// ── Password ──────────────────────────────────────────────────────────
async function changePassword(e) {
  e.preventDefault();
  const cur   = document.getElementById('curPw').value;
  const next  = document.getElementById('newPw').value;
  const errEl = document.getElementById('pwErr');
  errEl.textContent = '';
  errEl.style.display = 'none';

  const r = await fetch('/api/admin/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: cur, new_password: next }),
  });
  const d = await r.json();
  if (r.ok) {
    showToast('Password changed!');
    e.target.reset();
  } else {
    errEl.textContent = d.error || 'Failed';
    errEl.style.display = 'block';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  return r.json();
}

function p2(n) { return String(n).padStart(2,'0'); }
function localDateStr(d) { return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
function fmtDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}
function fmtTime(str) {
  const [h,m] = str.split(':').map(Number);
  return `${h%12||12}:${p2(m)} ${h>=12?'PM':'AM'}`;
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function refreshCurrentSection() {
  const active = document.querySelector('.admin-tab.active');
  if (active) switchTab(active.dataset.tab);
}

let toastTimer;
function showToast(msg, type='success') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);
    background:${type==='error'?'#e74c3c':'#27ae60'};color:#fff;
    padding:.65rem 1.4rem;border-radius:8px;font-size:.875rem;font-weight:600;
    z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,.2);transition:opacity .3s;`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 2600);
}
