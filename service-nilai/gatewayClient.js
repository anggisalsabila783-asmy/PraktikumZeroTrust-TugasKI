// Panggilan antar-service: Service Nilai -> GATEWAY (bukan langsung ke Service Transkrip)
const cfg = require('../shared/config');

let cache = null; // { token, exp }

async function ambilTokenService() {
  if (cache && cache.exp - Date.now() > 30_000) return cache.token; // pakai ulang sampai 30 dtk sebelum habis
  const res = await fetch(`${cfg.gatewayUrl}/auth/service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.serviceClientId, client_secret: cfg.serviceClientSecret }),
  });
  if (!res.ok) throw new Error(`Gagal mengambil token service (HTTP ${res.status})`);
  const data = await res.json();
  cache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cache.token;
}

async function sinkronTranskrip(payload) {
  const token = await ambilTokenService();
  const res = await fetch(`${cfg.gatewayUrl}/transkrip/sinkron`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sinkron transkrip ditolak (HTTP ${res.status}): ${body.reason || body.error || ''}`);
  return body;
}

module.exports = { sinkronTranskrip };
