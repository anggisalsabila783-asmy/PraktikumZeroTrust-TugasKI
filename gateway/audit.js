// 4.4 Audit log: setiap keputusan akses dicatat (waktu, subjek, endpoint, device, hasil, alasan)
const { openDb } = require('../shared/db');
const db = openDb();

const insert = db.prepare(`
  INSERT INTO audit_log (waktu, subjek, role, method, endpoint, device, hasil, alasan, status_code)
  VALUES (@waktu, @subjek, @role, @method, @endpoint, @device, @hasil, @alasan, @status_code)
`);
const updateStatus = db.prepare('UPDATE audit_log SET status_code = ? WHERE id = ?');

function catat(req, { subjek = 'anonymous', role = null, device = null }, hasil, alasan, status = null) {
  const row = {
    waktu: new Date().toISOString(),
    subjek, role,
    method: req.method,
    endpoint: req.originalUrl,
    device,
    hasil, alasan,
    status_code: status,
  };
  const id = insert.run(row).lastInsertRowid;
  console.log(`[AUDIT] ${hasil.toUpperCase().padEnd(5)} ${subjek.padEnd(20)} ${req.method.padEnd(6)} ${req.originalUrl} -> ${alasan}`);
  return id;
}

// Untuk request yang diizinkan: lengkapi dengan status code akhir dari service
function setStatus(id, status) {
  updateStatus.run(status, id);
}

module.exports = { catat, setStatus, db };
