const https = require('https');

const FIREBASE_PROJECT = 'presupuesto-ia-594b9';
const FIREBASE_KEY = 'AIzaSyArUe9NXi6YMDvFCWStzgm0Yhn_wfUbF9o';

function firestoreGet(collection) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}?key=${FIREBASE_KEY}&pageSize=100`,
      method: 'GET'
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function parseFirestoreDoc(doc) {
  const fields = doc.fields || {};
  const result = { id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(fields)) {
    if (v.doubleValue !== undefined) result[k] = v.doubleValue;
    else if (v.integerValue !== undefined) result[k] = Number(v.integerValue);
    else if (v.stringValue !== undefined) result[k] = v.stringValue;
  }
  return result;
}

function buildPreciosContext(precios, calidad) {
  const key = calidad === 'premium' ? 'premium' : calidad === 'estándar' ? 'estandar' : 'media_alta';
  return precios.map(p => `- ${p.nombre} (${p.unidad}): ${p[key] || p.media_alta}€`).join('\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'API key not configured' });

  // Extraer calidad del body para filtrar precios
  const originalMessages = req.body.messages || [];
  const userContent = originalMessages[0]?.content || '';
  const calidadMatch = userContent.match(/Calidad de materiales: ([^\n]+)/);
  const calidad = calidadMatch ? calidadMatch[1].trim() : 'media_alta';

  // Consultar Firestore
  let preciosContext = '';
  try {
    const snapshot = await firestoreGet('precios_construccion');
    if (snapshot.documents) {
      const precios = snapshot.documents.map(parseFirestoreDoc);
      preciosContext = buildPreciosContext(precios, calidad);
    }
  } catch(e) {
    console.error('Firestore error:', e.message);
  }

  // Enriquecer el prompt con precios reales
  const enrichedMessages = originalMessages.map((msg, i) => {
    if (i === 0 && preciosContext) {
      return {
        ...msg,
        content: msg.content + `\n\nUSA EXACTAMENTE estos precios de mercado de la base de datos (no inventes otros):\n${preciosContext}\n\nSi una partida no está en la lista, estímala coherentemente con los precios de referencia proporcionados.`
      };
    }
    return msg;
  });

  const body = JSON.stringify({ ...req.body, messages: enrichedMessages });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const request = https.request(options, (response) => {
    let data = '';
    response.on('data', chunk => data += chunk);
    response.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        res.status(200).json(parsed);
      } catch(e) {
        res.status(200).json({ error: 'Parse error', raw: data.substring(0, 500) });
      }
    });
  });

  request.on('error', (err) => res.status(200).json({ error: err.message }));
  request.write(body);
  request.end();
}
