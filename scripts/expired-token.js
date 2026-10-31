// Membuat access token yang SUDAH kedaluwarsa (untuk uji "token kedaluwarsa" di Thunder Client)
const jwt = require('jsonwebtoken');
const cfg = require('../shared/config');
const t = jwt.sign({ role: 'dosen', typ: 'access', iat: Math.floor(Date.now() / 1000) - 3600 }, cfg.jwtSecret,
  { algorithm: 'HS256', subject: '2', issuer: cfg.jwtIssuer, expiresIn: 60 });
console.log(t);
