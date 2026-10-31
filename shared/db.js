// Satu database SQLite bersama untuk gateway, Service Nilai, dan Service Transkrip
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cfg = require('./config');

function openDb({ buatJikaBelumAda = false } = {}) {
  if (!buatJikaBelumAda && !fs.existsSync(cfg.dbPath)) {
    throw new Error(`Database belum ada di ${cfg.dbPath}. Jalankan: npm run seed`);
  }
  fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
  const db = new Database(cfg.dbPath);
  db.pragma('journal_mode = WAL');   // aman dibuka oleh beberapa proses sekaligus
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { openDb };
