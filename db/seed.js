// Membuat ulang skema + data awal. Jalankan: npm run seed  (juga untuk RESET data demo)
const fs = require('fs');
const bcrypt = require('bcryptjs');
const cfg = require('../shared/config');
const { openDb } = require('../shared/db');

for (const f of [cfg.dbPath, cfg.dbPath + '-wal', cfg.dbPath + '-shm']) {
  if (fs.existsSync(f)) fs.rmSync(f);
}
const db = openDb({ buatJikaBelumAda: true });

db.exec(`
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nama          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('mahasiswa','dosen','admin')),
  nim           TEXT UNIQUE            -- hanya untuk mahasiswa
);
CREATE TABLE devices (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL,
  UNIQUE (user_id, device_id)
);
CREATE TABLE kelas (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_mk  TEXT NOT NULL,
  nama_mk  TEXT NOT NULL,
  dosen_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE nilai (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kelas_id INTEGER NOT NULL REFERENCES kelas(id),
  nim      TEXT NOT NULL REFERENCES users(nim),
  nilai    REAL,                         -- 0..100, NULL = belum diisi
  final    INTEGER NOT NULL DEFAULT 0,   -- 1 = sudah difinalisasi
  UNIQUE (kelas_id, nim)
);
CREATE TABLE transkrip (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nim        TEXT NOT NULL REFERENCES users(nim),
  kelas_id   INTEGER NOT NULL,
  kode_mk    TEXT NOT NULL,
  nama_mk    TEXT NOT NULL,
  nilai      REAL NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (nim, kelas_id)
);
CREATE TABLE refresh_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,       -- SHA-256 dari token (token asli tidak disimpan)
  expires_at TEXT NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  waktu       TEXT NOT NULL,
  subjek      TEXT NOT NULL,
  role        TEXT,
  method      TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  device      TEXT,
  hasil       TEXT NOT NULL CHECK (hasil IN ('allow','deny')),
  alasan      TEXT NOT NULL,
  status_code INTEGER
);
`);

const hash = (p) => bcrypt.hashSync(p, 10);
const addUser = db.prepare('INSERT INTO users (username,password_hash,nama,role,nim) VALUES (?,?,?,?,?)');
const addDevice = db.prepare('INSERT INTO devices (user_id,device_id) VALUES (?,?)');

const seed = db.transaction(() => {
  const akun = [
    // username, password, nama, role, nim, device
    ['admin',  'admin123',     'Admin Prodi',         'admin',     null,        'DEV-ADMIN-01'],
    ['dosen1', 'dosen123',     'Dr. Budi Santoso',    'dosen',     null,        'DEV-DOSEN1-01'],
    ['dosen2', 'dosen123',     'Dr. Siti Rahma',      'dosen',     null,        'DEV-DOSEN2-01'],
    ['mhs1',   'mahasiswa123', 'Andi Pratama',        'mahasiswa', '247006111010', 'DEV-MHS1-01'],
    ['mhs2',   'mahasiswa123', 'Bella Safira',        'mahasiswa', '247006111038', 'DEV-MHS2-01'],
    ['mhs3',   'mahasiswa123', 'Citra Lestari',       'mahasiswa', '247006111100', 'DEV-MHS3-01'],
  ];
  const id = {};
  for (const [u, p, nama, role, nim, dev] of akun) {
    id[u] = addUser.run(u, hash(p), nama, role, nim).lastInsertRowid;
    addDevice.run(id[u], dev);
  }

  // 2 kelas dengan dosen pengampu berbeda
  const addKelas = db.prepare('INSERT INTO kelas (kode_mk,nama_mk,dosen_id) VALUES (?,?,?)');
  const k1 = addKelas.run('KP70065004', 'Keamanan Informasi', id.dosen1).lastInsertRowid; // kelas id 1
  const k2 = addKelas.run('KP70065002', 'Basis Data', id.dosen2).lastInsertRowid;         // kelas id 2

  // nilai awal (belum final). nilai.id 1-3 = kelas 1, nilai.id 4-6 = kelas 2
  const addNilai = db.prepare('INSERT INTO nilai (kelas_id,nim,nilai,final) VALUES (?,?,?,0)');
  [['247006111010', 85], ['247006111038', 78], ['247006111100', 90]].forEach(([n, v]) => addNilai.run(k1, n, v));
  [['247006111010', 80], ['247006111038', 88], ['247006111100', 75]].forEach(([n, v]) => addNilai.run(k2, n, v));
});
seed();

console.log('Database di-seed ke', cfg.dbPath);
console.log('\nAkun & device ID (lihat juga README):');
console.table(db.prepare(`SELECT u.username, u.role, u.nim, d.device_id FROM users u JOIN devices d ON d.user_id=u.id ORDER BY u.id`).all());
db.close();
