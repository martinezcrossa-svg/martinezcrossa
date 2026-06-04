import https from 'https';

function fixPem(pem) {
  return pem.replace(/\\n/g, '\n').trim();
}

function soapReq(url, action, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'SOAPAction': action,
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body, 'utf8');
    req.end();
  });
}

async function getTicket(certPem, keyPem, service) {
  const forge = (await import('node-forge')).default;
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}-03:00`;
  const ar = new Date(now.getTime() - 3*60*60*1000);
  const from = fmt(new Date(ar.getTime() - 60000));
  const to = fmt(new Date(ar.getTime() + 36000000));
  const uid = Math.floor(Math.random() * 2000000000);
  const tra = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uid}</uniqueId><generationTime>${from}</generationTime><expirationTime>${to}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [] });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const cms = Buffer.from(der, 'binary').toString('base64');
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  const resp = await soapReq('https://wsaa.afip.gov.ar/ws/services/LoginCms', '"loginCms"', soap);
  // Decode HTML entities in response (ARCA returns escaped XML inside loginCmsReturn)
  const decoded = resp.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"');
  const tok = decoded.match(/<token>([\s\S]*?)<\/token>/);
  const sig = decoded.match(/<sign>([\s\S]*?)<\/sign>/);
  if (!tok || !sig) throw new Error('WSAA error: ' + resp.substring(0,400));
  return { token: tok[1].trim(), sign: sig[1].trim() };
}

async function getUltimoNro(auth, cuit, ptoVta, tipo) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Body><ar:FECompUltimoAutorizado><ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth><ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado></soapenv:Body></soapenv:Envelope>`;
  const resp = await soapReq('https://servicios1.afip.gov.ar/wsfev1/service.asmx', '"http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado"', soap);
  const m = resp.match(/<CbteNro>(\d+)<\/CbteNro>/);
  return m ? parseInt(m[1]) : 0;
}

async function solicitarCAE(auth, cuit, f) {
  const soap = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Body><ar:FECAESolicitar><ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth><ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${f.ptoVta}</ar:PtoVta><ar:CbteTipo>${f.tipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>1</ar:Concepto><ar:DocTipo>${f.docTipo}</ar:DocTipo><ar:DocNro>${f.docNro}</ar:DocNro><ar:CbteDesde>${f.nro}</ar:CbteDesde><ar:CbteHasta>${f.nro}</ar:CbteHasta><ar:CbteFch>${f.fecha}</ar:CbteFch><ar:ImpTotal>${f.total.toFixed(2)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${f.neto.toFixed(2)}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpIVA>${f.iva.toFixed(2)}</ar:ImpIVA><ar:ImpTrib>0.00</ar:ImpTrib><ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:Iva><ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>${f.neto.toFixed(2)}</ar:BaseImp><ar:Importe>${f.iva.toFixed(2)}</ar:Importe></ar:AlicIva></ar:Iva></ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>`;
  const resp = await soapReq('https://servicios1.afip.gov.ar/wsfev1/service.asmx', '"http://ar.gov.afip.dif.FEV1/FECAESolicitar"', soap);
  const caeM = resp.match(/<CAE>([\s\S]*?)<\/CAE>/);
  const fchM = resp.match(/<CAEFchVto>([\s\S]*?)<\/CAEFchVto>/);
  const resM = resp.match(/<Resultado>([\s\S]*?)<\/Resultado>/);
  const errM = resp.match(/<Msg>([\s\S]*?)<\/Msg>/g);
  if (caeM && resM && resM[1].trim() === 'A') return { cae: caeM[1].trim(), vencimiento: fchM ? fchM[1].trim() : '' };
  const msgs = errM ? errM.map(m => m.replace(/<\/?Msg>/g,'')).join(' | ') : resp.substring(0,400);
  throw new Error('CAE rechazado: ' + msgs);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const cert = fixPem(process.env.ARCA_CERT || '');
  const key = fixPem(process.env.ARCA_KEY || '');
  const cuit = process.env.ARCA_CUIT;
  const ptoVta = parseInt(process.env.ARCA_PUNTO_VENTA);

  if (!cert || !key) return res.status(500).json({ error: 'Certificados no configurados' });

  try {
    const { accion, factura } = req.body || {};
    if (accion === 'test') return res.status(200).json({ ok: true, cuit, ptoVta, certOk: cert.includes('BEGIN CERTIFICATE'), keyOk: key.includes('BEGIN') });
    if (accion === 'emitir') {
      const auth = await getTicket(cert, key, 'wsfe');
      const ultimoNro = await getUltimoNro(auth, cuit, ptoVta, factura.tipoComprobante);
      const nro = ultimoNro + 1;
      const resultado = await solicitarCAE(auth, cuit, { ptoVta, tipo: factura.tipoComprobante, nro, fecha: factura.fecha, total: factura.total, neto: factura.neto, iva: factura.iva, docTipo: factura.docTipo || 99, docNro: factura.docNro || 0 });
      return res.status(200).json({ ok: true, nroComprobante: nro, ...resultado });
    }
    return res.status(400).json({ error: 'Accion no reconocida' });
  } catch(e) {
    console.error('Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
