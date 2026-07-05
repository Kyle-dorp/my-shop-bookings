const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { sendBookingConfirmation } = require('../utils/email');
const stripeClient = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

function timeToMinutes(t) { const [h,m] = t.split(':').map(Number); return h*60+m; }
function minutesToTime(mins) { return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`; }

// Resolve shop slug → shop id.  '' or 'default' → first shop (backward compat).
async function resolveShop(slug) {
  if (!slug || slug === 'default') {
    const r = await pool.query('SELECT id FROM shops ORDER BY id LIMIT 1');
    return r.rows[0]?.id || 1;
  }
  const r = await pool.query('SELECT id FROM shops WHERE slug=$1', [slug]);
  return r.rows[0]?.id || null;
}

// GET /api/settings
router.get('/settings', async (req, res) => {
  try {
    const shopId = await resolveShop(req.query.shop);
    if (!shopId) return res.json({ max_booking_days:60, payment_mode:'in_person', deposit_required:'false', deposit_amount:'10' });
    const r = await pool.query('SELECT key, value FROM settings WHERE shop_id=$1', [shopId]);
    const s = { max_booking_days:60, payment_mode:'in_person', deposit_required:'false', deposit_amount:'10', require_login:'false', allow_guest:'true' };
    r.rows.forEach(row => s[row.key] = row.value);
    s.stripe_publishable_key = process.env.STRIPE_PUBLISHABLE_KEY || null;
    s.google_configured      = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    res.json(s);
  } catch { res.json({ max_booking_days:60, payment_mode:'in_person', deposit_required:'false', deposit_amount:'10' }); }
});

// POST /api/create-payment-intent
router.post('/create-payment-intent', async (req, res) => {
  if (!stripeClient) return res.status(503).json({ error: 'Payments not configured' });
  const amount = parseFloat(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  try {
    const pi = await stripeClient.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      description: req.body.description || 'Appointment payment',
      automatic_payment_methods: { enabled: true },
    });
    res.json({ client_secret: pi.client_secret });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/services
router.get('/services', async (req, res) => {
  try {
    const shopId = await resolveShop(req.query.shop);
    if (!shopId) return res.json([]);
    const r = await pool.query(
      'SELECT id, name, duration_minutes, price FROM services WHERE active=true AND shop_id=$1 ORDER BY display_order, name',
      [shopId]
    );
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// GET /api/slots
router.get('/slots', async (req, res) => {
  const { date, service_id, shop } = req.query;
  if (!date || !service_id) return res.status(400).json({ error: 'Missing date or service_id' });
  try {
    const shopId = await resolveShop(shop);
    if (!shopId) return res.status(404).json({ error: 'Shop not found' });

    const svcR = await pool.query(
      'SELECT duration_minutes FROM services WHERE id=$1 AND active=true AND shop_id=$2',
      [service_id, shopId]
    );
    if (!svcR.rows.length) return res.status(404).json({ error: 'Service not found' });
    const duration = svcR.rows[0].duration_minutes;

    const [year, month, day] = date.split('-').map(Number);
    const dayOfWeek = new Date(year, month-1, day).getDay();

    const hrsR = await pool.query(
      'SELECT open_time, close_time, is_closed FROM business_hours WHERE day_of_week=$1 AND shop_id=$2',
      [dayOfWeek, shopId]
    );
    if (!hrsR.rows.length || hrsR.rows[0].is_closed) return res.json({ slots:[], closed:true });

    const { open_time, close_time } = hrsR.rows[0];
    const openMins  = timeToMinutes(open_time);
    const closeMins = timeToMinutes(close_time);

    const apptR = await pool.query(
      `SELECT appointment_time, end_time FROM appointments
       WHERE appointment_date=$1 AND status!='cancelled' AND shop_id=$2`,
      [date, shopId]
    );

    const now      = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const nowMins  = now.getHours()*60 + now.getMinutes() + 30;

    const slots = [];
    for (let t = openMins; t + duration <= closeMins; t += 30) {
      if (date === todayStr && t < nowMins) continue;
      const slotEnd = t + duration;
      let ok = true;
      for (const a of apptR.rows) {
        const aS = timeToMinutes(a.appointment_time), aE = timeToMinutes(a.end_time);
        if (t < aE && slotEnd > aS) { ok = false; break; }
      }
      if (ok) slots.push(minutesToTime(t));
    }
    res.json({ slots });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/bookings
router.post('/bookings', async (req, res) => {
  const { service_id, customer_name, customer_phone, customer_email,
          appointment_date, appointment_time, shop_slug } = req.body;
  if (!service_id || !customer_name || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const nameClean  = customer_name.trim();
  const phoneClean = (customer_phone || '').trim();
  const emailClean = (customer_email || '').trim();
  if (!nameClean) return res.status(400).json({ error: 'Name is required' });
  if (!phoneClean && !emailClean) return res.status(400).json({ error: 'Please provide a phone number or email address' });

  try {
    const shopId = await resolveShop(shop_slug || req.query.shop);
    if (!shopId) return res.status(404).json({ error: 'Shop not found' });

    const svcR = await pool.query(
      'SELECT name, duration_minutes FROM services WHERE id=$1 AND active=true AND shop_id=$2',
      [service_id, shopId]
    );
    if (!svcR.rows.length) return res.status(404).json({ error: 'Service not found' });
    const { name: serviceName, duration_minutes: duration } = svcR.rows[0];

    const startMins = timeToMinutes(appointment_time);
    const endTime   = minutesToTime(startMins + duration);

    const conflict = await pool.query(
      `SELECT id FROM appointments
       WHERE appointment_date=$1 AND status!='cancelled'
         AND appointment_time<$2::time AND end_time>$3::time AND shop_id=$4`,
      [appointment_date, endTime, appointment_time, shopId]
    );
    if (conflict.rows.length) return res.status(409).json({ error: 'That time slot is no longer available. Please pick another.' });

    const result = await pool.query(
      `INSERT INTO appointments
        (shop_id, service_id, customer_name, customer_phone, customer_email,
         appointment_date, appointment_time, end_time, payment_intent_id, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [shopId, service_id, nameClean, phoneClean||null, emailClean||null,
       appointment_date, appointment_time, endTime,
       req.body.payment_intent_id||null, req.session.userId||null]
    );

    const bookingId = result.rows[0].id;
    res.json({ success: true, booking_id: bookingId });

    if (emailClean) {
      sendBookingConfirmation({ to:emailClean, name:nameClean, service:serviceName,
        date:appointment_date, time:appointment_time, confirmationId:bookingId });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
