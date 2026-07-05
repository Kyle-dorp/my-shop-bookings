const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

// POST /api/billing/create-checkout
router.post('/create-checkout', requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing not configured — set STRIPE_SECRET_KEY.' });
  if (!process.env.STRIPE_MONTHLY_PRICE_ID) {
    return res.status(503).json({ error: 'Set STRIPE_MONTHLY_PRICE_ID in Railway env vars.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.stripe_customer_id, a.email
       FROM shops s LEFT JOIN admin_users a ON a.id = s.owner_id
       WHERE s.id = $1`,
      [req.shopId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Shop not found' });
    const shop = rows[0];

    let customerId = shop.stripe_customer_id;
    if (!customerId) {
      const cust = await stripe.customers.create({
        email: shop.email || undefined,
        name:  shop.name,
        metadata: { shop_id: String(shop.id) },
      });
      customerId = cust.id;
      await pool.query('UPDATE shops SET stripe_customer_id=$1 WHERE id=$2', [customerId, shop.id]);
    }

    const base    = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: process.env.STRIPE_MONTHLY_PRICE_ID, quantity: 1 }],
      success_url: `${base}/admin?subscribed=1`,
      cancel_url:  `${base}/admin`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/portal  — opens Stripe customer portal
router.get('/portal', requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Billing not configured' });
  try {
    const { rows } = await pool.query('SELECT stripe_customer_id FROM shops WHERE id=$1', [req.shopId]);
    if (!rows[0]?.stripe_customer_id) return res.status(404).json({ error: 'No billing account found' });
    const base   = `${req.protocol}://${req.get('host')}`;
    const portal = await stripe.billingPortal.sessions.create({
      customer:   rows[0].stripe_customer_id,
      return_url: `${base}/admin`,
    });
    res.json({ url: portal.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
