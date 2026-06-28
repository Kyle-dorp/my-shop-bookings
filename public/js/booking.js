/* Customer booking flow */
const state = {
  service: null,
  date: null,
  time: null,
};

document.addEventListener('DOMContentLoaded', () => {
  loadServices();

  const datePicker = document.getElementById('datePicker');
  const today = localDateStr(new Date());
  datePicker.min = today;

  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 60);
  datePicker.max = localDateStr(maxDate);

  datePicker.addEventListener('change', () => {
    state.date = datePicker.value || null;
    document.getElementById('dateNextBtn').disabled = !state.date;
  });
});

function localDateStr(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
function p2(n) { return String(n).padStart(2, '0'); }

function fmtDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtTime(str) {
  const [h, m] = str.split(':').map(Number);
  return `${h % 12 || 12}:${p2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

function fmtDuration(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}min` : `${h} hr`;
}

async function loadServices() {
  const grid = document.getElementById('servicesGrid');
  try {
    const r = await fetch('/api/services');
    const services = await r.json();

    if (!services.length) {
      grid.innerHTML = '<p class="no-slots-msg">No services listed yet — check back soon.</p>';
      return;
    }
    grid.innerHTML = services.map(s => `
      <div class="service-card" id="svc-${s.id}">
        <div class="service-card-name">${s.name}</div>
        <div class="service-card-duration">${fmtDuration(s.duration_minutes)}</div>
        ${s.price ? `<div class="service-card-price">$${parseFloat(s.price).toFixed(2)}</div>` : ''}
      </div>
    `).join('');

    services.forEach(s => {
      document.getElementById(`svc-${s.id}`).addEventListener('click', () => {
        selectService(s.id, s.name, s.duration_minutes);
      });
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
        <strong>${data.closed ? 'Closed this day.' : 'No openings this day.'}</strong>
        <br><span style="font-size:.85rem">Please choose another date.</span>
      </div>`;
      return;
    }

    container.innerHTML = `<div class="slots-grid">${
      data.slots.map(s => `<button class="slot-btn" onclick="selectSlot('${s}',this)">${fmtTime(s)}</button>`).join('')
    }</div>`;
  } catch {
    container.innerHTML = '<p class="error-msg">Could not load times. Please try again.</p>';
  }
}

function selectSlot(time, el) {
  state.time = time;
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');

  // fill summary
  document.getElementById('summaryService').textContent  = state.service.name;
  document.getElementById('summaryDate').textContent     = fmtDate(state.date);
  document.getElementById('summaryTime').textContent     = fmtTime(time);
  document.getElementById('summaryDuration').textContent = fmtDuration(state.service.duration);

  setTimeout(() => goStep(4), 180);
}

function goStep(n) {
  document.querySelectorAll('.booking-step').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i + 1 < n) dot.classList.add('done');
    else if (i + 1 === n) dot.classList.add('active');
  });

  const el = document.getElementById(n === 'success' ? 'stepSuccess' : `step${n}`);
  if (el) el.classList.add('active');
  if (n === 3) loadSlots();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submitBooking(e) {
  e.preventDefault();
  const name  = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  const email = document.getElementById('customerEmail').value.trim();

  clearErrors();
  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Booking…';

  try {
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: state.service.id,
        customer_name: name,
        customer_phone: phone,
        customer_email: email || null,
        appointment_date: state.date,
        appointment_time: state.time,
      }),
    });
    const data = await r.json();
    if (r.ok) {
      showSuccess(data.booking_id, name);
    } else {
      showFormError(data.error || 'Booking failed. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm Booking';
    }
  } catch {
    showFormError('Network error. Please check your connection.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm Booking';
  }
}

function clearErrors() {
  document.querySelectorAll('.error-msg').forEach(e => e.remove());
}

function showFormError(msg) {
  clearErrors();
  const div = document.createElement('div');
  div.className = 'error-msg';
  div.textContent = msg;
  const form = document.getElementById('contactForm');
  form.insertBefore(div, form.firstChild);
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
    <div class="confirmation-row"><span class="label">Name</span><span class="value">${name}</span></div>
  `;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetBooking() {
  state.service = state.date = state.time = null;
  document.getElementById('datePicker').value = '';
  document.getElementById('customerName').value = '';
  document.getElementById('customerPhone').value = '';
  document.getElementById('customerEmail').value = '';
  document.getElementById('dateNextBtn').disabled = true;
  goStep(1);
  loadServices();
}
