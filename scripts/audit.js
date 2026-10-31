// Menampilkan audit log: npm run audit            (30 terakhir)
//                        npm run audit -- 100     (100 terakhir)
//                        npm run audit -- deny    (hanya yang ditolak)
const { openDb } = require('../shared/db');
const db = openDb();
const args = process.argv.slice(2);
const hanya = args.find((a) => a === 'allow' || a === 'deny');
const n = Number(args.find((a) => /^\d+$/.test(a))) || 30;
const rows = db.prepare(`SELECT id, substr(waktu,12,8) AS jam, subjek, method, endpoint, device, hasil, alasan, status_code AS http
  FROM audit_log ${hanya ? 'WHERE hasil = ?' : ''} ORDER BY id DESC LIMIT ?`).all(...(hanya ? [hanya, n] : [n]));
console.table(rows.reverse());
