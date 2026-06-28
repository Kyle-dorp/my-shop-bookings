/* Customer booking flow */
const state = { service: null, date: null, time: null };

let calYear, calMonth, maxBookingDays = 60;
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

document.addEventListener('DOMContentLoaded', async () => {
  await fetchSettings();
  loadServices();
  document.getElementById('customerPhone').addEventListener('input', formatPhone);
});

async function fetchSettings() {
  try {
    const r = await fetch('/api/settings');
    const d = await r.json();
    maxBookingDays = d.max_booking_days || 60;
  } catch { maxBookingDays = 60; }
}

// ── Helpers ──────────────────────────────────────────────────────────
function p2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) { return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }

function fmtDate(str) {
  const [y,m,d] = str.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}
function fmtTime(str) {
  const [h,m] = str.split(':').map(Number);
  return `${h%12||12}:${p2(m)} ${h>=12?'PM':'AM'}`;
}
function fmtDuration(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins/60), m = mins%60;
  return m ? `${h}h ${m}min` : `${h} hr`;
}

// ── Phone formatting ──────────────────────────────────────────────────
function formatPhone(e) {
  let v = e.target.value.replace(/\D/g,'').slice(0,10);
  if (v.length >= 7)      v = `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
  else if (v.length >= 4) v = `(${v.slice(0,3)}) ${v.slice(3)}`;
  else if (v.length > 0)  v = `(${v}`;
  e.target.value = v;
}

// ── Calendar ──────────────────────────────────────────────────────────
function initCalendar() {
  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();
  renderCalendar();
}

function renderCalendar() {
  const title = document.getElementById('calTitle');
  const grid  = document.getElementById('calGrid');
  if (!title || !grid) return;

  const today   = new Date();
  const todayStr = localDateStr(today);
  const maxDate  = new Date();
  maxDate.setDate(maxDate.getDate() + maxBookingDays);
  const maxStr   = localDateStr(maxDate);

  title.textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;

  const prevBtn = document.getElementById('calPrev');
  if (prevBtn) prevBtn.disabled = calYear === today.getFullYear() && calMonth === today.getMonth();

  const firstDay    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const HDR = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  let html = HDR.map(d => `<div class="cal-day-header">${d}</div>`).join('');
  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const ds  = `${calYear}-${p2(calMonth+1)}-${p2(d)}`;
    const off = ds < todayStr || ds > maxStr;
    const sel = ds === state.date;
    const tod = ds === todayStr;

    if (off) {
      html += `<div class="cal-day cal-day-off">${d}</div>`;
    } else {
      const cls = ['cal-day', sel && 'cal-day-sel', tod && 'cal-day-today'].filter(Boolean).join(' ');
      html += `<button class="${cls}" data-date="${ds}">${d}</button>`;
    }
  }

  grid.innerHTML = html;
  grid.querySelectorAll('button.cal-day').forEach(btn => {
    btn.addEventListener('click', () => { state.date = btn.dataset.date; goStep(3); });
  });
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  renderCalendar();
}

// ── Services ──────────────────────────────────────────────────────────
async function loadServices() {
  const grid = document.getElementById('servicesGrid');
  try {
    const r = await fetch('/api/services');
    const services = await r.json();
    if (!services.length) {
      grid.innerHTML = '<p class="no-slots-msg">No services available yet.</p>';
      return;
    }
    grid.innerHTML = services.map(s => `
      <div class="service-card" id="svc-${s.id}">
        <div class="service-card-name">${s.name}</div>
        <div class="service-card-duration">${fmtDuration(s.duration_minutes)}</div>
        ${s.price ? `<div class="service-card-price">$${parseFloat(s.price).toFixed(2)}</div>` : ''}
      </div>`).join('');
    services.forEach(s => {
      document.getElementById(`svc-${s.id}`).addEventListener('click', () =>
        selectService(s.id, s.name, s.duration_minutes));
    });
  } catch {
    grid.innerHTML = '<p class="error-msg">Could not load services. Please refresh.</p>';
  }
}

function selectService(id, name, duration) {
  state.service = { id, name, duration };
  document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  document.getElementById(`svc-${id}`).classList.add('selected');
  setTimeout(() => goStep(2), 180);
}

// ── Time slots ────────────────────────────────────────────────────────
async function loadSlots() {
  const container = document.getElementById('slotsContainer');
  document.getElementById('selectedDateDisplay').textContent = fmtDate(state.date);
  container.innerHTML = '<div class="loading-spinner">Finding open times…</div>';
  state.time = null;

  try {
    const r = await fetch(`/api/slots?date=${state.date}&service_id=${state.service.id}`);
    const data = await r.json();

    if (!data.slots || !data.slots.length) {
      container.innerHTML = `<div class="no-slots-msg">
        <strong>${data.closed ? 'Closed this day.' : 'No openings this day.'}</strong><br>
        <span style="font-size:.85rem">Pick a different date.</span>
      </div>`;
      return;
    }
    container.innerHTML = `<div class="slots-grid">${
      data.slots.map(s => `<button class="slot-btn" data-time="${s}">${fmtTime(s)}</button>`).join('')
    }</div>`;
    container.querySelectorAll('.slot-btn').forEach(btn => {
      btn.addEventListener('click', () => selectSlot(btn.dataset.time, btn));
    });
  } catch {
    container.innerHTML = '<p class="error-msg">Could not load times. Please try again.</p>';
  }
}

function selectSlot(time, el) {
  state.time = time;
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('summaryService').textContent  = state.service.name;
  document.getElementById('summaryDate').textContent     = fmtDate(state.date);
  document.getElementById('summaryTime').textContent     = fmtTime(time);
  document.getElementById('summaryDuration').textContent = fmtDuration(state.service.duration);
  setTimeout(() => goStep(4), 180);
}

// ── Navigation ────────────────────────────────────────────────────────
function goStep(n) {
  document.querySelectorAll('.booking-step').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.remove('active','done');
    if (i+1 < n) dot.classList.add('done');
    else if (i+1 === n) dot.classList.add('active');
  });
  const el = document.getElementById(n === 'success' ? 'stepSuccess' : `step${n}`);
  if (el) el.classList.add('active');
  if (n === 2) initCalendar();
  if (n === 3) loadSlots();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Booking submission ────────────────────────────────────────────────
async function submitBooking(e) {
  e.preventDefault();
  const name  = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  const email = document.getElementById('customerEmail').value.trim();
  clearErrors();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Booking…';

  try {
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: state.service.id, customer_name: name,
        customer_phone: phone, customer_email: email||null,
        appointment_date: state.date, appointment_time: state.time }),
    });
    const data = await r.json();
    if (r.ok) { showSuccess(data.booking_id, name); }
    else {
      showFormError(data.error || 'Booking failed. Please try again.');
      btn.disabled = false; btn.textContent = 'Confirm Booking';
    }
  } catch {
    showFormError('Network error. Please check your connection.');
    btn.disabled = false; btn.textContent = 'Confirm Booking';
  }
}

function clearErrors() { document.querySelectorAll('.error-msg').forEach(e => e.remove()); }
function showFormError(msg) {
  clearErrors();
  const d = document.createElement('div');
  d.className = 'error-msg'; d.textContent = msg;
  const f = document.getElementById('contactForm');
  f.insertBefore(d, f.firstChild);
}

function showSuccess(id, name) {
  document.querySelectorAll('.booking-step').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.step-dot').forEach(d => { d.classList.remove('active'); d.classList.add('done'); });
  document.getElementById('stepSuccess').classList.add('active');
  document.getElementById('confirmationDetails').innerHTML = `
    <div class="confirmation-row"><span class="label">Confirmation #</span><span class="value">#${String(id).padStart(5,'0')}</span></div>
    <div class="confirmation-row"><span class="label">Service</span><span class="value">${state.service.name}</span></div>
    <div class="confirmation-row"><span class="label">Date</span><span class="value">${fmtDate(state.date)}</span></div>
    <div class="confirmation-row"><span class="label">Time</span><span class="value">${fmtTime(state.time)}</span></div>
    <div class="confirmation-row"><span class="label">Name</span><span class="value">${name}</span></div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetBooking() {
  state.service = state.date = state.time = null;
  ['customerName','customerPhone','customerEmail'].forEach(id => document.getElementById(id).value = '');
  goStep(1); loadServices();
}
