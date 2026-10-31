// Bagian Policy Administrator (PA): login, refresh, logout, token service.
// Token dikeluarkan di sini; keputusan allow/deny endpoint lain ada di policy.js
const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cfg = require('../shared/config');
const { samaAman } = require('../shared/verify');
const audit = require('./audit');

const db = audit.db;
const router = express.Router();
const DUMMY_HASH = bcrypt.hashSync('dummy-untuk-menyamakan-waktu', 10);

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function buatAccessToken(user) {
  // minimal berisi sub dan role (4.1)
  return jwt.sign({ role: user.role, typ: 'access' }, cfg.jwtSecret, {
    algorithm: 'HS256', subject: String(user.id), expiresIn: cfg.accessTokenTtl, issuer: cfg.jwtIssuer,
  });
}

function buatTokenService(clientId) {
  return jwt.sign({ role: 'service', typ: 'service' }, cfg.jwtSecret, {
    algorithm: 'HS256', subject: clientId, expiresIn: cfg.serviceTokenTtl, issuer: cfg.jwtIssuer,
  });
}

function tolak(req, res, status, pesan, alasan, subjek) {
  audit.catat(req, { subjek: subjek || 'anonymous', device: req.get('X-Device-ID') || null }, 'deny', alasan, status);
  return res.status(status).json({ error: pesan, reason: alasan });
}

// POST /auth/login  -> kredensial valid + device terdaftar
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const deviceId = req.get('X-Device-ID');
  if (typeof username !== 'string' || typeof password !== 'string') {
    return tolak(req, res, 400, 'username dan password wajib diisi', 'Body login tidak lengkap');
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  // bcrypt tetap dijalankan walau user tidak ada (mencegah user enumeration lewat waktu respon)
  const passOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passOk) {
    return tolak(req, res, 401, 'Kredensial tidak valid', 'Username/password salah', `user:${username.slice(0, 30)}`);
  }
  const subjek = `user:${user.username}`;
  if (!deviceId) {
    return tolak(req, res, 403, 'Device tidak terdaftar', 'Header X-Device-ID tidak ada', subjek);
  }
  const dev = db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?').get(user.id, deviceId);
  if (!dev) {
    return tolak(req, res, 403, 'Device tidak terdaftar untuk user ini', 'Device tidak terdaftar', subjek);
  }

  const refreshToken = crypto.randomBytes(48).toString('hex'); // opaque, acak
  const now = new Date();
  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked, created_at) VALUES (?,?,?,0,?)')
    .run(user.id, sha256(refreshToken), new Date(now.getTime() + cfg.refreshTokenTtlMs).toISOString(), now.toISOString());

  audit.catat(req, { subjek, role: user.role, device: deviceId }, 'allow', 'Login berhasil', 200);
  res.json({
    token_type: 'Bearer',
    access_token: buatAccessToken(user),
    expires_in: cfg.accessTokenTtl,
    refresh_token: refreshToken,
    user: { id: user.id, username: user.username, nama: user.nama, role: user.role, nim: user.nim },
  });
});

function cariRefreshToken(token) {
  if (typeof token !== 'string' || !token) return { error: 'refresh_token wajib diisi' };
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(token));
  if (!row) return { error: 'Refresh token tidak dikenal' };
  if (row.revoked) return { error: 'Refresh token sudah dicabut' };
  if (new Date(row.expires_at) <= new Date()) return { error: 'Refresh token kedaluwarsa' };
  return { row };
}

// POST /auth/refresh -> access token baru dari refresh token yang valid & belum dicabut
router.post('/refresh', (req, res) => {
  const { row, error } = cariRefreshToken((req.body || {}).refresh_token);
  if (error) return tolak(req, res, 401, 'Refresh token tidak valid', error);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!user) return tolak(req, res, 401, 'Refresh token tidak valid', 'User tidak ditemukan');
  audit.catat(req, { subjek: `user:${user.username}`, role: user.role, device: req.get('X-Device-ID') || null },
    'allow', 'Refresh token valid, access token baru diterbitkan', 200);
  res.json({ token_type: 'Bearer', access_token: buatAccessToken(user), expires_in: cfg.accessTokenTtl });
});

// POST /auth/logout -> mencabut refresh token
router.post('/logout', (req, res) => {
  const { row, error } = cariRefreshToken((req.body || {}).refresh_token);
  if (error) return tolak(req, res, 401, 'Refresh token tidak valid', error);
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
  const user = db.prepare('SELECT username, role FROM users WHERE id = ?').get(row.user_id);
  audit.catat(req, { subjek: `user:${user.username}`, role: user.role, device: req.get('X-Device-ID') || null },
    'allow', 'Logout: refresh token dicabut', 200);
  res.json({ message: 'Logout berhasil, refresh token dicabut' });
});

// POST /auth/service -> token service (role: service, 5 menit) untuk Service Nilai
router.post('/service', (req, res) => {
  const { client_id: clientId, client_secret: clientSecret } = req.body || {};
  const valid = typeof clientId === 'string' && typeof clientSecret === 'string'
    && samaAman(clientId, cfg.serviceClientId) && samaAman(clientSecret, cfg.serviceClientSecret);
  if (!valid) {
    return tolak(req, res, 401, 'Client ID/secret tidak valid', 'Kredensial service salah',
      `service:${String(clientId || '?').slice(0, 30)}`);
  }
  audit.catat(req, { subjek: `service:${clientId}`, role: 'service' }, 'allow', 'Token service diterbitkan', 200);
  res.json({ token_type: 'Bearer', access_token: buatTokenService(clientId), expires_in: 300 });
});

module.exports = router;
