require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/haircut_scheduler',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    // ── Core tables ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(100) DEFAULT 'Admin',
        email VARCHAR(100),
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed legacy password-only admin (existing single-shop installs)
    const adminCheck = await client.query('SELECT id FROM admin_users LIMIT 1');
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await client.query('INSERT INTO admin_users (password_hash) VALUES ($1)', [hash]);
      console.log('Default admin created — password: admin123 — CHANGE THIS from the admin panel!');
    }

    // Partial unique index: allow multiple NULLs, enforce uniqueness for non-null emails
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS admin_users_email_unique
      ON admin_users (email) WHERE email IS NOT NULL
    `);

    // ── Shops (multi-tenancy) ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id SERIAL PRIMARY KEY,
        owner_id INTEGER REFERENCES admin_users(id),
        name VARCHAR(255) NOT NULL DEFAULT 'My Barbershop',
        slug VARCHAR(100) UNIQUE NOT NULL,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        subscription_status VARCHAR(50) DEFAULT 'inactive',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed default shop from first admin (for existing installs)
    await client.query(`
      INSERT INTO shops (owner_id, name, slug, subscription_status)
      SELECT id, 'Haircut''s R Us', 'haircutsrus', 'active'
      FROM admin_users WHERE NOT EXISTS (SELECT 1 FROM shops)
      ORDER BY id LIMIT 1
    `);

    // ── Data tables (with shop_id from the start for fresh installs) ──────
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER REFERENCES shops(id),
        name VARCHAR(100) NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 15 AND duration_minutes <= 120),
        price DECIMAL(10,2),
        active BOOLEAN DEFAULT true,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS business_hours (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER REFERENCES shops(id),
        day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
        open_time TIME DEFAULT '09:00',
        close_time TIME DEFAULT '18:00',
        is_closed BOOLEAN DEFAULT false
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        shop_id INTEGER,
        service_id INTEGER REFERENCES services(id),
        customer_name VARCHAR(100) NOT NULL,
        customer_phone VARCHAR(20),
        customer_email VARCHAR(100),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        end_time TIME NOT NULL,
        status VARCHAR(20) DEFAULT 'confirmed',
        payment_intent_id VARCHAR(100),
        user_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        shop_id INTEGER NOT NULL,
        key VARCHAR(50) NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (shop_id, key)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        phone VARCHAR(20),
        password_hash VARCHAR(255),
        google_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add stripe_connect_account_id to shops for Stripe Connect (per-shop payouts)
    await client.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT`);

    // Add custom_domain to shops for white-label booking URLs
    await client.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS custom_domain TEXT`);
    await client.query(`
      DO $$ BEGIN
        BEGIN CREATE UNIQUE INDEX shops_custom_domain_unique ON shops (custom_domain) WHERE custom_domain IS NOT NULL;
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END $$
    `);

    // ── Idempotent migrations for existing installs ───────────────────────
    await client.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT 'Admin'`);
    await client.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS email VARCHAR(100)`);
    await client.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`);
    await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_intent_id VARCHAR(100)`);
    await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS user_id INTEGER`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(100)`);
    await client.query(`
      DO $$ BEGIN
        BEGIN ALTER TABLE users ADD CONSTRAINT users_google_id_key UNIQUE (google_id);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END $$
    `);

    // Add shop_id to existing data tables
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS shop_id INTEGER`);
    await client.query(`ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS shop_id INTEGER`);
    await client.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS shop_id INTEGER`);
    await client.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS shop_id INTEGER`);

    // Migrate existing rows to default shop (id=1)
    await client.query(`UPDATE services      SET shop_id = 1 WHERE shop_id IS NULL`);
    await client.query(`UPDATE business_hours SET shop_id = 1 WHERE shop_id IS NULL`);
    await client.query(`UPDATE appointments   SET shop_id = 1 WHERE shop_id IS NULL`);
    await client.query(`UPDATE settings       SET shop_id = 1 WHERE shop_id IS NULL`);

    // Change settings PK: (key) → (shop_id, key)
    await client.query(`
      DO $$ BEGIN
        BEGIN ALTER TABLE settings DROP CONSTRAINT settings_pkey;
        EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE settings ADD PRIMARY KEY (shop_id, key);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END $$
    `);

    // Change business_hours UNIQUE: day_of_week → (shop_id, day_of_week)
    await client.query(`
      DO $$ BEGIN
        BEGIN ALTER TABLE business_hours DROP CONSTRAINT business_hours_day_of_week_key;
        EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN ALTER TABLE business_hours ADD CONSTRAINT bh_shop_day_unique UNIQUE (shop_id, day_of_week);
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END $$
    `);

    // ── Seed default data for shop 1 ──────────────────────────────────────
    const hoursCheck = await client.query('SELECT id FROM business_hours WHERE shop_id = 1 LIMIT 1');
    if (hoursCheck.rows.length === 0) {
      const days = [
        { d: 0, o: '10:00', c: '16:00', closed: true  },
        { d: 1, o: '09:00', c: '18:00', closed: false },
        { d: 2, o: '09:00', c: '18:00', closed: false },
        { d: 3, o: '09:00', c: '18:00', closed: false },
        { d: 4, o: '09:00', c: '18:00', closed: false },
        { d: 5, o: '09:00', c: '18:00', closed: false },
        { d: 6, o: '09:00', c: '16:00', closed: false },
      ];
      for (const h of days) {
        await client.query(
          'INSERT INTO business_hours (shop_id, day_of_week, open_time, close_time, is_closed) VALUES ($1,$2,$3,$4,$5)',
          [1, h.d, h.o, h.c, h.closed]
        );
      }
    }

    const settingDefaults = [
      ['max_booking_days','60'], ['payment_mode','in_person'], ['deposit_required','false'],
      ['deposit_amount','10'],   ['require_login','true'],     ['allow_guest','true'],
    ];
    for (const [key, value] of settingDefaults) {
      await client.query(
        `INSERT INTO settings (shop_id, key, value) VALUES (1,$1,$2) ON CONFLICT (shop_id, key) DO NOTHING`,
        [key, value]
      );
    }

    // One-time: flip require_login default to true for older installs
    await client.query(`UPDATE settings SET value='true' WHERE shop_id=1 AND key='require_login' AND value='false'`);

    const svcCheck = await client.query('SELECT id FROM services WHERE shop_id = 1 LIMIT 1');
    if (svcCheck.rows.length === 0) {
      const services = [
        { name: 'Fade',         duration: 30, price: 25.00, order: 1 },
        { name: 'Lineup',       duration: 30, price: 25.00, order: 2 },
        { name: 'Trim',         duration: 30, price: 25.00, order: 3 },
        { name: 'Custom Style', duration: 60, price: 45.00, order: 4 },
      ];
      for (const s of services) {
        await client.query(
          'INSERT INTO services (shop_id, name, duration_minutes, price, display_order) VALUES (1,$1,$2,$3,$4)',
          [s.name, s.duration, s.price, s.order]
        );
      }
    }

    console.log('Database ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
