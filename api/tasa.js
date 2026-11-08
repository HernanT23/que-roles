// Devuelve la tasa oficial del BCV (Bs por USD). Se guarda en caché 10 minutos.
import https from 'node:https';

function get(url, agent) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, timeout: 7000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () =>
        res.statusCode >= 200 && res.statusCode < 300 ? resolve(body) : reject(new Error('HTTP ' + res.statusCode))
      );
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Fuente 1: la página oficial del BCV (su certificado llega incompleto, por eso se relaja la verificación solo aquí).
async function fromBcv() {
  const html = await get('https://www.bcv.org.ve/', new https.Agent({ rejectUnauthorized: false }));
  const block = html.match(/id="dolar"[\s\S]*?<strong>\s*([\d.,]+)\s*<\/strong>/);
  if (!block) throw new Error('BCV: formato no reconocido');
  const rate = parseFloat(block[1].replace(/\./g, '').replace(',', '.'));
  const f = html.match(/Fecha Valor[\s\S]*?content="(\d{4}-\d{2}-\d{2})/);
  return { rate, date: f ? f[1] : null, source: 'bcv.org.ve' };
}

// Fuente 2 (respaldo): API pública con la tasa oficial.
async function fromDolarApi() {
  const j = JSON.parse(await get('https://ve.dolarapi.com/v1/dolares/oficial'));
  const rate = Number(j.promedio);
  return { rate, date: (j.fechaActualizacion || '').slice(0, 10) || null, source: 've.dolarapi.com' };
}

export default async function handler(req, res) {
  let out = null;
  for (const src of [fromBcv, fromDolarApi]) {
    try {
      const r = await src();
      if (r.rate > 1 && r.rate < 100000) { out = r; break; }
    } catch (e) { /* prueba la siguiente fuente */ }
  }
  if (!out) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'No se pudo leer la tasa' });
  }
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  res.status(200).json(out);
}
