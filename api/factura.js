// Backend ARCA - Facturación Electrónica
// MartinezCrossa - Punto de Venta 00002

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://martinezcrossa-umber.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Por ahora devuelve OK - completar cuando llegue el certificado
  return res.status(200).json({ 
    status: 'ready',
    message: 'Backend ARCA listo. Esperando certificado digital.' 
  });
}
