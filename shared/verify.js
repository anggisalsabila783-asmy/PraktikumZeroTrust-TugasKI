// Verifikasi ulang di SERVICE (4.1): gateway secret + tanda tangan & masa berlaku JWT.
// Keduanya wajib. Token valid tanpa secret ditolak, secret valid tanpa token juga ditolak.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cfg = require('./config');

function samaAman(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb); // constant-time
}

function wajibGateway(req, res, next) {
  const secret = req.get('X-Gateway-Secret');
  if (!secret || !samaAman(secret, cfg.gatewaySecret)) {
    return res.status(403).json({ error: 'Akses langsung ditolak: X-Gateway-Secret tidak ada/tidak valid' });
  }
  next();
}

function wajibToken(req, res, next) {
  const [skema, token] = (req.get('Authorization') || '').split(' ');
  if (skema !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Token tidak ada (service menolak request tanpa token valid)' });
  }
  try {
    req.auth = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'], issuer: cfg.jwtIssuer });
  } catch (err) {
    const pesan = err.name === 'TokenExpiredError' ? 'Token kedaluwarsa' : 'Token tidak valid';
    return res.status(401).json({ error: `${pesan} (diverifikasi ulang oleh service)` });
  }
  next();
}

module.exports = { verifikasiService: [wajibGateway, wajibToken], samaAman };
