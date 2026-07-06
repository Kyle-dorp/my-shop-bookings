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

// GET /api/billing/connect — start Stripe Connect OAuth
router.get('/connect', requireAdmin, (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  if (!process.env.STRIPE_CONNECT_CLIENT_ID) {
    return res.status(503).json({ error: 'Set STRIPE_CONNECT_CLIENT_ID in Railway env vars.' });
  }
  const state  = Buffer.from(String(req.shopId)).toString('base64');
  const base   = `${req.protocol}://${req.get('host')}`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id:    process.env.STRIPE_CONNECT_CLIENT_ID,
    scope:        'read_write',
    state,
    redirect_uri: `${base}/api/billing/connect/callback`,
  });
  res.redirect(`https://connect.stripe.com/oauth/authorize?${params}`);
});

// GET /api/billing/connect/callback — Stripe OAuth redirect
router.get('/connect/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/admin?connect_error=1');
  let shopId;
  try {
    shopId = parseInt(Buffer.from(state, 'base64').toString(), 10);
    if (!shopId) throw new Error('invalid state');
  } catch { return res.redirect('/admin?connect_error=1'); }
  try {
    const response = await stripe.oauth.token({ grant_type: 'authorization_code', code });
    await pool.query('UPDATE shops SET stripe_connect_account_id=$1 WHERE id=$2', [response.stripe_user_id, shopId]);
    res.redirect('/admin?connected=1');
  } catch (err) {
    console.error('Stripe Connect callback error:', err);
    res.redirect('/admin?connect_error=1');
  }
});

// POST /api/billing/disconnect — deauthorize Stripe Connect account
router.post('/disconnect', requireAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });
  try {
    const { rows } = await pool.query('SELECT stripe_connect_account_id FROM shops WHERE id=$1', [req.shopId]);
    const acct = rows[0]?.stripe_connect_account_id;
    if (acct && process.env.STRIPE_CONNECT_CLIENT_ID) {
      await stripe.oauth.deauthorize({ client_id: process.env.STRIPE_CONNECT_CLIENT_ID, stripe_user_id: acct });
    }
    await pool.query('UPDATE shops SET stripe_connect_account_id=NULL WHERE id=$1', [req.shopId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
