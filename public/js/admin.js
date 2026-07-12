/* Admin panel */
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

document.addEventListener('DOMContentLoaded', async () => {
  // Wire up slug auto-generation from shop name
  const shopNameInput = document.getElementById('regShopName');
  if (shopNameInput) {
    shopNameInput.addEventListener('input', function () {
      document.getElementById('regSlug').value = this.value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    });
  }

  // Clean up redirect params from Stripe and Stripe Connect callbacks
  const urlParams = new URLSearchParams(window.location.search);
  const didSubscribe     = urlParams.get('subscribed')    === '1';
  const didConnect       = urlParams.get('connected')     === '1';
  const didConnectError  = !!urlParams.get('connect_error');
  if (didSubscribe || didConnect || didConnectError) {
    history.replaceState({}, '', '/admin');
  }

  let data = { authenticated: false };
  try { data = await api('GET', '/api/admin/check-auth'); } catch {}

  if (!data.authenticated) {
    showLogin();
    if (urlParams.get('register') === '1') {
      history.replaceState({}, '', '/admin');
      loginTab('register');
    } else if (urlParams.get('google_new') === '1') {
      history.replaceState({}, '', '/admin');
      showGoogleNewPane();
    } else if (urlParams.get('auth_error') === '1') {
      history.replaceState({}, '', '/admin');
      document.getElementById('loginErr').textContent = 'Google sign-in failed. Please try again.';
      document.getElementById('loginErr').style.display = '';
    }
  } else if (!data.subscriptionActive) {
    showSubscriptionRequired();
  } else {
    showDashboard(data.shopName, data.bookingUrl);
    if (didConnect) {
      switchTab('settings');
      showToast('Stripe account connected! Customer payments will go to your bank.');
    } else if (didConnectError) {
      switchTab('settings');
      showToast('Stripe connection failed — please try again.', 'error');
    }
  }
});

// ── Auth ──────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('subscriptionPage').style.display = 'none';
  document.getElementById('adminShell').style.display = 'none';
}

function showSubscriptionRequired() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('subscriptionPage').style.display = 'flex';
  document.getElementById('adminShell').style.display = 'none';
}

function showDashboard(shopName, bookingUrl) {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('subscriptionPage').style.display = 'none';
  document.getElementById('adminShell').style.display = 'flex';
  if (shopName) {
    const brand = document.querySelector('.brand');
    if (brand) brand.innerHTML = '&#9986; ' + esc(shopName);
  }
  if (bookingUrl) {
    const link = document.getElementById('viewBookingLink');
    if (link) link.href = bookingUrl;
  }
  switchTab('today');
}

function showGoogleNewPane() {
  document.getElementById('loginPage').style.display = '';
  document.getElementById('signinPane').style.display = 'none';
  document.getElementById('registerPane').style.display = 'none';
  document.getElementById('googleNewPane').style.display = '';
  document.querySelector('.login-tabs').style.display = 'none';
  const shopInput = document.getElementById('gNewShopName');
  if (shopInput) {
    shopInput.addEventListener('input', function() {
      document.getElementById('gNewSlug').value = this.value
        .toLowerCase().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
    });
  }
}

async function doGoogleRegister() {
  const shopName = document.getElementById('gNewShopName').value.trim();
  const slug     = document.getElementById('gNewSlug').value.trim();
  const errEl    = document.getElementById('googleNewErr');
  errEl.style.display = 'none';
  if (!shopName || !slug) { errEl.textContent = 'Shop name and URL are required'; errEl.style.display = ''; return; }
  try {
    await api('POST', '/api/admin/register-google', { shopName, slug });
    showSubscriptionRequired();
  } catch (err) {
    errEl.textContent = err.message || 'Error creating shop';
    errEl.style.display = '';
  }
}

function loginTab(tab) {
  const isSignIn = tab === 'signin';
  document.getElementById('tabSignIn').classList.toggle('active', isSignIn);
  document.getElementById('tabRegister').classList.toggle('active', !isSignIn);
  document.getElementById('googleNewPane').style.display = 'none';
  document.querySelector('.login-tabs').style.display = '';
  document.getElementById('signinPane').style.display = isSignIn ? '' : 'none';
  document.getElementById('registerPane').style.display = isSignIn ? 'none' : '';
}

async function doLogin(e) {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const pw    = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';
  errEl.textContent = '';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || undefined, password: pw }),
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Login failed'; errEl.style.display = 'block'; return; }
    const auth = await api('GET', '/api/admin/check-auth');
    if (auth.subscriptionActive) {
      showDashboard(auth.shopName, auth.bookingUrl);
    } else {
      showSubscriptionRequired();
    }
  } catch {
    errEl.textContent = 'Network error';
    errEl.style.display = 'block';
  }
}

async function doRegister(e) {
  e.preventDefault();
  const shopName = document.getElementById('regShopName').value.trim();
  const email    = document.getElementById('regEmail').value.trim();
  const pw       = document.getElementById('regPw').value;
  const slug     = document.getElementById('regSlug').value.trim();
  const errEl    = document.getElementById('registerErr');
  errEl.style.display = 'none';
  try {
    const r = await fetch('/api/admin/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw, shopName, slug }),
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Registration failed'; errEl.style.display = 'block'; return; }
    showSubscriptionRequired();
  } catch {
    errEl.textContent = 'Network error';
    errEl.style.display = 'block';
  }
}

async function doLogout() {
  await api('POST', '/api/admin/logout');
  showLogin();
}

async function goSubscribe() {
  try {
    const r = await fetch('/api/billing/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const d = await r.json();
    if (d.url) { window.location.href = d.url; }
    else showToast(d.error || 'Could not start checkout', 'error');
  } catch { showToast('Network error', 'error'); }
}

async function openBillingPortal() {
  try {
    const r = await fetch('/api/billing/portal');
    const d = await r.json();
    if (d.url) { window.location.href = d.url; }
    else showToast(d.error || 'Billing portal unavailable', 'error');
  } catch { showToast('Network error', 'error'); }
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
  const name   = document.getElementById(`ename-${id}`).value.trim();
  const dur    = document.getElementById(`edur-${id}`).value;
  const price  = document.getElementById(`eprice-${id}`).value;
  const active = document.getElementById(`eactive-${id}`).checked;

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

  document.getElementById('requireLogin').checked = data.require_login === 'true';
  document.getElementById('allowGuest').checked   = data.allow_guest !== 'false';
  toggleLoginSettings();

  // Custom domain
  const domainEl = document.getElementById('customDomain');
  const removeBtn = document.getElementById('removeDomainBtn');
  if (domainEl) domainEl.value = data.custom_domain || '';
  if (removeBtn) removeBtn.style.display = data.custom_domain ? '' : 'none';
  if (data.custom_domain) renderDomainInstructions(data.custom_domain);

  // Stripe Connect payout card
  renderStripeConnect(data);

  // Stripe status card
  const card = document.getElementById('stripeStatusCard');
  if (!card) return;
  if (!data.stripe_configured) {
    card.innerHTML = `
      <div style="padding:1rem;background:rgba(231,76,60,.07);border:1px solid rgba(231,76,60,.18);border-radius:10px">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.65rem">
          <span style="color:#e74c3c">⚠</span>
          <strong style="font-size:.9rem;color:#e74c3c">Stripe Not Connected — No real payments yet</strong>
        </div>
        <p style="font-size:.8rem;color:#aaa;margin-bottom:.8rem">Set up Stripe in 3 steps to start collecting payments:</p>
        <ol style="font-size:.78rem;color:#888;margin:0 0 .9rem 1.1rem;line-height:2">
          <li>Create a free <a href="https://stripe.com" target="_blank" style="color:var(--gold)">Stripe account</a> (or sign in)</li>
          <li>Go to <a href="https://dashboard.stripe.com/apikeys" target="_blank" style="color:var(--gold)">Dashboard → Developers → API Keys</a></li>
          <li>Copy your keys into Railway as <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc">STRIPE_SECRET_KEY</code> and <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc">STRIPE_PUBLISHABLE_KEY</code></li>
        </ol>
        <a href="https://dashboard.stripe.com/apikeys" target="_blank"
           style="display:inline-flex;align-items:center;gap:.4rem;padding:.5rem 1rem;background:var(--gold);color:#1a1007;border-radius:8px;font-size:.8rem;font-weight:700;text-decoration:none">
          Open Stripe API Keys →
        </a>
      </div>`;
  } else if (data.stripe_test_mode) {
    card.innerHTML = `
      <div style="padding:1rem;background:rgba(200,169,110,.07);border:1px solid rgba(200,169,110,.25);border-radius:10px">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem">
          <span style="color:#c8a96e">⚡</span>
          <strong style="font-size:.9rem;color:#c8a96e">Test Mode — No real money moves yet</strong>
        </div>
        <p style="font-size:.78rem;color:#888;margin-bottom:.75rem">Stripe is connected with <strong style="color:#c8a96e">test keys</strong>. Payments go through but no real card is charged. To go live:</p>
        <ol style="font-size:.78rem;color:#888;margin:0 0 .9rem 1.1rem;line-height:2">
          <li>Toggle to <strong style="color:#ccc">Live mode</strong> in your Stripe Dashboard (top-left switch)</li>
          <li>Copy your <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc">sk_live_...</code> and <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc">pk_live_...</code> keys</li>
          <li>Replace both Railway env vars with the live keys and redeploy</li>
        </ol>
        <a href="https://dashboard.stripe.com/apikeys" target="_blank"
           style="display:inline-flex;align-items:center;gap:.4rem;padding:.5rem 1rem;background:rgba(200,169,110,.15);border:1px solid rgba(200,169,110,.4);color:var(--gold);border-radius:8px;font-size:.8rem;font-weight:700;text-decoration:none">
          Get Live Keys →
        </a>
      </div>`;
  } else {
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:.65rem;padding:.85rem 1rem;background:rgba(46,204,113,.07);border:1px solid rgba(46,204,113,.2);border-radius:10px">
        <span style="color:#2ecc71;font-size:1.2rem">✓</span>
        <div>
          <div style="font-weight:700;font-size:.9rem;color:#2ecc71">Stripe Live — Real payments active</div>
          <div style="font-size:.78rem;color:#888;margin-top:.15rem">Customers are being charged at booking. Manage payouts in your <a href="https://dashboard.stripe.com" target="_blank" style="color:var(--gold)">Stripe Dashboard</a>.</div>
        </div>
      </div>`;
  }
}

async function saveDomain() {
  const val = document.getElementById('customDomain').value.trim();
  try {
    const r = await fetch('/api/admin/domain', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_domain: val }),
    });
    const d = await r.json();
    if (!r.ok) { showToast(d.error || 'Save failed', 'error'); return; }
    const removeBtn = document.getElementById('removeDomainBtn');
    if (removeBtn) removeBtn.style.display = val ? '' : 'none';
    if (val) { renderDomainInstructions(d.custom_domain || val); showToast('Domain saved!'); }
    else { document.getElementById('domainInstructions').style.display = 'none'; showToast('Domain removed.'); }
  } catch { showToast('Network error', 'error'); }
}

async function removeDomain() {
  document.getElementById('customDomain').value = '';
  await saveDomain();
}

function renderDomainInstructions(domain) {
  const el = document.getElementById('domainInstructions');
  if (!el) return;
  el.style.display = '';
  el.innerHTML = `
    <div style="padding:.9rem 1rem;background:rgba(46,204,113,.06);border:1px solid rgba(46,204,113,.18);border-radius:10px;font-size:.8rem">
      <div style="font-weight:700;color:#2ecc71;margin-bottom:.6rem">✓ Domain saved — point your DNS to activate it:</div>
      <div style="display:grid;grid-template-columns:60px 1fr 1fr;gap:.25rem .75rem;font-size:.77rem;margin-bottom:.6rem">
        <span style="color:#666;font-weight:700">Type</span><span style="color:#666;font-weight:700">Name / Host</span><span style="color:#666;font-weight:700">Value / Points to</span>
        <code style="color:#c8a96e">CNAME</code>
        <code style="color:#ccc;word-break:break-all">${esc(domain)}</code>
        <code style="color:#ccc;word-break:break-all">my-shop-bookings-production.up.railway.app</code>
      </div>
      <p style="margin:0;color:#888;font-size:.76rem">Add this record in your domain registrar (GoDaddy, Namecheap, Google Domains, etc.). For automatic HTTPS, run your domain through <strong style="color:#ccc">Cloudflare</strong> (free) — enable the orange proxy cloud and SSL handles itself. DNS changes take 5–30 min to propagate.</p>
    </div>`;
}

function renderStripeConnect(data) {
  const card = document.getElementById('stripeConnectCard');
  if (!card) return;

  if (!data.stripe_configured) {
    card.innerHTML = `
      <div style="padding:.85rem 1rem;background:rgba(100,100,100,.07);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-size:.8rem;color:#888">
        Set up Stripe (above) first, then you can connect your payout account.
      </div>`;
    return;
  }

  if (!data.stripe_connect_enabled) {
    card.innerHTML = `
      <div style="padding:1rem;background:rgba(200,169,110,.06);border:1px solid rgba(200,169,110,.18);border-radius:10px">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.65rem">
          <span style="color:#c8a96e">⚙</span>
          <strong style="font-size:.88rem;color:#c8a96e">One more step — Set up Stripe Connect</strong>
        </div>
        <p style="font-size:.78rem;color:#888;margin-bottom:.8rem">To route customer payments directly to your bank, add your Stripe Connect client ID:</p>
        <ol style="font-size:.78rem;color:#888;margin:0 0 .9rem 1.1rem;line-height:2">
          <li>Go to <a href="https://dashboard.stripe.com/settings/connect" target="_blank" style="color:var(--gold)">Stripe Dashboard → Connect → Settings</a></li>
          <li>Scroll to <strong style="color:#ccc">OAuth settings</strong> and copy your <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc">Client ID</code> (starts with <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc">ca_...</code>)</li>
          <li>Add it to Railway as <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc">STRIPE_CONNECT_CLIENT_ID</code> and redeploy</li>
          <li>Also set your <strong style="color:#ccc">Redirect URI</strong> in Stripe Connect settings to: <code style="background:rgba(0,0,0,.2);padding:.1rem .3rem;border-radius:4px;color:#ccc;word-break:break-all">${window.location.origin}/api/billing/connect/callback</code></li>
        </ol>
        <a href="https://dashboard.stripe.com/settings/connect" target="_blank"
           style="display:inline-flex;align-items:center;gap:.4rem;padding:.5rem 1rem;background:rgba(200,169,110,.15);border:1px solid rgba(200,169,110,.4);color:var(--gold);border-radius:8px;font-size:.8rem;font-weight:700;text-decoration:none">
          Open Stripe Connect Settings →
        </a>
      </div>`;
    return;
  }

  if (data.stripe_connect_status === 'connected') {
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:.65rem;padding:.85rem 1rem;background:rgba(46,204,113,.07);border:1px solid rgba(46,204,113,.2);border-radius:10px">
        <span style="color:#2ecc71;font-size:1.2rem">✓</span>
        <div style="flex:1">
          <div style="font-weight:700;font-size:.9rem;color:#2ecc71">Payout Account Connected</div>
          <div style="font-size:.78rem;color:#888;margin-top:.15rem">Customer payments go directly to your bank. Manage payouts in your <a href="https://dashboard.stripe.com" target="_blank" style="color:var(--gold)">Stripe Dashboard</a>.</div>
        </div>
        <button onclick="disconnectStripe()" class="btn btn-sm btn-danger" style="flex-shrink:0">Disconnect</button>
      </div>`;
  } else {
    card.innerHTML = `
      <div style="padding:1rem;background:rgba(100,100,100,.05);border:1px solid rgba(255,255,255,.09);border-radius:10px">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem">
          <span style="color:#888">⚡</span>
          <strong style="font-size:.88rem;color:#ccc">Not connected — payments go to platform account</strong>
        </div>
        <p style="font-size:.78rem;color:#888;margin-bottom:.8rem">Connect your Stripe account so customer deposits and full payments land in <em>your</em> bank, not ours.</p>
        <a href="/api/billing/connect"
           style="display:inline-flex;align-items:center;gap:.4rem;padding:.55rem 1.1rem;background:var(--gold);color:#1a1007;border-radius:8px;font-size:.85rem;font-weight:700;text-decoration:none">
          Connect Stripe Account →
        </a>
      </div>`;
  }
}

async function disconnectStripe() {
  if (!confirm('Disconnect your Stripe payout account? Customer payments will stop routing to your bank until you reconnect.')) return;
  try {
    const r = await fetch('/api/billing/disconnect', { method: 'POST' });
    const d = await r.json();
    if (r.ok) { showToast('Stripe account disconnected.'); loadSettings(); }
    else showToast(d.error || 'Disconnect failed', 'error');
  } catch { showToast('Network error', 'error'); }
}

function togglePaymentMode() {
  const isDeposit = document.getElementById('modeDepositRadio').checked;
  document.getElementById('depositAmtGroup').style.display = isDeposit ? 'block' : 'none';
}

function selectedPaymentMode() {
  if (document.getElementById('modeDepositRadio').checked) return 'deposit';
  if (document.getElementById('modeFullRadio').checked)    return 'full';
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
  if (nameEl) nameEl.textContent = name || 'Manager';
}

async function loadAccount() {
  try {
    const [profile, auth] = await Promise.all([
      api('GET', '/api/admin/profile'),
      api('GET', '/api/admin/check-auth'),
    ]);
    if (profile.name)  document.getElementById('profileName').value  = profile.name;
    if (profile.email) document.getElementById('profileEmail').value = profile.email;
    if (profile.phone) document.getElementById('profilePhone').value = profile.phone;
    updateProfileHero(profile.name);

    // Billing info
    const statusEl = document.getElementById('billingStatus');
    const urlEl    = document.getElementById('billingBookingUrl');
    if (statusEl) {
      const status = auth.subscriptionStatus || 'active';
      const labels = { active:'Active', trialing:'Trial', inactive:'Inactive', cancelled:'Cancelled', past_due:'Past Due' };
      statusEl.innerHTML = `<span class="sub-badge ${status}">${labels[status] || status}</span>`;
    }
    if (urlEl && auth.shopSlug) {
      const url = auth.bookingUrl || `${window.location.origin}/${auth.shopSlug}`;
      urlEl.innerHTML = `<a href="${esc(url)}" target="_blank" style="color:var(--gold)">${esc(url)}</a>`;
    }
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
  if (r.ok) { showToast('Password changed!'); e.target.reset(); }
  else { errEl.textContent = d.error || 'Failed'; errEl.style.display = 'block'; }
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
  const [y,m,d] = String(str).slice(0,10).split('-').map(Number);
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
