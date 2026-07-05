/* Customer booking flow */
const shopSlug = (() => {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return (parts.length && parts[0] !== 'admin') ? parts[0] : '';
})();

const state = { service: null, date: null, time: null, customerInfo: null };
let currentUser = null;
let currentStep = null;

let calYear, calMonth;
let maxBookingDays = 60;
let paymentMode = 'in_person';
let depositRequired = false;
let depositAmount = 0;
let stripeKey = null;
let requireLogin = false;
let allowGuest = true;
let googleConfigured = false;
let stripe, stripeElements;

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);

  // Handle Google OAuth error return
  if (params.get('auth_error')) {
    history.replaceState({}, '', '/');
    const errEl = document.getElementById('siErr');
    if (errEl) { errEl.textContent = 'Google sign-in failed. Please try a different method.'; errEl.style.display = 'block'; }
  }

  // Handle return from Stripe 3DS redirect
  if (params.get('payment_return') === '1') {
    const pending = sessionStorage.getItem('pendingBooking');
    if (pending) {
      const saved = JSON.parse(pending);
      Object.assign(state, saved);
      sessionStorage.removeItem('pendingBooking');
      await fetchSettings();
      await createBooking(params.get('payment_intent'));
      return;
    }
  }

  await fetchSettings();
  loadServices();
  document.getElementById('customerPhone').addEventListener('input', formatPhone);
  document.getElementById('regPhone').addEventListener('input', formatPhone);

  // Close account dropdown when clicking outside
  document.addEventListener('click', () => {
    const drop   = document.getElementById('accountDropdown');
    const corner = document.getElementById('accountCorner');
    if (drop)   drop.style.display = 'none';
    if (corner) corner.classList.remove('open');
  });

  // Check if already signed in — skip auth screen if so
  await checkAuth();
});

// ── Auth ─────────────────────────────────────────────────────────────
async function checkAuth() {
  try {
    const data = await fetch('/api/auth/me').then(r => r.json());
    currentUser = data.user;
  } catch {
    currentUser = null;
  }
  if (currentUser || !requireLogin) {
    goStep(1);
  } else {
    goStep(0);
  }
}

function updateAccountCorner(user) {
  const corner    = document.getElementById('accountCorner');
  const trigger   = document.getElementById('accountTrigger');
  const avatar    = document.getElementById('accountAvatar');
  const nameEl    = document.getElementById('accountTriggerName');
  const chevron   = document.getElementById('accountChevron');
  const hdrEl     = document.getElementById('accountDropdownHeader');
  const actionsEl = document.getElementById('accountDropdownActions');
  if (!corner) return;

  if (currentStep === 0 || currentStep === null) {
    corner.style.display = 'none';
    return;
  }

  corner.style.display = '';

  if (user) {
    trigger.classList.remove('signin-mode');
    avatar.textContent = (user.name || '?')[0].toUpperCase();
    nameEl.textContent = user.name.split(' ')[0];
    if (chevron) chevron.style.display = '';

    if (hdrEl) hdrEl.innerHTML = `
      <div class="drop-name">${esc(user.name)}</div>
      ${user.email ? `<div class="drop-email">${esc(user.email)}</div>` : ''}
    `;
    if (actionsEl) actionsEl.innerHTML = `
      <button class="signout-btn" onclick="signOut()">Sign out</button>
    `;
  } else {
    trigger.classList.add('signin-mode');
    avatar.innerHTML = `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="7" r="3"/><path d="M3 18c0-4 3-7 7-7s7 3 7 7"/></svg>`;
    nameEl.textContent = 'Sign In';
    if (chevron) chevron.style.display = 'none';
    if (hdrEl) hdrEl.innerHTML = '';
    if (actionsEl) actionsEl.innerHTML = '';
    const drop = document.getElementById('accountDropdown');
    if (drop) drop.style.display = 'none';
    corner.classList.remove('open');
  }
}

function accountCornerClick(e) {
  if (e) e.stopPropagation();
  if (!currentUser) {
    goStep(0);
  } else {
    const drop   = document.getElementById('accountDropdown');
    const corner = document.getElementById('accountCorner');
    if (!drop) return;
    const isOpen = drop.style.display !== 'none';
    drop.style.display = isOpen ? 'none' : '';
    if (corner) corner.classList.toggle('open', !isOpen);
  }
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  state.service = state.date = state.time = state.customerInfo = null;
  goStep(0);
}

function authTab(tab) {
  const isSignIn = tab === 'signin';
  document.getElementById('tabSignIn').classList.toggle('active', isSignIn);
  document.getElementById('tabRegister').classList.toggle('active', !isSignIn);
  document.getElementById('authSignInPane').style.display = isSignIn ? '' : 'none';
  document.getElementById('authRegisterPane').style.display = isSignIn ? 'none' : '';
}

function continueAsGuest() {
  goStep(1);
}

async function doSignIn() {
  const email    = document.getElementById('siEmail').value.trim();
  const password = document.getElementById('siPw').value;
  const errEl    = document.getElementById('siErr');
  errEl.style.display = 'none';

  if (!email || !password) { errEl.textContent = 'Email and password are required'; errEl.style.display = 'block'; return; }

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    currentUser = d.user;
    goStep(1);
  } catch {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
  }
}

async function doRegister() {
  const name     = document.getElementById('regName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const phone    = document.getElementById('regPhone').value.trim();
  const password = document.getElementById('regPw').value;
  const errEl    = document.getElementById('regErr');
  errEl.style.display = 'none';

  if (!name || !email || !password) { errEl.textContent = 'Name, email and password are required'; errEl.style.display = 'block'; return; }

  try {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, password }),
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error; errEl.style.display = 'block'; return; }
    currentUser = d.user;
    goStep(1);
  } catch {
    errEl.textContent = 'Network error. Please try again.';
    errEl.style.display = 'block';
  }
}

// ── Settings ──────────────────────────────────────────────────────────
async function fetchSettings() {
  try {
    const d = await fetch(`/api/settings?shop=${shopSlug}`).then(r => r.json());
    maxBookingDays  = parseInt(d.max_booking_days) || 60;
    paymentMode     = d.payment_mode || (d.deposit_required === 'true' ? 'deposit' : 'in_person');
    depositRequired = paymentMode === 'deposit';
    depositAmount   = parseFloat(d.deposit_amount) || 0;
    stripeKey       = d.stripe_publishable_key || null;
    requireLogin    = d.require_login === 'true';
    allowGuest      = d.allow_guest !== 'false';
    googleConfigured = !!d.google_configured;

    // Show/hide guest button based on admin setting
    const guestBtn = document.getElementById('guestBtn');
    if (guestBtn) guestBtn.style.display = allowGuest ? '' : 'none';

    // Enable Google button if credentials are configured
    const googleBtn = document.getElementById('googleBtn');
    if (googleBtn && googleConfigured) {
      googleBtn.disabled = false;
      googleBtn.style.cursor = 'pointer';
      googleBtn.style.color = '#333';
      const soon = googleBtn.querySelector('.google-soon');
      if (soon) soon.style.display = 'none';
      googleBtn.querySelector('svg').style.opacity = '1';
      googleBtn.addEventListener('click', () => { window.location.href = '/auth/google'; });
    }

    const showStep5 = stripeKey && (paymentMode === 'deposit' ? depositAmount > 0 : paymentMode === 'full');
    document.getElementById('step5line').style.display = showStep5 ? '' : 'none';
    document.getElementById('step5dot').style.display  = showStep5 ? '' : 'none';
  } catch { maxBookingDays = 60; }
}

// ── Helpers ───────────────────────────────────────────────────────────
function p2(n) { return String(n).padStart(2,'0'); }
function localDateStr(d) { return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; }
function fmtDate(s) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}
function fmtTime(s) {
  const [h,m] = s.split(':').map(Number);
  return `${h%12||12}:${p2(m)} ${h>=12?'PM':'AM'}`;
}
function fmtDuration(mins) {
  if (mins<60) return `${mins} min`;
  const h=Math.floor(mins/60), m=mins%60;
  return m?`${h}h ${m}min`:`${h} hr`;
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Phone formatting ──────────────────────────────────────────────────
function formatPhone(e) {
  let v = e.target.value.replace(/\D/g,'').slice(0,10);
  if (v.length>=7)      v=`(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
  else if (v.length>=4) v=`(${v.slice(0,3)}) ${v.slice(3)}`;
  else if (v.length>0)  v=`(${v}`;
  e.target.value = v;
}

// ── Calendar ─────────────────────────────────────────────────────────
function initCalendar() {
  const now = new Date();
  calYear = now.getFullYear(); calMonth = now.getMonth();
  renderCalendar();
}

function renderCalendar() {
  const title = document.getElementById('calTitle');
  const grid  = document.getElementById('calGrid');
  if (!title||!grid) return;

  const today   = new Date();
  const todayStr = localDateStr(today);
  const maxDate  = new Date(); maxDate.setDate(maxDate.getDate()+maxBookingDays);
  const maxStr   = localDateStr(maxDate);

  title.textContent = `${MONTH_NAMES[calMonth]} ${calYear}`;
  const prev = document.getElementById('calPrev');
  if (prev) prev.disabled = calYear===today.getFullYear() && calMonth===today.getMonth();

  const firstDay=new Date(calYear,calMonth,1).getDay();
  const days=new Date(calYear,calMonth+1,0).getDate();
  const HDR=['Su','Mo','Tu','We','Th','Fr','Sa'];

  let html=HDR.map(d=>`<div class="cal-day-header">${d}</div>`).join('');
  for(let i=0;i<firstDay;i++) html+='<div></div>';
  for(let d=1;d<=days;d++) {
    const ds=`${calYear}-${p2(calMonth+1)}-${p2(d)}`;
    if(ds<todayStr||ds>maxStr) { html+=`<div class="cal-day cal-day-off">${d}</div>`; continue; }
    const cls=['cal-day',ds===state.date&&'cal-day-sel',ds===todayStr&&'cal-day-today'].filter(Boolean).join(' ');
    html+=`<button class="${cls}" data-date="${ds}">${d}</button>`;
  }
  grid.innerHTML=html;
  grid.querySelectorAll('button.cal-day').forEach(btn=>{
    btn.addEventListener('click',()=>{ state.date=btn.dataset.date; goStep(3); });
  });
}

function changeMonth(dir) {
  calMonth+=dir;
  if(calMonth<0){calMonth=11;calYear--;}
  if(calMonth>11){calMonth=0;calYear++;}
  renderCalendar();
}

// ── Services ──────────────────────────────────────────────────────────
async function loadServices() {
  const grid=document.getElementById('servicesGrid');
  try {
    const services=await fetch(`/api/services?shop=${shopSlug}`).then(r=>r.json());
    if(!services.length){ grid.innerHTML='<p class="no-slots-msg">No services available yet.</p>'; return; }
    grid.innerHTML=services.map(s=>`
      <div class="service-card" id="svc-${s.id}">
        <div class="service-card-name">${s.name}</div>
        <div class="service-card-duration">${fmtDuration(s.duration_minutes)}</div>
        ${s.price?`<div class="service-card-price">$${parseFloat(s.price).toFixed(2)}</div>`:''}
      </div>`).join('');
    services.forEach(s=>document.getElementById(`svc-${s.id}`)
      .addEventListener('click',()=>selectService(s.id,s.name,s.duration_minutes,parseFloat(s.price)||0)));
  } catch { grid.innerHTML='<p class="error-msg">Could not load services. Please refresh.</p>'; }
}

function selectService(id,name,duration,price) {
  state.service={id,name,duration,price:price||0};
  document.querySelectorAll('.service-card').forEach(c=>c.classList.remove('selected'));
  document.getElementById(`svc-${id}`).classList.add('selected');
  setTimeout(()=>goStep(2),180);
}

// ── Time slots ────────────────────────────────────────────────────────
async function loadSlots() {
  const container=document.getElementById('slotsContainer');
  document.getElementById('selectedDateDisplay').textContent=fmtDate(state.date);
  container.innerHTML='<div class="loading-spinner">Finding open times…</div>';
  state.time=null;
  try {
    const data=await fetch(`/api/slots?date=${state.date}&service_id=${state.service.id}&shop=${shopSlug}`).then(r=>r.json());
    if(!data.slots||!data.slots.length) {
      container.innerHTML=`<div class="no-slots-msg"><strong>${data.closed?'Closed this day.':'No openings this day.'}</strong><br><span style="font-size:.85rem">Pick a different date.</span></div>`;
      return;
    }
    container.innerHTML=`<div class="slots-grid">${data.slots.map(s=>`<button class="slot-btn" data-time="${s}">${fmtTime(s)}</button>`).join('')}</div>`;
    container.querySelectorAll('.slot-btn').forEach(btn=>btn.addEventListener('click',()=>selectSlot(btn.dataset.time,btn)));
  } catch { container.innerHTML='<p class="error-msg">Could not load times. Please try again.</p>'; }
}

function selectSlot(time,el) {
  state.time=time;
  document.querySelectorAll('.slot-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('summaryService').textContent =state.service.name;
  document.getElementById('summaryDate').textContent    =fmtDate(state.date);
  document.getElementById('summaryTime').textContent    =fmtTime(time);
  document.getElementById('summaryDuration').textContent=fmtDuration(state.service.duration);
  setTimeout(()=>goStep(4),180);
}

// ── Navigation ────────────────────────────────────────────────────────
function goStep(n) {
  currentStep = n;
  const authScreen  = document.getElementById('authScreen');
  const bookingFlow = document.getElementById('bookingFlow');
  const indicators  = document.getElementById('stepIndicators');

  if (n === 0) {
    authScreen.style.display  = '';
    bookingFlow.style.display = 'none';
    return;
  }

  authScreen.style.display  = 'none';
  bookingFlow.style.display = '';
  indicators.style.display  = n === 'success' ? 'none' : 'flex';

  document.querySelectorAll('.booking-step').forEach(s => s.classList.remove('active'));

  if (n !== 'success') {
    document.querySelectorAll('.step-dot').forEach((dot, i) => {
      dot.classList.remove('active','done');
      if (i+1 < n)       dot.classList.add('done');
      else if (i+1 === n) dot.classList.add('active');
    });
  }

  const el = n === 'success'
    ? document.getElementById('stepSuccess')
    : document.getElementById(`step${n}`);
  if (el) el.classList.add('active');

  updateAccountCorner(currentUser);

  if (n === 2) initCalendar();
  if (n === 3) loadSlots();
  if (n === 4) prefillContact();
  if (n === 5) initStripePayment();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function prefillContact() {
  if (!currentUser) return;
  const nameEl  = document.getElementById('customerName');
  const phoneEl = document.getElementById('customerPhone');
  const emailEl = document.getElementById('customerEmail');
  if (!nameEl.value  && currentUser.name)  nameEl.value  = currentUser.name;
  if (!emailEl.value && currentUser.email) emailEl.value = currentUser.email;
  if (!phoneEl.value && currentUser.phone) {
    let v = currentUser.phone.replace(/\D/g,'').slice(0,10);
    if (v.length>=7)      v=`(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
    else if (v.length>=4) v=`(${v.slice(0,3)}) ${v.slice(3)}`;
    else if (v.length>0)  v=`(${v}`;
    phoneEl.value = v;
  }
}

// ── Booking form submit ───────────────────────────────────────────────
async function submitBooking(e) {
  e.preventDefault();
  const name  = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  const email = document.getElementById('customerEmail').value.trim();
  clearErrors();

  if (!phone && !email) {
    showFormError('Please enter at least a phone number or email address so we can reach you.');
    return;
  }

  state.customerInfo = { name, phone, email };

  if (paymentMode === 'deposit' && stripeKey && depositAmount > 0) {
    goStep(5);
  } else if (paymentMode === 'full' && stripeKey && state.service.price > 0) {
    goStep(5);
  } else {
    await createBooking(null);
  }
}

// ── Stripe payment ────────────────────────────────────────────────────
async function initStripePayment() {
  const container = document.getElementById('stripePaymentElement');
  container.innerHTML = '<div class="loading-spinner">Setting up payment…</div>';

  const chargeAmount = paymentMode === 'full' ? state.service.price : depositAmount;
  const isFullPay = paymentMode === 'full';

  document.querySelector('#step5 h2').textContent = isFullPay ? 'Full Payment' : 'Secure Deposit';
  document.getElementById('depositSubtitle').textContent = isFullPay
    ? `Pay $${chargeAmount.toFixed(2)} to confirm your appointment`
    : `Pay a $${chargeAmount.toFixed(2)} deposit to confirm your spot`;
  document.getElementById('payBtn').textContent = isFullPay ? 'Pay & Confirm Booking' : 'Pay & Confirm Booking';

  try {
    const data = await fetch('/api/create-payment-intent', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        amount: chargeAmount,
        description: isFullPay
          ? `Full payment — ${state.service.name} for ${state.customerInfo.name}`
          : `Deposit — ${state.service.name} for ${state.customerInfo.name}`,
      }),
    }).then(r=>r.json());

    stripe = Stripe(stripeKey);
    stripeElements = stripe.elements({
      clientSecret: data.client_secret,
      appearance: { theme:'stripe', variables:{ colorPrimary:'#c8a96e', borderRadius:'8px' } },
    });
    container.innerHTML = '';
    stripeElements.create('payment').mount(container);
  } catch (err) {
    container.innerHTML = `<p class="error-msg">${err.message||'Payment setup failed.'}</p>`;
  }
}

async function confirmPayment() {
  const btn   = document.getElementById('payBtn');
  const errEl = document.getElementById('paymentErr');
  btn.disabled = true; btn.textContent = 'Processing…';
  errEl.style.display = 'none';

  sessionStorage.setItem('pendingBooking', JSON.stringify({
    service: state.service, date: state.date,
    time: state.time, customerInfo: state.customerInfo,
  }));

  const { error, paymentIntent } = await stripe.confirmPayment({
    elements: stripeElements,
    confirmParams: { return_url: `${window.location.origin}${window.location.pathname}?payment_return=1` },
    redirect: 'if_required',
  });

  if (error) {
    sessionStorage.removeItem('pendingBooking');
    errEl.textContent = error.message;
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Pay & Confirm Booking';
  } else if (paymentIntent?.status === 'succeeded') {
    sessionStorage.removeItem('pendingBooking');
    await createBooking(paymentIntent.id);
  }
}

// ── Create booking ────────────────────────────────────────────────────
async function createBooking(paymentIntentId) {
  const info = state.customerInfo;
  const btn  = document.getElementById('submitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Booking…'; }

  try {
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        service_id:        state.service.id,
        customer_name:     info.name,
        customer_phone:    info.phone,
        customer_email:    info.email||null,
        appointment_date:  state.date,
        appointment_time:  state.time,
        payment_intent_id: paymentIntentId||null,
        shop_slug:         shopSlug||undefined,
      }),
    });
    const data = await r.json();
    if (r.ok) { showSuccess(data.booking_id, info.name); }
    else {
      showFormError(data.error||'Booking failed. Please try again.');
      if (btn) { btn.disabled=false; btn.textContent='Confirm Booking'; }
    }
  } catch {
    showFormError('Network error. Please try again.');
    if (btn) { btn.disabled=false; btn.textContent='Confirm Booking'; }
  }
}

// ── Success ───────────────────────────────────────────────────────────
function showSuccess(id, name) {
  document.querySelectorAll('.booking-step').forEach(s=>s.classList.remove('active'));
  document.getElementById('stepSuccess').classList.add('active');
  document.getElementById('stepIndicators').style.display = 'none';

  let successMsg, paymentRow;
  if (paymentMode === 'deposit' && depositAmount > 0) {
    successMsg  = 'Your deposit is confirmed. Pay the remaining balance when you arrive.';
    paymentRow  = `<div class="confirmation-row"><span class="label">Deposit paid</span><span class="value" style="color:#2ecc71">$${depositAmount.toFixed(2)} ✓</span></div>`;
  } else if (paymentMode === 'full' && state.service.price > 0) {
    successMsg  = 'Payment confirmed — you\'re all set. Nothing to pay at the door.';
    paymentRow  = `<div class="confirmation-row"><span class="label">Paid in full</span><span class="value" style="color:#2ecc71">$${state.service.price.toFixed(2)} ✓</span></div>`;
  } else {
    successMsg  = 'Show your confirmation number at the shop — pay in full when you arrive.';
    paymentRow  = `<div class="confirmation-row"><span class="label">Payment</span><span class="value">Pay at shop</span></div>`;
  }
  document.querySelector('.success-text').textContent = successMsg;

  document.getElementById('confirmationDetails').innerHTML=`
    <div class="confirmation-row"><span class="label">Confirmation #</span><span class="value">#${String(id).padStart(5,'0')}</span></div>
    <div class="confirmation-row"><span class="label">Service</span><span class="value">${state.service.name}</span></div>
    <div class="confirmation-row"><span class="label">Date</span><span class="value">${fmtDate(state.date)}</span></div>
    <div class="confirmation-row"><span class="label">Time</span><span class="value">${fmtTime(state.time)}</span></div>
    <div class="confirmation-row"><span class="label">Name</span><span class="value">${name}</span></div>
    ${paymentRow}`;
  window.scrollTo({top:0,behavior:'smooth'});
}

function clearErrors() { document.querySelectorAll('.error-msg').forEach(e=>e.remove()); }
function showFormError(msg) {
  clearErrors();
  const d=document.createElement('div'); d.className='error-msg'; d.textContent=msg;
  const f=document.getElementById('contactForm'); f.insertBefore(d,f.firstChild);
}

function resetBooking() {
  state.service=state.date=state.time=state.customerInfo=null;
  ['customerName','customerPhone','customerEmail'].forEach(id=>document.getElementById(id).value='');
  loadServices();
  goStep(currentUser || !requireLogin ? 1 : 0);
}
