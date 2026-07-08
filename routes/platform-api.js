const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

function requirePlatform(req, res, next) {
  if (!req.session?.platformAdmin) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.post('/login', (req, res) => {
  const pw = process.env.PLATFORM_PASSWORD;
  if (!pw) return res.status(503).json({ error: 'PLATFORM_PASSWORD not set in Railway env vars' });
  if (req.body.password !== pw) return res.status(401).json({ error: 'Incorrect password' });
  req.session.platformAdmin = true;
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  req.session.platformAdmin = false;
  res.json({ success: true });
});

router.get('/auth', (req, res) => {
  res.json({ authenticated: !!req.session?.platformAdmin });
});

router.get('/stats', requirePlatform, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        COUNT(*)                                                     AS total_shops,
        COUNT(*) FILTER (WHERE subscription_status = 'active')      AS active_shops,
        COUNT(*) FILTER (WHERE subscription_status = 'trialing')    AS trialing_shops,
        COUNT(*) FILTER (WHERE subscription_status = 'inactive')    AS inactive_shops,
        COUNT(*) FILTER (WHERE subscription_status = 'cancelled')   AS cancelled_shops
      FROM shops
    `);
    const s = r.rows[0];
    res.json({
      ...s,
      mrr: (parseInt(s.active_shops) * 15),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/shops', requirePlatform, async (req, res) => {
  try {
    const [shopsR, countsR] = await Promise.all([
      pool.query(`
        SELECT s.id, s.name, s.slug, s.subscription_status,
               s.custom_domain, s.stripe_customer_id,
               s.stripe_connect_account_id, s.created_at,
               a.email  AS owner_email,
               a.name   AS owner_name,
               a.phone  AS owner_phone
        FROM shops s
        LEFT JOIN admin_users a ON a.id = s.owner_id
        ORDER BY s.created_at DESC
      `),
      pool.query(`
        SELECT shop_id,
               COUNT(*) AS total_appts,
               COUNT(*) FILTER (WHERE appointment_date >= CURRENT_DATE AND status = 'confirmed') AS upcoming
        FROM appointments
        GROUP BY shop_id
      `),
    ]);

    const countMap = {};
    countsR.rows.forEach(r => { countMap[r.shop_id] = r; });

    res.json(shopsR.rows.map(s => ({
      ...s,
      total_appts: parseInt(countMap[s.id]?.total_appts || 0),
      upcoming_appts: parseInt(countMap[s.id]?.upcoming || 0),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/shops/:id/status', requirePlatform, async (req, res) => {
  const { status } = req.body;
  if (!['active','inactive','cancelled','trialing'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const r = await pool.query(
      'UPDATE shops SET subscription_status=$1 WHERE id=$2 RETURNING id, name, subscription_status',
      [status, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Shop not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
