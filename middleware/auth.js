function requireAdmin(req, res, next) {
  if (req.session?.shopId) {
    req.shopId  = req.session.shopId;
    req.adminId = req.session.adminId;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireSubscription(req, res, next) {
  const status = req.session?.subscriptionStatus || 'active';
  if (['active', 'trialing'].includes(status)) return next();
  return res.status(402).json({ error: 'Subscription required', subscriptionStatus: status });
}

module.exports = { requireAdmin, requireSubscription };
