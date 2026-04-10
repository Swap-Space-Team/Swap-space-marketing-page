import https from 'https';

function httpsGetJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetJSON(res.headers.location).then(resolve).catch(reject);
      }
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Country code → currency code
const COUNTRY_CURRENCY = {
  US:'USD', GB:'GBP', AU:'AUD', CA:'CAD', NZ:'NZD', JP:'JPY', CH:'CHF',
  SE:'SEK', NO:'NOK', DK:'DKK', MX:'MXN', BR:'BRL', ZA:'ZAR', AE:'AED',
  TH:'THB', IN:'INR', KR:'KRW', SG:'SGD', HK:'HKD', ID:'IDR', MY:'MYR',
  PH:'PHP', TR:'TRY', PL:'PLN', CZ:'CZK', HU:'HUF', AR:'ARS',
  DE:'EUR', FR:'EUR', IT:'EUR', ES:'EUR', NL:'EUR', PT:'EUR', BE:'EUR',
  AT:'EUR', FI:'EUR', IE:'EUR', GR:'EUR', SK:'EUR', SI:'EUR', EE:'EUR',
  LV:'EUR', LT:'EUR', LU:'EUR', MT:'EUR', CY:'EUR', HR:'EUR',
};

// Detect private / loopback IPs (can't be geolocated)
const PRIVATE_IP = /^(::1|::ffff:127\.|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || '';

  // Local dev: private IP can't be geolocated — return null, let client use locale fallback
  if (!ip || PRIVATE_IP.test(ip)) {
    return res.status(200).json({ currency: null, country: null });
  }

  try {
    // api.country.is: free, no key, no rate limits, CORS-safe server-side call
    const data = await httpsGetJSON(`https://api.country.is/${ip}`);
    const countryCode = data?.country || null;
    const currency    = countryCode ? (COUNTRY_CURRENCY[countryCode] || null) : null;
    return res.status(200).json({ currency, country: countryCode });
  } catch (_) {
    return res.status(200).json({ currency: null, country: null });
  }
}
