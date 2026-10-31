# Sistem Nilai – Zero Trust Security

Tugas Praktikum Individu · Keamanan Informasi (KP70065004) · Informatika Universitas Siliwangi

API Gateway sebagai **Policy Enforcement Point (PEP)** yang terpisah dari service (NIST SP 800-207).
Semua akses, termasuk panggilan antar-service, diperiksa gateway: token, device, kebijakan, jam akses, lalu dicatat ke audit log.

```
Client (Thunder Client) ──token + X-Device-ID──▶ API Gateway :3000 (PEP + Policy Engine + Audit Log)
                                                    │ allow + X-Gateway-Secret
                                    ┌───────────────┴───────────────┐
                              Service Nilai :3001            Service Transkrip :3002
                                    │  finalisasi: ambil token service (/auth/service)
                                    └──▶ POST /transkrip/sinkron LEWAT GATEWAY ──▶ Service Transkrip
                         Database SQLite bersama (data/sistem_nilai.db)
```

## 1. Persyaratan
- **Node.js 20 atau lebih baru** (cek: `node -v`)
- VS Code + ekstensi **Thunder Client**

## 2. Cara menjalankan
```bash
npm install
copy .env.example .env      # Windows   (Mac/Linux: cp .env.example .env)
npm run seed                # membuat database + data awal (juga untuk RESET data demo)
npm start                   # menjalankan gateway + 2 service sekaligus
```
Atau jalankan di 3 terminal terpisah: `npm run gateway`, `npm run nilai`, `npm run transkrip`.

Melihat audit log: `npm run audit` (30 terakhir) · `npm run audit -- deny` (hanya yang ditolak) · `npm run audit -- 100`.
Log juga tampil real-time di terminal gateway dengan awalan `[AUDIT]`.

## 3. Akun & Device ID (data seed)
| Username | Password | Role | NIM | Device ID |
|---|---|---|---|---|
| admin | admin123 | admin | – | `DEV-ADMIN-01` |
| dosen1 | dosen123 | dosen (mengampu kelas 1) | – | `DEV-DOSEN1-01` |
| dosen2 | dosen123 | dosen (mengampu kelas 2) | – | `DEV-DOSEN2-01` |
| mhs1 | mahasiswa123 | mahasiswa | 227006001 | `DEV-MHS1-01` |
| mhs2 | mahasiswa123 | mahasiswa | 227006002 | `DEV-MHS2-01` |
| mhs3 | mahasiswa123 | mahasiswa | 227006003 | `DEV-MHS3-01` |

Kelas: **1** = Keamanan Informasi (dosen1), **2** = Basis Data (dosen2).
Nilai: id 1–3 milik kelas 1 (mhs1..mhs3), id 4–6 milik kelas 2. Semua nilai awal terisi dan belum final.
Kredensial Service Nilai: `client_id` = `service-nilai`, `client_secret` dari `.env` (`SERVICE_CLIENT_SECRET`).

## 4. Pengujian dengan Thunder Client
1. Pastikan server berjalan dan jalankan `npm run seed` (data bersih).
2. Thunder Client → **Collections** → ikon `⋮` → **Import** → pilih `thunder-client/thunder-collection_sistem-nilai.json`.
3. **Env** → `⋮` → **Import** → pilih `thunder-client/thunder-environment_sistem-nilai.json`, lalu **aktifkan** environment "Sistem Nilai" (wajib, supaya variabel `{{token_...}}` terisi otomatis).
4. Buka koleksi → `⋮` → **Run All** (atau jalankan satu per satu, urut dari folder 1).
   Setiap request punya assertion (status code). Request berawalan **[TOLAK]** memang harus gagal (401/403/404/409/400).
5. Ulangi dari awal? Jalankan `npm run seed` lagi (karena finalisasi mengunci nilai).

Jika import environment gagal, buat manual variabel: `gateway`, `nilai_direct`, `transkrip_direct`, `gateway_secret`, `service_client_id`, `service_client_secret`, `dev_admin`, `dev_dosen1`, `dev_dosen2`, `dev_mhs1`, `dev_mhs2`, `nim_mhs1`, `nim_mhs2`, `token_expired`, `token_admin`, `token_dosen1`, `token_dosen2`, `token_mhs1`, `token_mhs2`, `token_service`, `refresh_dosen1`, `refresh_dosen2` (nilainya ada di file environment).
Jika `JWT_SECRET` di `.env` diganti, buat ulang `token_expired` dengan `npm run expired-token`.

## 4A. Uji otomatis (tanpa input manual)
Tanpa Thunder Client sekalipun, seluruh skenario bisa dijalankan satu perintah (server harus sudah jalan lewat `npm start`):

```bash
npm run uji            # 28 skenario inti (nomor [x.y] sama dengan naskah video)
npm run uji:semua      # 56 skenario lengkap
npm run uji:langkah    # satu skenario per Enter, menampilkan request & response (cocok untuk demo video)
```
- Token, device ID, NIM, dan secret diambil otomatis dari `.env` dan database, jadi tidak ada yang perlu disalin.
- Data demo di-reset otomatis di awal (tanpa restart server), jadi perintah ini bisa diulang berkali-kali.
- Skenario **[TOLAK]** dinyatakan `OK` jika memang ditolak dengan status yang benar; alasan penolakan ditampilkan di sebelahnya.
- Skenario jam akses ([7.1]) bersifat manual (`INFO`): ubah `ACCESS_START`/`ACCESS_END` di `.env`, restart server, lalu jalankan `npm run uji`.
- Di luar jam 07.00-21.00 WIB, ubah dulu `.env` ke `00:00`-`24:00` dan restart server, kalau tidak, ubah nilai & finalisasi akan ditolak (ini perilaku yang benar).

### Demo "jam akses" (folder 7)
Edit `.env`, lalu restart `npm start`:
- Di luar jam (selalu ditolak): `ACCESS_START=00:00` dan `ACCESS_END=00:00` → PUT nilai & finalisasi = **403**
- Dalam jam (selalu boleh): `ACCESS_START=00:00` dan `ACCESS_END=24:00`
- Default tugas: `07:00`–`21:00` (zona waktu `ACCESS_TIMEZONE`, default `Asia/Jakarta`)

## 5. Peta kebutuhan → kode (untuk video demo)
| Kebutuhan | Di mana kodenya |
|---|---|
| 4.1 Access token JWT 10 menit (`sub`, `role`) | `gateway/auth.js` → `buatAccessToken()`; TTL di `.env` `ACCESS_TOKEN_TTL` |
| 4.1 Refresh token 1 hari, disimpan di DB, bisa dicabut | `gateway/auth.js` → `/login`, `/refresh`, `/logout`; tabel `refresh_tokens` (disimpan sebagai hash SHA-256) |
| 4.1 Token service 5 menit (`role: service`) | `gateway/auth.js` → `POST /auth/service`; dipakai `service-nilai/gatewayClient.js` |
| 4.1 Gateway secret | Gateway menambah header: `gateway/index.js` → `buatProxy()`. Service memeriksa: `shared/verify.js` → `wajibGateway()` |
| 4.1 Verifikasi ulang JWT di service | `shared/verify.js` → `wajibToken()` (dipakai kedua service) |
| 4.2 Kebijakan akses Tabel 3 | `gateway/policy.js` (array `aturan`, default deny) |
| 4.2 Policy membaca atribut dari DB | `policy.js`: query `kelas`, `nilai`, `users` (kepemilikan kelas, status final, NIM) |
| 4.3 Device terdaftar | `gateway/index.js` → `authenticate()` + tabel `devices`; juga saat login di `auth.js` |
| 4.3 Jam akses (dapat dikonfigurasi) | `shared/time.js` + `.env`; dipakai di `policy.js` (`nilaiUbah`, `finalisasi`) |
| 4.4 Audit log | `gateway/audit.js`, tabel `audit_log`, dipanggil di `auth.js` & `index.js` (`enforce`) |
| Finalisasi → sinkron lewat gateway | `service-nilai/index.js` (`/kelas/:id/finalisasi`) + `gatewayClient.js` → `POST /transkrip/sinkron` |
| Sinkron hanya token service | `policy.js` → `sinkron()` + dicek ulang di `service-transkrip/index.js` |
| Service tidak bisa diakses langsung | Service listen di `127.0.0.1` + `wajibGateway()` |

## 6. Prinsip zero trust yang diterapkan
- **Never trust, always verify**: tiap request diverifikasi token, device, dan kebijakan; service memverifikasi ulang (secret + JWT), bukan percaya begitu saja pada gateway.
- **Least privilege**: tiap role hanya bisa endpoint yang diizinkan; kebijakan *default deny* (endpoint tak dikenal ditolak); role diambil dari database, bukan hanya klaim token.
- **Assume breach**: service tidak bisa dipanggil tanpa secret + token valid; service juga memfilter data sesuai identitas (defense in depth); semua keputusan, termasuk penolakan, tercatat di audit log.

## 7. Catatan desain & keterbatasan (jujur untuk laporan)
- Access token bersifat stateless (JWT), sehingga setelah **logout** access token yang sudah terbit tetap berlaku sampai kedaluwarsa (maks 10 menit). Sesuai soal, logout mencabut **refresh token**, jadi token baru tidak bisa diminta lagi.
- JWT memakai HS256 dengan secret bersama antara gateway dan service (cukup untuk tugas; produksi sebaiknya RS256/ES256 agar service hanya memegang public key).
- Komunikasi memakai HTTP lokal tanpa TLS dan tanpa rate limiting (di luar lingkup tugas; produksi wajib HTTPS + pembatasan percobaan login).
- Jika sinkron ke Service Transkrip gagal saat finalisasi, finalisasi dibatalkan (nilai kembali tidak final) agar data konsisten.
- Jam akses memakai zona waktu `ACCESS_TIMEZONE` (default `Asia/Jakarta`), bukan zona waktu server.

## 8. Struktur proyek
```
gateway/            index.js (PEP, proxy), policy.js (Policy Engine), auth.js (PA: login/token), audit.js
service-nilai/      index.js, gatewayClient.js (panggil gateway untuk token service + sinkron)
service-transkrip/  index.js
shared/             config.js, db.js, verify.js (secret + JWT di service), time.js (jam akses)
db/seed.js          skema + data awal
scripts/            start-all.js, audit.js, expired-token.js, uji-otomatis.js
thunder-client/     koleksi + environment untuk Thunder Client
```
