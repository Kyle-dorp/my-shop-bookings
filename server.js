require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const { initDB, pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Never cache HTML — always serve fresh so CSS/JS version busting works
app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if (!ext || ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

app.use('/api', require('./routes/api'));
app.use('/api/admin', require('./routes/admin-api'));
app.use('/api/auth', require('./routes/user-auth'));

// ── Google OAuth ──────────────────────────────────────────────────────
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect('/?auth_error=1');
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${baseUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.redirect('/?auth_error=1');
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?auth_error=1');
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, grant_type: 'authorization_code',
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${baseUrl}/auth/google/callback`,
      }).toString(),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access token');

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const { sub: googleId, name, email } = profile;
    if (!googleId) throw new Error('No Google ID');

    const { pool } = require('./db');
    const existing = await pool.query(
      'SELECT id FROM users WHERE google_id=$1 OR (email=$2 AND email IS NOT NULL)',
      [googleId, email]
    );
    let userId;
    if (existing.rows.length) {
      await pool.query('UPDATE users SET google_id=$1 WHERE id=$2', [googleId, existing.rows[0].id]);
      userId = existing.rows[0].id;
    } else {
      const r = await pool.query(
        'INSERT INTO users (name, email, google_id) VALUES ($1,$2,$3) RETURNING id',
        [name, email, googleId]
      );
      userId = r.rows[0].id;
    }
    req.session.userId = userId;
    res.redirect('/');
  } catch (err) {
    console.error('Google OAuth error:', err);
    res.redirect('/?auth_error=1');
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ error: 'Not found' });
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

async function start() {
  await initDB();
  app.listen(PORT, () => console.log(`Running on port ${PORT}`));
}

start().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});
