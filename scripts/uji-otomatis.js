// UJI OTOMATIS: menjalankan seluruh skenario testing tanpa input manual.
//   npm run uji            -> 28 skenario inti (sama dengan koleksi ringkas / naskah video)
//   npm run uji:semua      -> 56 skenario lengkap
//   npm run uji:langkah    -> satu skenario per Enter, tampil request + response (cocok untuk video)
// Syarat: server sudah jalan (npm start). Data demo di-reset otomatis di awal (tanpa restart server).
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const jwt = require('jsonwebtoken');
const cfg = require('../shared/config');
const { openDb } = require('../shared/db');
const { dalamJamAkses, infoJamAkses } = require('../shared/time');

const args = process.argv.slice(2);
const SEMUA = args.includes('--semua');
const LANGKAH = args.includes('--langkah');
const TANPA_RESET = args.includes('--tanpa-reset');

const c = { hijau: '\x1b[32m', merah: '\x1b[31m', abu: '\x1b[90m', kuning: '\x1b[33m', tebal: '\x1b[1m', nol: '\x1b[0m' };
const dir = path.join(__dirname, '..', 'thunder-client');

// Skenario inti (nama harus sama dengan di koleksi lengkap)
const INTI = {
  '1. Login & Token': ['Login admin', 'Login dosen1', 'Login dosen2', 'Login mhs1', 'Token service (client id + secret)', '[TOLAK] Login dari device tidak terdaftar', 'Refresh access token dosen1'],
  '2. Verifikasi Token & Device': ['[TOLAK] Tanpa token', '[TOLAK] Token kedaluwarsa', '[TOLAK] Device milik user lain (token mhs1 + device mhs2)'],
  '3. Service tidak bisa diakses langsung': ['[TOLAK] Langsung ke :3001 tanpa header apa pun', '[TOLAK] Langsung ke :3001 token valid TANPA secret', '[TOLAK] Langsung ke :3001 secret benar TANPA token'],
  '4. Nilai (GET & PUT)': ['Mahasiswa 1 lihat nilai sendiri (2 baris)', '[TOLAK] Dosen 1 lihat kelas 2 (bukan miliknya)', '[TOLAK] Mahasiswa 1 minta nilai NIM mahasiswa 2', 'Dosen 1 ubah nilai id 1 (kelas 1) jadi 92', '[TOLAK] Dosen 2 ubah nilai id 1 (kelas milik dosen 1)'],
  '5. Finalisasi & Transkrip': ['Dosen 1 finalisasi kelas 1 (otomatis sinkron ke transkrip lewat gateway)', '[TOLAK] Ubah nilai yang sudah final', 'Transkrip mhs1 SETELAH finalisasi (1 mata kuliah)', '[TOLAK] Mahasiswa 1 buka transkrip mahasiswa 2', 'Admin buka transkrip mahasiswa 2'],
  '6. POST /transkrip/sinkron (hanya token service)': ['[TOLAK] Sinkron pakai token dosen', 'Sinkron pakai token service'],
  '7. Jam Akses (MANUAL: ubah .env lalu restart)': ['Dosen 2 ubah nilai id 4 (403 jika di luar jam, 200 jika dalam jam)'],
  '8. Refresh & Logout': ['Logout dosen2 (refresh token dicabut)', '[TOLAK] Refresh setelah logout'],
};

// ---------- siapkan skenario ----------
const col = JSON.parse(fs.readFileSync(path.join(dir, 'thunder-collection_sistem-nilai.json'), 'utf8'));
const daftar = [];
for (const f of [...col.folders].sort((a, b) => a.sortNum - b.sortNum)) {
  const nomor = f.name.match(/^(\d+)\./)[1];
  const semuaReq = col.requests.filter((q) => q.containerId === f._id).sort((a, b) => a.sortNum - b.sortNum);
  // penomoran [x.y] mengikuti urutan pada mode yang dipilih (mode inti = nomor di naskah & contekan)
  const terpilih = semuaReq.filter((q) => SEMUA || (INTI[f.name] || []).includes(q.name));
  terpilih.forEach((q, i) => daftar.push({ kode: `${nomor}.${i + 1}`, q }));
}

// ---------- variabel (diambil dari .env dan database, jadi ikut berubah kalau NIM/akun diganti) ----------
const db = openDb();
const env = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'thunder-environment_sistem-nilai.json'), 'utf8')).data.map((d) => [d.name, d.value]));
const device = (u) => db.prepare('SELECT d.device_id FROM devices d JOIN users u ON u.id = d.user_id WHERE u.username = ?').get(u).device_id;
const nim = (u) => db.prepare('SELECT nim FROM users WHERE username = ?').get(u).nim;
Object.assign(env, {
  gateway: cfg.gatewayUrl, nilai_direct: cfg.nilaiUrl, transkrip_direct: cfg.transkripUrl,
  gateway_secret: cfg.gatewaySecret, service_client_id: cfg.serviceClientId, service_client_secret: cfg.serviceClientSecret,
  dev_admin: device('admin'), dev_dosen1: device('dosen1'), dev_dosen2: device('dosen2'), dev_mhs1: device('mhs1'), dev_mhs2: device('mhs2'),
  nim_mhs1: nim('mhs1'), nim_mhs2: nim('mhs2'),
  token_expired: jwt.sign({ role: 'dosen', typ: 'access', iat: Math.floor(Date.now() / 1000) - 3600 }, cfg.jwtSecret,
    { algorithm: 'HS256', subject: '2', issuer: cfg.jwtIssuer, expiresIn: 60 }),
});
const isi = (s) => String(s).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in env ? env[k] : m));
const ambil = (obj, p) => p.replace(/^json\./, '').split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const sensor = (s) => s.replace(/(Bearer )([\w.-]{14})[\w.-]*/g, '$1$2…');

function resetData() {
  // kembalikan nilai awal & kosongkan transkrip (aman dijalankan saat server hidup)
  const asli = [85, 78, 90, 80, 88, 75]; // nilai.id 1..6 pada db/seed.js
  const up = db.prepare('UPDATE nilai SET nilai = ?, final = 0 WHERE id = ?');
  db.transaction(() => { asli.forEach((v, i) => up.run(v, i + 1)); db.prepare('DELETE FROM transkrip').run(); })();
}

async function main() {
  try { await fetch(`${cfg.gatewayUrl}/nilai`); }
  catch { console.error(`${c.merah}Gateway tidak terjangkau di ${cfg.gatewayUrl}. Jalankan dulu: npm start${c.nol}`); process.exit(2); }

  if (!TANPA_RESET) { resetData(); console.log(`${c.abu}Data demo di-reset (nilai awal, transkrip kosong).${c.nol}`); }
  if (!dalamJamAkses()) {
    console.log(`${c.kuning}Peringatan: sekarang di luar jam akses (${infoJamAkses()}). Skenario ubah nilai & finalisasi akan GAGAL.\n` +
      `Ubah ACCESS_START=00:00 dan ACCESS_END=24:00 di .env, restart server, lalu jalankan ulang.${c.nol}`);
  }
  console.log(`${c.tebal}Menjalankan ${daftar.length} skenario${SEMUA ? ' (lengkap)' : ''}...${c.nol}\n`);

  const rl = LANGKAH ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  const gagal = [];
  let ok = 0;
  let info = 0;

  for (const { kode, q } of daftar) {
    const headers = Object.fromEntries(q.headers.map((h) => [h.name, isi(h.value)]));
    let body;
    if (q.body.type === 'json') { headers['Content-Type'] = 'application/json'; body = isi(q.body.raw); }
    const url = isi(q.url);

    if (LANGKAH) {
      console.log(`${c.tebal}[${kode}] ${q.name}${c.nol}`);
      console.log(`${c.abu}${q.method} ${url}`);
      for (const [k, v] of Object.entries(headers)) console.log(`  ${k}: ${sensor(v)}`);
      if (body) console.log(`  body: ${body.replace(/\s+/g, ' ')}`);
      console.log(c.nol);
    }

    const res = await fetch(url, { method: q.method, headers, body });
    const teks = await res.text();
    let json = null; try { json = JSON.parse(teks); } catch { /* bukan JSON */ }

    const masalah = [];
    for (const t of q.tests) {
      if (t.type === 'res-code' && String(res.status) !== t.value) masalah.push(`status ${res.status}, seharusnya ${t.value}`);
      if (t.type === 'json-query' && String(ambil(json, t.custom)) !== t.value) masalah.push(`${t.custom} = ${ambil(json, t.custom)}, seharusnya ${t.value}`);
      if (t.type === 'set-env-var' && json) env[t.value.replace(/[{}]/g, '')] = ambil(json, t.custom);
    }
    const manual = q.tests.length === 0;
    const alasan = json ? (json.reason || json.error || json.message || '') : '';

    if (masalah.length) {
      gagal.push(`[${kode}] ${q.name}: ${masalah.join('; ')}`);
      console.log(`${c.merah}GAGAL${c.nol} [${kode}] ${q.name} -> HTTP ${res.status} (${masalah.join('; ')})`);
    } else {
      if (manual) info++; else ok++;
      const tag = manual ? `${c.kuning}INFO ${c.nol}` : `${c.hijau}OK   ${c.nol}`;
      console.log(`${tag} [${kode}] ${q.name} -> HTTP ${res.status}${alasan ? `  ${c.abu}(${alasan})${c.nol}` : ''}`);
    }
    if (LANGKAH) {
      console.log(`${c.abu}Response: ${sensor(teks.replace(/\s+/g, ' ')).slice(0, 400)}${c.nol}`);
      await rl.question(`${c.abu}\n[Enter] lanjut...${c.nol}`);
      console.log('');
    }
  }
  if (rl) rl.close();

  console.log(`\n${c.tebal}Hasil: ${c.hijau}${ok} lolos${c.nol}${c.tebal}, ${gagal.length ? c.merah : c.hijau}${gagal.length} gagal${c.nol}${info ? c.abu + ', ' + info + ' info (skenario manual jam akses)' + c.nol : ''}`);
  gagal.forEach((g) => console.log(`${c.merah} - ${g}${c.nol}`));
  console.log(`${c.abu}Lihat jejak audit: npm run audit${c.nol}`);
  process.exit(gagal.length ? 1 : 0);
}
main();
