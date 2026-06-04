import https from 'https';
import { createSign } from 'crypto';

// ── WSAA - Autenticación con ARCA ──
async function getTicketAcceso(cert, key, service) {
  const now = new Date();
  const from = new Date(now.getTime() - 60000).toISOString();
  const to = new Date(now.getTime() + 36000000).toISOString();
  const uniqueId = Math.floor(Math.random() * 2147483647);

  const cms = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${from}</generationTime>
    <expirationTime>${to}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;

  // Firmar con clave privada
  const sign = createSign('SHA256');
  sign.update(cms);
  const signature = sign.sign(key, 'base64');

  // Llamar al WSAA de ARCA (homologación o producción)
  const wsaaUrl = 'https://wsaa.afip.gov.ar/ws/services/LoginCms';
  
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${Buffer.from(cms).toString('base64')}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'SOAPAction': 'loginCms',
      }
    };
    
    const req = https.request(wsaaUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const tokenMatch = data.match(/<token>(.*?)<\/token>/s);
        const signMatch = data.match(/<sign>(.*?)<\/sign>/s);
        if (tokenMatch && signMatch) {
          resolve({ token: tokenMatch[1], sign: signMatch[1] });
        } else {
          reject(new Error('No se pudo obtener token: ' + data.substring(0, 500)));
        }
      });
    });
    req.on('error', reject);
    req.write(soapEnvelope);
    req.end();
  });
}

// ── WSFE - Emisión de factura ──
async function emitirFactura(auth, factura, cuit) {
  const wsfeUrl = 'https://servicios1.afip.gov.ar/wsfev1/service.asmx';
  
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECAESolicitar>
      <ar:Auth>
        <ar:Token>${auth.token}</ar:Token>
        <ar:Sign>${auth.sign}</ar:Sign>
        <ar:Cuit>${cuit}</ar:Cuit>
      </ar:Auth>
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${factura.puntoVenta}</ar:PtoVta>
          <ar:CbteTipo>${factura.tipoComprobante}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>1</ar:Concepto>
            <ar:DocTipo>${factura.docTipo || 80}</ar:DocTipo>
            <ar:DocNro>${factura.docNro || 0}</ar:DocNro>
            <ar:CbteDesde>${factura.nroComprobante}</ar:CbteDesde>
            <ar:CbteHasta>${factura.nroComprobante}</ar:CbteHasta>
            <ar:CbteFch>${factura.fecha}</ar:CbteFch>
            <ar:ImpTotal>${factura.total.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${factura.neto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>${factura.iva.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            <ar:Iva>
              <ar:AlicIva>
                <ar:Id>5</ar:Id>
                <ar:BaseImp>${factura.neto.toFixed(2)}</ar:BaseImp>
                <ar:Importe>${factura.iva.toFixed(2)}</ar:Importe>
              </ar:AlicIva>
            </ar:Iva>
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`;

  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=UTF-8',
        'SOAPAction': 'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
      }
    };

    const req = https.request(wsfeUrl, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const caeMatch = data.match(/<CAE>(.*?)<\/CAE>/);
        const caeFchMatch = data.match(/<CAEFchVto>(.*?)<\/CAEFchVto>/);
        const resultMatch = data.match(/<Resultado>(.*?)<\/Resultado>/);
        
        if (caeMatch && resultMatch[1] === 'A') {
          resolve({
            cae: caeMatch[1],
            vencimiento: caeFchMatch ? caeFchMatch[1] : '',
            resultado: 'A'
          });
        } else {
          const errMatch = data.match(/<ErrMsg>(.*?)<\/ErrMsg>/s);
          reject(new Error('ARCA error: ' + (errMatch ? errMatch[1] : data.substring(0, 500))));
        }
      });
    });
    req.on('error', reject);
    req.write(soapBody);
    req.end();
  });
}

// ── Handler principal ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const cert = process.env.ARCA_CERT;
  const key = process.env.ARCA_KEY;
  const cuit = process.env.ARCA_CUIT;
  const puntoVenta = parseInt(process.env.ARCA_PUNTO_VENTA);

  if (!cert || !key || !cuit) {
    return res.status(500).json({ error: 'Variables de entorno ARCA no configuradas' });
  }

  try {
    const { accion, factura } = req.body;

    if (accion === 'test') {
      return res.status(200).json({ ok: true, cuit, puntoVenta, mensaje: 'Configuracion OK' });
    }

    if (accion === 'emitir') {
      // Obtener token de autenticación
      const auth = await getTicketAcceso(cert, key, 'wsfe');
      
      // Emitir factura
      const resultado = await emitirFactura(auth, {
        ...factura,
        puntoVenta
      }, cuit);

      return res.status(200).json({ ok: true, ...resultado });
    }

    return res.status(400).json({ error: 'Accion no reconocida' });

  } catch (error) {
    console.error('Error ARCA:', error);
    return res.status(500).json({ error: error.message });
  }
}
  }
}
