require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost/haircut_scheduler',
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
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
        day_of_week INTEGER UNIQUE NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
        open_time TIME DEFAULT '09:00',
        close_time TIME DEFAULT '18:00',
        is_closed BOOLEAN DEFAULT false
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        service_id INTEGER REFERENCES services(id),
        customer_name VARCHAR(100) NOT NULL,
        customer_phone VARCHAR(20),
        customer_email VARCHAR(100),
        appointment_date DATE NOT NULL,
        appointment_time TIME NOT NULL,
        end_time TIME NOT NULL,
        status VARCHAR(20) DEFAULT 'confirmed',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    const adminCheck = await client.query('SELECT id FROM admin_users LIMIT 1');
    if (adminCheck.rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await client.query('INSERT INTO admin_users (password_hash) VALUES ($1)', [hash]);
      console.log('Default admin created — password: admin123 — CHANGE THIS from the admin panel!');
    }

    const hoursCheck = await client.query('SELECT id FROM business_hours LIMIT 1');
    if (hoursCheck.rows.length === 0) {
      const days = [
        { day: 0, open: '10:00', close: '16:00', closed: true },
        { day: 1, open: '09:00', close: '18:00', closed: false },
        { day: 2, open: '09:00', close: '18:00', closed: false },
        { day: 3, open: '09:00', close: '18:00', closed: false },
        { day: 4, open: '09:00', close: '18:00', closed: false },
        { day: 5, open: '09:00', close: '18:00', closed: false },
        { day: 6, open: '09:00', close: '16:00', closed: false },
      ];
      for (const d of days) {
        await client.query(
          'INSERT INTO business_hours (day_of_week, open_time, close_time, is_closed) VALUES ($1, $2, $3, $4)',
          [d.day, d.open, d.close, d.closed]
        );
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    const defaults = { max_booking_days: '60', deposit_required: 'false', deposit_amount: '10' };
    for (const [key, value] of Object.entries(defaults)) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    // Migration: add payment_intent_id to appointments if missing
    await client.query(`
      ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_intent_id VARCHAR(100)
    `);

    const svcCheck = await client.query('SELECT id FROM services LIMIT 1');
    if (svcCheck.rows.length === 0) {
      const services = [
        { name: 'Fade',          duration: 30, price: 25.00, order: 1 },
        { name: 'Lineup',        duration: 30, price: 25.00, order: 2 },
        { name: 'Trim',          duration: 30, price: 25.00, order: 3 },
        { name: 'Custom Style',  duration: 60, price: 45.00, order: 4 },
      ];
      for (const s of services) {
        await client.query(
          'INSERT INTO services (name, duration_minutes, price, display_order) VALUES ($1, $2, $3, $4)',
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
