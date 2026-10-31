// Menjalankan gateway + 2 service sekaligus: npm start
const { spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const daftar = ['service-transkrip/index.js', 'service-nilai/index.js', 'gateway/index.js'];
const anak = daftar.map((f) => spawn(process.execPath, [path.join(root, f)], { stdio: 'inherit', cwd: root }));
const stop = () => anak.forEach((a) => a.kill());
process.on('SIGINT', stop); process.on('SIGTERM', stop);
anak.forEach((a) => a.on('exit', (code) => { if (code) { console.error('Satu proses berhenti, mematikan semua.'); stop(); process.exit(code); } }));
