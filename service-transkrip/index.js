// SERVICE TRANSKRIP (port 3002): data transkrip. Hanya bisa diakses lewat gateway.
const express = require('express');
const cfg = require('../shared/config');
const { openDb } = require('../shared/db');
const { verifikasiService } = require('../shared/verify');

const db = openDb();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// Gateway secret + verifikasi JWT untuk SEMUA route
app.use(verifikasiService);

// POST /transkrip/sinkron -> hanya token service (didaftarkan SEBELUM route /transkrip/:nim)
app.post('/transkrip/sinkron', (req, res) => {
  if (req.auth.role !== 'service') {
    return res.status(403).json({ error: 'Hanya token service yang boleh sinkron transkrip' });
  }
  const { kelas_id: kelasId, kode_mk: kodeMk, nama_mk: namaMk, items } = req.body || {};
  if (!Number.isInteger(kelasId) || typeof kodeMk !== 'string' || typeof namaMk !== 'string'
      || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Payload sinkron tidak valid' });
  }
  const cekMhs = db.prepare("SELECT 1 FROM users WHERE nim = ? AND role = 'mahasiswa'");
  for (const it of items) {
    if (typeof it.nim !== 'string' || typeof it.nilai !== 'number' || it.nilai < 0 || it.nilai > 100 || !cekMhs.get(it.nim)) {
      return res.status(400).json({ error: `Item sinkron tidak valid (nim: ${it.nim})` });
    }
  }
  const upsert = db.prepare(`
    INSERT INTO transkrip (nim, kelas_id, kode_mk, nama_mk, nilai, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(nim, kelas_id) DO UPDATE SET kode_mk = excluded.kode_mk, nama_mk = excluded.nama_mk,
      nilai = excluded.nilai, updated_at = excluded.updated_at`);
  const waktu = new Date().toISOString();
  db.transaction(() => items.forEach((it) => upsert.run(it.nim, kelasId, kodeMk, namaMk, it.nilai, waktu)))();
  res.json({ message: 'Transkrip disinkronkan', kelas_id: kelasId, jumlah: items.length });
});

// GET /transkrip/:nim -> mahasiswa hanya NIM sendiri, admin semua (defense in depth)
app.get('/transkrip/:nim', (req, res) => {
  if (req.auth.role === 'service') return res.status(403).json({ error: 'Token service tidak boleh membaca transkrip' });
  const user = db.prepare('SELECT id, role, nim FROM users WHERE id = ?').get(Number(req.auth.sub));
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
  const boleh = user.role === 'admin' || (user.role === 'mahasiswa' && user.nim === req.params.nim);
  if (!boleh) return res.status(403).json({ error: 'Tidak boleh melihat transkrip ini' });

  const mhs = db.prepare("SELECT nama, nim FROM users WHERE nim = ? AND role = 'mahasiswa'").get(req.params.nim);
  if (!mhs) return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  const data = db.prepare('SELECT kelas_id, kode_mk, nama_mk, nilai, updated_at FROM transkrip WHERE nim = ? ORDER BY kelas_id')
    .all(req.params.nim);
  res.json({ nim: mhs.nim, nama: mhs.nama, jumlah_mk: data.length, transkrip: data });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body JSON tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Kesalahan internal Service Transkrip' });
});

app.listen(cfg.transkripPort, '127.0.0.1', () => console.log(`[TRANSKRIP] Service Transkrip di 127.0.0.1:${cfg.transkripPort}`));
