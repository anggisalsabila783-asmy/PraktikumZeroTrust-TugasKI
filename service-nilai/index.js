// SERVICE NILAI (port 3001): data nilai & kelas. Hanya bisa diakses lewat gateway.
const express = require('express');
const cfg = require('../shared/config');
const { openDb } = require('../shared/db');
const { verifikasiService } = require('../shared/verify');
const { sinkronTranskrip } = require('./gatewayClient');

const db = openDb();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Gateway secret + verifikasi JWT (tanda tangan & expiry) untuk SEMUA route
app.use(verifikasiService);

// Ambil user dari DB berdasarkan sub token. Service tidak mempercayai klaim role di token begitu saja.
function muatUser(req, res, next) {
  if (req.auth.role === 'service') return res.status(403).json({ error: 'Token service tidak boleh mengakses endpoint ini' });
  const user = db.prepare('SELECT id, username, role, nim FROM users WHERE id = ?').get(Number(req.auth.sub));
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
  req.user = user;
  next();
}
const wajibDosen = (req, res, next) =>
  req.user.role === 'dosen' ? next() : res.status(403).json({ error: 'Hanya dosen yang boleh' });

// GET /nilai  (defense in depth: hasil selalu difilter sesuai identitas pada token)
app.get('/nilai', muatUser, (req, res) => {
  const dasar = `
    SELECT n.id, n.kelas_id, k.kode_mk, k.nama_mk, n.nim, u.nama AS nama_mahasiswa, n.nilai, n.final
    FROM nilai n JOIN kelas k ON k.id = n.kelas_id JOIN users u ON u.nim = n.nim`;
  let rows;
  if (req.user.role === 'mahasiswa') {
    rows = db.prepare(`${dasar} WHERE n.nim = ? ORDER BY n.id`).all(req.user.nim);
  } else if (req.user.role === 'dosen') {
    const kelasId = req.query.kelas_id !== undefined ? Number(req.query.kelas_id) : null;
    rows = kelasId === null
      ? db.prepare(`${dasar} WHERE k.dosen_id = ? ORDER BY n.id`).all(req.user.id)
      : db.prepare(`${dasar} WHERE k.dosen_id = ? AND k.id = ? ORDER BY n.id`).all(req.user.id, kelasId);
  } else {
    return res.status(403).json({ error: 'Role tidak boleh melihat nilai' });
  }
  res.json({ jumlah: rows.length, data: rows });
});

// PUT /nilai/:id  body: { "nilai": 0..100 }
app.put('/nilai/:id', muatUser, wajibDosen, (req, res) => {
  const row = db.prepare('SELECT n.id, n.final, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?')
    .get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Data nilai tidak ditemukan' });
  if (row.dosen_id !== req.user.id) return res.status(403).json({ error: 'Bukan pengampu kelas ini' });
  if (row.final) return res.status(409).json({ error: 'Nilai sudah final' });

  const nilai = req.body && req.body.nilai;
  if (typeof nilai !== 'number' || !Number.isFinite(nilai) || nilai < 0 || nilai > 100) {
    return res.status(400).json({ error: 'Field "nilai" wajib berupa angka 0-100' });
  }
  db.prepare('UPDATE nilai SET nilai = ? WHERE id = ?').run(nilai, row.id);
  res.json({ message: 'Nilai diperbarui', id: row.id, nilai });
});

// POST /kelas/:id/finalisasi -> kunci nilai, lalu minta Service Transkrip menyinkron LEWAT GATEWAY
app.post('/kelas/:id/finalisasi', muatUser, wajibDosen, async (req, res) => {
  const kelas = db.prepare('SELECT * FROM kelas WHERE id = ?').get(Number(req.params.id));
  if (!kelas) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  if (kelas.dosen_id !== req.user.id) return res.status(403).json({ error: 'Bukan pengampu kelas ini' });

  const rows = db.prepare('SELECT id, nim, nilai, final FROM nilai WHERE kelas_id = ?').all(kelas.id);
  if (rows.length === 0) return res.status(409).json({ error: 'Kelas belum memiliki data nilai' });
  if (rows.every((r) => r.final)) return res.status(409).json({ error: 'Kelas sudah difinalisasi' });
  if (rows.some((r) => r.nilai === null)) return res.status(409).json({ error: 'Masih ada nilai yang belum diisi' });

  const idBaruFinal = rows.filter((r) => !r.final).map((r) => r.id);
  const tandai = db.prepare('UPDATE nilai SET final = ? WHERE id = ?');
  db.transaction((nilaiFinal) => idBaruFinal.forEach((id) => tandai.run(nilaiFinal, id)))(1);

  try {
    const hasil = await sinkronTranskrip({
      kelas_id: kelas.id, kode_mk: kelas.kode_mk, nama_mk: kelas.nama_mk,
      items: rows.map((r) => ({ nim: r.nim, nilai: r.nilai })),
    });
    res.json({ message: 'Kelas difinalisasi dan transkrip tersinkron', kelas_id: kelas.id, sinkron: hasil });
  } catch (err) {
    // Sinkron gagal -> batalkan finalisasi agar data tetap konsisten
    db.transaction((nilaiFinal) => idBaruFinal.forEach((id) => tandai.run(nilaiFinal, id)))(0);
    res.status(502).json({ error: 'Finalisasi dibatalkan karena sinkron transkrip gagal', detail: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Body JSON tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Kesalahan internal Service Nilai' });
});

// Hanya mendengarkan di 127.0.0.1 -> tidak terbuka ke jaringan
app.listen(cfg.nilaiPort, '127.0.0.1', () => console.log(`[NILAI] Service Nilai di 127.0.0.1:${cfg.nilaiPort}`));
