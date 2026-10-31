// POLICY ENGINE (PE): memutuskan allow/deny berdasarkan Tabel 3 + atribut dari database.
// Default deny: endpoint yang tidak ada aturannya otomatis ditolak.
// decide() mengembalikan { allow, reason, status }.
const { dalamJamAkses, infoJamAkses } = require('../shared/time');

const izin = (reason) => ({ allow: true, reason });
const tolak = (reason, status = 403) => ({ allow: false, reason, status });

// ---------- aturan per endpoint (Tabel 3) ----------

// GET /nilai  -> mahasiswa: hanya miliknya; dosen: hanya kelas yang diampu
function nilaiList({ query, ctx, db }) {
  if (!['mahasiswa', 'dosen'].includes(ctx.role)) return tolak(`Role ${ctx.role} tidak boleh melihat nilai`);

  if (ctx.role === 'mahasiswa') {
    if (query.nim !== undefined && query.nim !== ctx.user.nim) {
      return tolak('Mahasiswa hanya boleh melihat nilai miliknya sendiri');
    }
    return izin('Mahasiswa melihat nilai miliknya sendiri');
  }

  // dosen: kalau menyebut kelas_id, kelas itu harus diampu (atribut dari database)
  if (query.kelas_id !== undefined) {
    const kelasId = Number(query.kelas_id);
    const kelas = Number.isInteger(kelasId) ? db.prepare('SELECT dosen_id FROM kelas WHERE id = ?').get(kelasId) : null;
    if (!kelas || kelas.dosen_id !== ctx.user.id) return tolak('Dosen hanya boleh melihat kelas yang diampunya');
  }
  return izin('Dosen melihat nilai kelas yang diampunya');
}

// PUT /nilai/:id -> dosen, kelas diampu, nilai belum final, dalam jam akses
function nilaiUbah({ m, ctx, db, now }) {
  if (ctx.role !== 'dosen') return tolak(`Role ${ctx.role} tidak boleh mengubah nilai`);
  const row = db.prepare(`SELECT n.final, k.dosen_id FROM nilai n JOIN kelas k ON k.id = n.kelas_id WHERE n.id = ?`).get(Number(m[1]));
  if (!row) return tolak('Data nilai tidak ditemukan', 404);
  if (row.dosen_id !== ctx.user.id) return tolak('Dosen bukan pengampu kelas dari nilai ini');
  if (row.final) return tolak('Nilai sudah final, tidak boleh diubah');
  if (!dalamJamAkses(now)) return tolak(`Di luar jam akses (${infoJamAkses()})`);
  return izin('Dosen pengampu mengubah nilai yang belum final dalam jam akses');
}

// POST /kelas/:id/finalisasi -> dosen, kelas diampu, dalam jam akses
function finalisasi({ m, ctx, db, now }) {
  if (ctx.role !== 'dosen') return tolak(`Role ${ctx.role} tidak boleh memfinalisasi nilai`);
  const kelas = db.prepare('SELECT dosen_id FROM kelas WHERE id = ?').get(Number(m[1]));
  if (!kelas) return tolak('Kelas tidak ditemukan', 404);
  if (kelas.dosen_id !== ctx.user.id) return tolak('Dosen bukan pengampu kelas ini');
  if (!dalamJamAkses(now)) return tolak(`Di luar jam akses (${infoJamAkses()})`);
  return izin('Dosen pengampu memfinalisasi kelas dalam jam akses');
}

// GET /transkrip/:nim -> mahasiswa: hanya NIM sendiri; admin: semua
function transkripGet({ m, ctx }) {
  if (ctx.role === 'admin') return izin('Admin melihat transkrip');
  if (ctx.role === 'mahasiswa') {
    return m[1] === ctx.user.nim ? izin('Mahasiswa melihat transkrip sendiri')
      : tolak('Mahasiswa hanya boleh melihat transkrip dengan NIM sendiri');
  }
  return tolak(`Role ${ctx.role} tidak boleh melihat transkrip`);
}

// POST /transkrip/sinkron -> HANYA token service. Token user mana pun ditolak.
function sinkron({ ctx }) {
  return ctx.role === 'service' ? izin('Token service sah untuk sinkron transkrip')
    : tolak('Hanya token service yang boleh memanggil sinkron transkrip');
}

const aturan = [
  { method: 'GET',  re: /^\/nilai\/?$/,                    cek: nilaiList },
  { method: 'PUT',  re: /^\/nilai\/(\d+)\/?$/,             cek: nilaiUbah },
  { method: 'POST', re: /^\/kelas\/(\d+)\/finalisasi\/?$/, cek: finalisasi },
  { method: 'GET',  re: /^\/transkrip\/(\d+)\/?$/,         cek: transkripGet },
  { method: 'POST', re: /^\/transkrip\/sinkron\/?$/,       cek: sinkron },
];

function decide({ method, path, query, ctx, db, now = new Date() }) {
  for (const a of aturan) {
    if (a.method !== method) continue;
    const m = path.match(a.re);
    if (m) return a.cek({ m, query, ctx, db, now });
  }
  return tolak('Tidak ada kebijakan untuk endpoint ini (default deny)');
}

module.exports = { decide };
