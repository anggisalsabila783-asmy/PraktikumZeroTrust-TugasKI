// Konfigurasi terpusat, dibaca dari file .env
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function wajib(nama) {
  const v = process.env[nama];
  if (!v) throw new Error(`Env ${nama} belum diisi. Salin .env.example menjadi .env terlebih dahulu.`);
  return v;
}

const gatewayPort = Number(process.env.GATEWAY_PORT || 3000);
const nilaiPort = Number(process.env.NILAI_PORT || 3001);
const transkripPort = Number(process.env.TRANSKRIP_PORT || 3002);

module.exports = {
  gatewayPort,
  nilaiPort,
  transkripPort,
  // 127.0.0.1 dipakai (bukan "localhost") agar tidak terjebak resolusi IPv6 (::1)
  gatewayUrl: `http://127.0.0.1:${gatewayPort}`,
  nilaiUrl: `http://127.0.0.1:${nilaiPort}`,
  transkripUrl: `http://127.0.0.1:${transkripPort}`,

  jwtSecret: wajib('JWT_SECRET'),
  gatewaySecret: wajib('GATEWAY_SECRET'),
  serviceClientId: wajib('SERVICE_CLIENT_ID'),
  serviceClientSecret: wajib('SERVICE_CLIENT_SECRET'),

  jwtIssuer: 'sistem-nilai-gateway',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '10m',      // 4.1: 10 menit
  serviceTokenTtl: '5m',                                      // 4.1: 5 menit
  refreshTokenTtlMs: 24 * 60 * 60 * 1000,                     // 4.1: 1 hari

  accessStart: process.env.ACCESS_START || '07:00',
  accessEnd: process.env.ACCESS_END || '21:00',
  accessTimezone: process.env.ACCESS_TIMEZONE || 'Asia/Jakarta',

  dbPath: path.resolve(path.join(__dirname, '..'), process.env.DB_PATH || './data/sistem_nilai.db'),
};
