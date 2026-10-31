// API GATEWAY = Policy Enforcement Point (PEP), port 3000. Satu-satunya pintu masuk.
// Urutan tiap request: authenticate -> cek device -> policy.decide -> audit -> proxy (+X-Gateway-Secret)
const express = require('express');
const jwt = require('jsonwebtoken');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cfg = require('../shared/config');
const audit = require('./audit');
const authRouter = require('./auth');
const policy = require('./policy');

const db = audit.db;
const app = express();
app.disable('x-powered-by');

// /auth/* ditangani gateway sendiri (body JSON hanya di-parse di sini; request ke service tidak disentuh)
app.use('/auth', express.json({ limit: '10kb' }), authRouter);

// ---------- 1) Autentikasi + verifikasi konteks (device) ----------
function authenticate(req, res, next) {
  const tolak = (status, reason, ctx = {}) => {
    audit.catat(req, { device: req.get('X-Device-ID') || null, ...ctx }, 'deny', reason, status);
    return res.status(status).json({ error: reason });
  };

  const [skema, token] = (req.get('Authorization') || '').split(' ');
  if (skema !== 'Bearer' || !token) return tolak(401, 'Access token tidak ada');

  let payload;
  try {
    payload = jwt.verify(token, cfg.jwtSecret, { algorithms: ['HS256'], issuer: cfg.jwtIssuer });
  } catch (err) {
    return tolak(401, err.name === 'TokenExpiredError' ? 'Token kedaluwarsa' : 'Token tidak valid');
  }

  // Token service (Service Nilai): tanpa device, role service
  if (payload.role === 'service') {
    if (payload.typ !== 'service') return tolak(401, 'Jenis token tidak sesuai');
    req.ctx = { subjek: `service:${payload.sub}`, role: 'service', device: null, user: null };
    return next();
  }

  // Token user: user harus ada di database, device harus terdaftar untuk user tersebut
  if (payload.typ !== 'access') return tolak(401, 'Jenis token tidak sesuai');
  const user = db.prepare('SELECT id, username, role, nim FROM users WHERE id = ?').get(Number(payload.sub));
  if (!user) return tolak(401, 'User pada token tidak ditemukan');

  const subjek = `user:${user.username}`;
  const deviceId = req.get('X-Device-ID');
  if (!deviceId) return tolak(403, 'Header X-Device-ID tidak ada', { subjek, role: user.role });
  const dev = db.prepare('SELECT 1 FROM devices WHERE user_id = ? AND device_id = ?').get(user.id, deviceId);
  if (!dev) return tolak(403, 'Device tidak terdaftar untuk user ini', { subjek, role: user.role });

  // role diambil dari DATABASE (bukan dari klaim token) agar perubahan role langsung berlaku
  req.ctx = { subjek, role: user.role, device: deviceId, user };
  next();
}

// ---------- 2) Keputusan Policy Engine + audit ----------
function enforce(req, res, next) {
  const d = policy.decide({ method: req.method, path: req.path, query: req.query, ctx: req.ctx, db });
  const id = audit.catat(req, req.ctx, d.allow ? 'allow' : 'deny', d.reason, d.allow ? null : d.status);
  if (!d.allow) return res.status(d.status).json({ error: 'Akses ditolak', reason: d.reason });
  res.on('finish', () => audit.setStatus(id, res.statusCode)); // status akhir dari service
  next();
}

// ---------- 3) Teruskan ke service dengan X-Gateway-Secret ----------
function buatProxy(target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq) => proxyReq.setHeader('X-Gateway-Secret', cfg.gatewaySecret), // menimpa header kiriman client
      error: (err, req, res) => {
        if (!res.writeHead || res.headersSent) return;
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service tidak dapat dihubungi' }));
      },
    },
  });
}
const proxyNilai = buatProxy(cfg.nilaiUrl);
const proxyTranskrip = buatProxy(cfg.transkripUrl);

app.use(authenticate, enforce, (req, res, next) =>
  (req.path.startsWith('/transkrip') ? proxyTranskrip : proxyNilai)(req, res, next));

// Penangan error (mis. JSON body rusak di /auth)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    audit.catat(req, {}, 'deny', 'Body JSON tidak valid', 400);
    return res.status(400).json({ error: 'Body JSON tidak valid' });
  }
  console.error(err);
  res.status(500).json({ error: 'Kesalahan internal gateway' });
});

app.listen(cfg.gatewayPort, () => {
  console.log(`[GATEWAY] PEP berjalan di http://localhost:${cfg.gatewayPort}`);
  console.log(`[GATEWAY] Jam akses: ${require('../shared/time').infoJamAkses()}`);
});
