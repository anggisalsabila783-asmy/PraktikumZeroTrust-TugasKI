// Verifikasi konteks: jam akses (4.3). Rentang diatur lewat .env
const cfg = require('./config');

function keMenit(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Format jam salah: "${hhmm}" (gunakan HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function menitSekarang(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

// awal inklusif, akhir eksklusif. Mendukung rentang lewat tengah malam (mis. 22:00-06:00).
function dalamJamAkses(date = new Date()) {
  const mulai = keMenit(cfg.accessStart);
  const akhir = keMenit(cfg.accessEnd);
  const now = menitSekarang(date, cfg.accessTimezone);
  return mulai <= akhir ? now >= mulai && now < akhir : now >= mulai || now < akhir;
}

function infoJamAkses() {
  return `${cfg.accessStart}-${cfg.accessEnd} ${cfg.accessTimezone}`;
}

module.exports = { dalamJamAkses, infoJamAkses };
