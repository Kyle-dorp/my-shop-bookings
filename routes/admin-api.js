const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const { pool } = require('../db');
const { requireAdmin, requireSubscription } = require('../middleware/auth');

const RESERVED = new Set(['admin','api','auth','css','js','billing','default','static','public','book','shop','login','register']);

// ── Public routes (no auth required) ─────────────────────────────────────

// POST /api/admin/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });
  try {
    if (email) {
      const r = await pool.query(
        `SELECT a.id, a.password_hash, s.id AS shop_id, s.subscription_status
         FROM admin_users a JOIN shops s ON s.owner_id = a.id
         WHERE a.email = $1`,
        [email.toLowerCase().trim()]
      );
      if (!r.rows.length) return res.status(401).json({ error: 'Invalid email or password' });
      const ok = await bcrypt.compare(password, r.rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      req.session.adminId            = r.rows[0].id;
      req.session.shopId             = r.rows[0].shop_id;
      req.session.subscriptionStatus = r.rows[0].subscription_status;
      res.json({ success: true, subscriptionStatus: r.rows[0].subscription_status });
    } else {
      // Legacy password-only login for the original single-admin setup
      const r = await pool.query(
        'SELECT id, password_hash FROM admin_users WHERE email IS NULL ORDER BY id LIMIT 1'
      );
      if (!r.rows.length) return res.status(401).json({ error: 'No password-only admin found' });
      const ok = await bcrypt.compare(password, r.rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: 'Incorrect password' });
      req.session.adminId            = r.rows[0].id;
      req.session.shopId             = 1;
      req.session.subscriptionStatus = 'active';
      res.json({ success: true, subscriptionStatus: 'active' });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// POST /api/admin/register
router.post('/register', async (req, res) => {
  const { email, password, shopName, slug } = req.body;
  if (!email || !password || !shopName || !slug) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!slugClean || slugClean.length < 2) return res.status(400).json({ error: 'URL must be at least 2 characters (letters, numbers, hyphens only)' });
  if (RESERVED.has(slugClean)) return res.status(400).json({ error: 'That URL is reserved. Please choose another.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingEmail = await client.query('SELECT id FROM admin_users WHERE email=$1', [email.toLowerCase().trim()]);
    if (existingEmail.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Email already in use' }); }
    const existingSlug = await client.query('SELECT id FROM shops WHERE slug=$1', [slugClean]);
    if (existingSlug.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'That booking URL is taken. Please choose another.' }); }

    const hash   = await bcrypt.hash(password, 10);
    const adminR = await client.query(
      'INSERT INTO admin_users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id',
      [email.toLowerCase().trim(), hash, shopName.trim()]
    );
    const adminId = adminR.rows[0].id;
    const shopR   = await client.query(
      'INSERT INTO shops (owner_id, name, slug, subscription_status) VALUES ($1,$2,$3,$4) RETURNING id',
      [adminId, shopName.trim(), slugClean, 'inactive']
    );
    const shopId = shopR.rows[0].id;

    // Seed default hours
    const hrs = [
      [0,'10:00','16:00',true],[1,'09:00','18:00',false],[2,'09:00','18:00',false],
      [3,'09:00','18:00',false],[4,'09:00','18:00',false],[5,'09:00','18:00',false],[6,'09:00','16:00',false],
    ];
    for (const [d,o,c,closed] of hrs) {
      await client.query(
        'INSERT INTO business_hours (shop_id, day_of_week, open_time, close_time, is_closed) VALUES ($1,$2,$3,$4,$5)',
        [shopId, d, o, c, closed]
      );
    }
    // Seed default settings
    const defs = [['max_booking_days','60'],['payment_mode','in_person'],['deposit_required','false'],['deposit_amount','10'],['require_login','false'],['allow_guest','true']];
    for (const [k,v] of defs) {
      await client.query('INSERT INTO settings (shop_id, key, value) VALUES ($1,$2,$3)', [shopId, k, v]);
    }
    await client.query('COMMIT');

    req.session.adminId            = adminId;
    req.session.shopId             = shopId;
    req.session.subscriptionStatus = 'inactive';
    res.json({ success: true, shopId, slug: slugClean });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Registration error:', err);
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// GET /api/admin/check-auth
router.get('/check-auth', async (req, res) => {
  if (!req.session?.shopId) return res.json({ authenticated: false });
  try {
    const { rows } = await pool.query(
      'SELECT subscription_status, name, slug FROM shops WHERE id=$1',
      [req.session.shopId]
    );
    const status = rows[0]?.subscription_status || 'active';
    req.session.subscriptionStatus = status;
    res.json({
      authenticated:    true,
      subscriptionActive: ['active','trialing'].includes(status),
      subscriptionStatus: status,
      shopName: rows[0]?.name,
      shopSlug: rows[0]?.slug,
    });
  } catch {
    res.json({ authenticated: true, subscriptionActive: true, subscriptionStatus: 'active' });
  }
});

// ── Auth-required, no subscription check ─────────────────────────────────

router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ── Auth + active subscription required ──────────────────────────────────
router.use(requireAdmin, requireSubscription);

// --- Services ---
router.get('/services', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, name, duration_minutes, price, active, display_order FROM services WHERE shop_id=$1 ORDER BY display_order, name',
      [req.shopId]
    );
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/services', async (req, res) => {
  const { name, duration_minutes, price } = req.body;
  if (!name || !duration_minutes) return res.status(400).json({ error: 'Name and duration are required' });
  const dur = parseInt(duration_minutes);
  if (isNaN(dur) || dur < 15 || dur > 120 || dur % 15 !== 0) return res.status(400).json({ error: 'Duration must be 15–120 min in 15-min increments' });
  try {
    const r = await pool.query(
      'INSERT INTO services (shop_id, name, duration_minutes, price) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.shopId, name.trim(), dur, price ? parseFloat(price) : null]
    );
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/services/:id', async (req, res) => {
  const { name, duration_minutes, price, active, display_order } = req.body;
  const dur = parseInt(duration_minutes);
  if (!name || isNaN(dur) || dur < 15 || dur > 120 || dur % 15 !== 0) return res.status(400).json({ error: 'Invalid service data' });
  try {
    const r = await pool.query(
      `UPDATE services SET name=$1, duration_minutes=$2, price=$3, active=$4, display_order=$5
       WHERE id=$6 AND shop_id=$7 RETURNING *`,
      [name.trim(), dur, price ? parseFloat(price) : null, !!active, parseInt(display_order)||0, req.params.id, req.shopId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/services/:id', async (req, res) => {
  try {
    await pool.query('UPDATE services SET active=false WHERE id=$1 AND shop_id=$2', [req.params.id, req.shopId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// --- Appointments ---
router.get('/appointments', async (req, res) => {
  const { date } = req.query;
  try {
    let q = `
      SELECT a.id, a.customer_name, a.customer_phone, a.customer_email,
             a.appointment_date, a.appointment_time, a.end_time, a.status,
             s.name AS service_name, s.duration_minutes, a.created_at
      FROM appointments a LEFT JOIN services s ON a.service_id = s.id
      WHERE a.shop_id = $1
    `;
    const params = [req.shopId];
    if (date) { params.push(date); q += ` AND a.appointment_date = $${params.length}`; }
    else       { q += ` AND a.appointment_date >= CURRENT_DATE`; }
    q += ' ORDER BY a.appointment_date, a.appointment_time';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/appointments/:id/cancel', async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE appointments SET status='cancelled' WHERE id=$1 AND shop_id=$2 RETURNING *",
      [req.params.id, req.shopId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/appointments/:id/complete', async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE appointments SET status='completed' WHERE id=$1 AND shop_id=$2 RETURNING *",
      [req.params.id, req.shopId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// --- Business Hours ---
router.get('/hours', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM business_hours WHERE shop_id=$1 ORDER BY day_of_week', [req.shopId]);
    res.json(r.rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/hours', async (req, res) => {
  const { hours } = req.body;
  if (!Array.isArray(hours) || hours.length !== 7) return res.status(400).json({ error: 'Must provide all 7 days' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const d of hours) {
      await client.query(
        `UPDATE business_hours SET open_time=$1, close_time=$2, is_closed=$3
         WHERE day_of_week=$4 AND shop_id=$5`,
        [d.open_time, d.close_time, !!d.is_closed, d.day_of_week, req.shopId]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch { await client.query('ROLLBACK'); res.status(500).json({ error: 'Server error' }); }
  finally { client.release(); }
});

// --- Settings ---
router.get('/settings', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM settings WHERE shop_id=$1', [req.shopId]);
    const s = {};
    r.rows.forEach(row => s[row.key] = row.value);
    const sk = process.env.STRIPE_SECRET_KEY || '';
    const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
    s.stripe_configured = !!(sk && pk);
    s.stripe_test_mode  = sk.startsWith('sk_test_') || pk.startsWith('pk_test_');
    res.json(s);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/settings', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upsert = (key, val) => client.query(
      `INSERT INTO settings (shop_id, key, value) VALUES ($1,$2,$3) ON CONFLICT (shop_id, key) DO UPDATE SET value=$3`,
      [req.shopId, key, String(val)]
    );
    if (req.body.max_booking_days !== undefined) {
      const days = parseInt(req.body.max_booking_days);
      if (isNaN(days) || days < 1 || days > 365) throw new Error('Days must be 1–365');
      await upsert('max_booking_days', days);
    }
    if (req.body.payment_mode !== undefined) {
      const mode = req.body.payment_mode;
      if (!['in_person','deposit','full'].includes(mode)) throw new Error('Invalid payment mode');
      await upsert('payment_mode', mode);
      await upsert('deposit_required', mode === 'deposit' ? 'true' : 'false');
    }
    if (req.body.deposit_amount !== undefined) {
      const amt = parseFloat(req.body.deposit_amount);
      if (isNaN(amt) || amt < 0) throw new Error('Invalid deposit amount');
      await upsert('deposit_amount', amt.toFixed(2));
    }
    if (req.body.require_login !== undefined) await upsert('require_login', req.body.require_login ? 'true' : 'false');
    if (req.body.allow_guest   !== undefined) await upsert('allow_guest',   req.body.allow_guest   ? 'true' : 'false');
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// --- Profile ---
router.get('/profile', async (req, res) => {
  try {
    const r = await pool.query('SELECT name, email, phone FROM admin_users WHERE id=$1', [req.adminId]);
    res.json(r.rows[0] || { name: 'Admin', email: '', phone: '' });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.put('/profile', async (req, res) => {
  const { name, email, phone } = req.body;
  try {
    await pool.query(
      'UPDATE admin_users SET name=$1, email=$2, phone=$3 WHERE id=$4',
      [name?.trim() || 'Admin', email || null, phone || null, req.adminId]
    );
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// --- Password ---
router.put('/password', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const r  = await pool.query('SELECT password_hash FROM admin_users WHERE id=$1', [req.adminId]);
    const ok = await bcrypt.compare(current_password, r.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2', [hash, req.adminId]);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
