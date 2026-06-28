const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');

// POST /api/admin/login
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  try {
    const result = await pool.query('SELECT password_hash FROM admin_users LIMIT 1');
    if (!result.rows.length) return res.status(500).json({ error: 'No admin configured' });

    const match = await bcrypt.compare(password, result.rows[0].password_hash);
    if (match) {
      req.session.isAdmin = true;
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Incorrect password' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/admin/check-auth
router.get('/check-auth', (req, res) => {
  res.json({ authenticated: !!req.session.isAdmin });
});

// ---- Protected routes below ----
router.use(requireAdmin);

// --- Services ---
router.get('/services', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, duration_minutes, price, active, display_order FROM services ORDER BY display_order, name'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/services', async (req, res) => {
  const { name, duration_minutes, price } = req.body;
  if (!name || !duration_minutes) return res.status(400).json({ error: 'Name and duration are required' });

  const dur = parseInt(duration_minutes);
  if (isNaN(dur) || dur < 15 || dur > 120 || dur % 15 !== 0) {
    return res.status(400).json({ error: 'Duration must be 15–120 min in 15-min increments' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO services (name, duration_minutes, price) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), dur, price ? parseFloat(price) : null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/services/:id', async (req, res) => {
  const { name, duration_minutes, price, active, display_order } = req.body;
  const dur = parseInt(duration_minutes);
  if (!name || isNaN(dur) || dur < 15 || dur > 120 || dur % 15 !== 0) {
    return res.status(400).json({ error: 'Invalid service data' });
  }

  try {
    const result = await pool.query(
      `UPDATE services SET name=$1, duration_minutes=$2, price=$3, active=$4, display_order=$5
       WHERE id=$6 RETURNING *`,
      [name.trim(), dur, price ? parseFloat(price) : null, !!active, parseInt(display_order) || 0, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/services/:id', async (req, res) => {
  try {
    await pool.query('UPDATE services SET active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Appointments ---
router.get('/appointments', async (req, res) => {
  const { date, upcoming } = req.query;

  try {
    let query = `
      SELECT a.id, a.customer_name, a.customer_phone, a.customer_email,
             a.appointment_date, a.appointment_time, a.end_time, a.status,
             s.name AS service_name, s.duration_minutes, a.created_at
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      params.push(date);
      query += ` AND a.appointment_date = $${params.length}`;
    } else if (upcoming !== 'false') {
      query += ` AND a.appointment_date >= CURRENT_DATE`;
    }

    query += ' ORDER BY a.appointment_date, a.appointment_time';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/appointments/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE appointments SET status='cancelled' WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/appointments/:id/complete', async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE appointments SET status='completed' WHERE id=$1 RETURNING *",
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- Business Hours ---
router.get('/hours', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM business_hours ORDER BY day_of_week');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/hours', async (req, res) => {
  const { hours } = req.body;
  if (!Array.isArray(hours) || hours.length !== 7) {
    return res.status(400).json({ error: 'Must provide all 7 days' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const d of hours) {
      await client.query(
        `UPDATE business_hours SET open_time=$1, close_time=$2, is_closed=$3 WHERE day_of_week=$4`,
        [d.open_time, d.close_time, !!d.is_closed, d.day_of_week]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// --- Settings ---
router.get('/settings', async (req, res) => {
  try {
    const r = await pool.query('SELECT key, value FROM settings');
    const s = {};
    r.rows.forEach(row => s[row.key] = row.value);
    res.json(s);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/settings', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upsert = async (key, val) => client.query(
      `INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2`,
      [key, String(val)]
    );
    if (req.body.max_booking_days !== undefined) {
      const days = parseInt(req.body.max_booking_days);
      if (isNaN(days) || days < 1 || days > 365) throw new Error('Days must be 1–365');
      await upsert('max_booking_days', days);
    }
    if (req.body.deposit_required !== undefined) {
      await upsert('deposit_required', req.body.deposit_required ? 'true' : 'false');
    }
    if (req.body.deposit_amount !== undefined) {
      const amt = parseFloat(req.body.deposit_amount);
      if (isNaN(amt) || amt < 0) throw new Error('Invalid deposit amount');
      await upsert('deposit_amount', amt.toFixed(2));
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// --- Change Password ---
router.put('/password', async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM admin_users LIMIT 1');
    const match = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE admin_users SET password_hash = $1', [hash]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
