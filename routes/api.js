const express = require('express');
const router = express.Router();
const { pool } = require('../db');

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// GET /api/settings (public)
router.get('/settings', async (req, res) => {
  try {
    const r = await pool.query("SELECT value FROM settings WHERE key='max_booking_days'");
    res.json({ max_booking_days: r.rows.length ? parseInt(r.rows[0].value) : 60 });
  } catch { res.json({ max_booking_days: 60 }); }
});

// GET /api/services
router.get('/services', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, duration_minutes, price FROM services WHERE active = true ORDER BY display_order, name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/slots?date=YYYY-MM-DD&service_id=1
router.get('/slots', async (req, res) => {
  const { date, service_id } = req.query;
  if (!date || !service_id) return res.status(400).json({ error: 'Missing date or service_id' });

  try {
    const svcResult = await pool.query(
      'SELECT duration_minutes FROM services WHERE id = $1 AND active = true',
      [service_id]
    );
    if (!svcResult.rows.length) return res.status(404).json({ error: 'Service not found' });
    const duration = svcResult.rows[0].duration_minutes;

    // Parse date safely (avoid timezone shift)
    const [year, month, day] = date.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, day).getDay();

    const hoursResult = await pool.query(
      'SELECT open_time, close_time, is_closed FROM business_hours WHERE day_of_week = $1',
      [dayOfWeek]
    );
    if (!hoursResult.rows.length || hoursResult.rows[0].is_closed) {
      return res.json({ slots: [], closed: true });
    }

    const { open_time, close_time } = hoursResult.rows[0];
    const openMins = timeToMinutes(open_time);
    const closeMins = timeToMinutes(close_time);

    const apptResult = await pool.query(
      `SELECT appointment_time, end_time FROM appointments
       WHERE appointment_date = $1 AND status != 'cancelled'`,
      [date]
    );

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const nowMins = now.getHours() * 60 + now.getMinutes() + 30; // 30-min booking buffer

    const slots = [];
    for (let t = openMins; t + duration <= closeMins; t += 30) {
      if (date === todayStr && t < nowMins) continue;

      const slotEnd = t + duration;
      let available = true;

      for (const appt of apptResult.rows) {
        const aStart = timeToMinutes(appt.appointment_time);
        const aEnd = timeToMinutes(appt.end_time);
        if (t < aEnd && slotEnd > aStart) {
          available = false;
          break;
        }
      }

      if (available) slots.push(minutesToTime(t));
    }

    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/bookings
router.post('/bookings', async (req, res) => {
  const { service_id, customer_name, customer_phone, customer_email, appointment_date, appointment_time } = req.body;

  if (!service_id || !customer_name || !appointment_date || !appointment_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const nameClean = customer_name.trim();
  const phoneClean = (customer_phone || '').trim();
  if (!nameClean || !phoneClean) return res.status(400).json({ error: 'Name and phone are required' });

  try {
    const svcResult = await pool.query(
      'SELECT duration_minutes FROM services WHERE id = $1 AND active = true',
      [service_id]
    );
    if (!svcResult.rows.length) return res.status(404).json({ error: 'Service not found' });
    const duration = svcResult.rows[0].duration_minutes;

    const startMins = timeToMinutes(appointment_time);
    const endTime = minutesToTime(startMins + duration);

    // Conflict check
    const conflict = await pool.query(
      `SELECT id FROM appointments
       WHERE appointment_date = $1
         AND status != 'cancelled'
         AND appointment_time < $2::time
         AND end_time > $3::time`,
      [appointment_date, endTime, appointment_time]
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({ error: 'That time slot is no longer available. Please pick another.' });
    }

    const result = await pool.query(
      `INSERT INTO appointments
        (service_id, customer_name, customer_phone, customer_email, appointment_date, appointment_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [service_id, nameClean, phoneClean || null, customer_email || null, appointment_date, appointment_time, endTime]
    );

    res.json({ success: true, booking_id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
