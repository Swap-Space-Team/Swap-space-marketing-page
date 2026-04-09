import https from 'https';
import supabase from '../lib/supabase.js';

// Node.js 16-safe JSON fetch (no global fetch/Headers required)
function httpsGetJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects (exchangerate-api uses them)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGetJSON(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
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

// ─────────────────────────────────────────────────────────────
// Kaggle CSV column mapping → price keys stored in Supabase
// Dataset: "Cost of Living Around the World" by mvieira101
// ─────────────────────────────────────────────────────────────
// x1  = Meal, Inexpensive Restaurant
// x2  = Meal for 2 People, Mid-range Restaurant (three-course)
// x4  = Domestic Beer (0.5 liter draught), in Restaurants
// x6  = Cappuccino (regular)
// x28 = One-way Ticket (Local Transport)
// x41 = Cinema, International Release, 1 Seat
// x44 = 1 Bedroom Apartment in City Centre (monthly) — hotel proxy

const COL = {
  MEAL_CHEAP:        'x1',
  MEAL_MIDRANGE_2:   'x2',   // for 2 people — divide by 2 for per-person
  BEER:              'x4',
  COFFEE:            'x6',
  TRANSPORT_TICKET:  'x28',
  CINEMA:            'x41',
  RENT_1BR_CENTRE:   'x48',  // monthly rent (1BR city centre) — used to estimate hotel rate
};

// ─────────────────────────────────────────────────────────────
// Style presets
// ─────────────────────────────────────────────────────────────
const STYLE = {
  'budget': {
    label:               'Budget',
    hotelRentMultiplier: 1.8,  // hotel/night ≈ (monthly_rent / 30) × multiplier
    hotelMealFallback:   9,    // if no rent data: hotel ≈ cheap_meal × this
    mealsPerDay:         2.5,  // cheap meals per person per day
    midrangeMeals:       0,
    beersPerDay:         1.5,
    coffeesPerDay:       1,
    transportRides:      3,
    entertainmentFactor: 0.25,
  },
  'mid-range': {
    label:               'Mid-range',
    hotelRentMultiplier: 3.5,  // real hotels cost ~3-4× the daily rent equivalent
    hotelMealFallback:   18,
    mealsPerDay:         1.5,  // cheap meals + 1 mid-range dinner per person
    midrangeMeals:       1,
    beersPerDay:         2.5,
    coffeesPerDay:       2,
    transportRides:      4,
    entertainmentFactor: 0.5,
  },
  'comfortable': {
    label:               'Comfortable',
    hotelRentMultiplier: 6.0,  // 4-5★ hotels: 5-7× daily rent equivalent
    hotelMealFallback:   30,
    mealsPerDay:         0,
    midrangeMeals:       3,    // all mid-range meals
    beersPerDay:         3.5,
    coffeesPerDay:       2,
    transportRides:      2,    // fewer rides — taxis/rideshare instead
    entertainmentFactor: 0.8,
  },
};

// ─────────────────────────────────────────────────────────────
// Cost calculation (all prices assumed USD from DB)
// ─────────────────────────────────────────────────────────────
function calculateCosts(pm, nights, travellers, style) {
  const cfg = STYLE[style] || STYLE['mid-range'];

  // Pull prices — all amounts are in USD as stored from the Kaggle dataset
  const mealCheap    = pm[COL.MEAL_CHEAP]       || 10;
  const mealMid2     = pm[COL.MEAL_MIDRANGE_2]  || mealCheap * 5;
  const mealMidPP    = mealMid2 / 2;                           // per person
  const beer         = pm[COL.BEER]             || mealCheap * 0.4;
  const coffee       = pm[COL.COFFEE]           || mealCheap * 0.25;
  const transport    = pm[COL.TRANSPORT_TICKET] || mealCheap * 0.3;
  const cinema       = pm[COL.CINEMA]           || mealCheap * 0.9;
  const rent1br      = pm[COL.RENT_1BR_CENTRE]  || null;

  // Hotel rate per room per night
  const rentPerNight = rent1br ? rent1br / 30 : null;
  const hotelPerNight = rentPerNight
    ? rentPerNight * cfg.hotelRentMultiplier
    : mealCheap * cfg.hotelMealFallback;

  // Rooms: budget/mid → 2 per room, comfortable → 1 per room
  const rooms = style === 'comfortable'
    ? travellers
    : Math.max(1, Math.ceil(travellers / 2));

  // ── Accommodation ──
  const accommodation = hotelPerNight * rooms * nights;

  // ── Food ──
  const foodPerPersonPerDay = mealCheap * cfg.mealsPerDay + mealMidPP * cfg.midrangeMeals;
  const food = foodPerPersonPerDay * travellers * nights;

  // ── Drinks ──
  const drinksPerPersonPerDay = beer * cfg.beersPerDay + coffee * cfg.coffeesPerDay;
  const drinks = drinksPerPersonPerDay * travellers * nights;

  // ── Transport ──
  const transport_ = transport * cfg.transportRides * travellers * nights;

  // ── Entertainment ──
  const entertainment = cinema * cfg.entertainmentFactor * travellers * nights;

  const total = accommodation + food + drinks + transport_ + entertainment;

  return {
    total,
    breakdown: { accommodation, food, drinks, transport: transport_, entertainment },
    styleLabel: cfg.label,
  };
}

// ─────────────────────────────────────────────────────────────
// Supabase lookup — fuzzy city match
// ─────────────────────────────────────────────────────────────
async function getCityPrices(city, country) {
  const normalised = city.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const normalisedCountry = (country || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

  // 1. Exact city + country match (most precise — avoids London Canada vs London UK)
  if (normalisedCountry) {
    const { data: exact } = await supabase
      .from('city_costs')
      .select('price_map, city_name, country')
      .eq('city_query', normalised)
      .ilike('country', `%${normalisedCountry}%`)
      .maybeSingle();

    if (exact) return exact;
  }

  // 2. Exact city name only
  const { data: cityOnly } = await supabase
    .from('city_costs')
    .select('price_map, city_name, country')
    .eq('city_query', normalised)
    .order('country')   // deterministic ordering
    .limit(1)
    .maybeSingle();

  if (cityOnly) return cityOnly;

  // 3. Partial match fallback
  const { data: partial } = await supabase
    .from('city_costs')
    .select('price_map, city_name, country')
    .ilike('city_query', `%${normalised}%`)
    .order('city_query')
    .limit(1)
    .maybeSingle();

  if (partial) return partial;

  // 4. Country-level average — if city isn't in DB, average all cities in the same country
  if (normalisedCountry) {
    const { data: countryRows } = await supabase
      .from('city_costs')
      .select('price_map, city_name, country')
      .ilike('country', `%${normalisedCountry}%`)
      .limit(20);

    if (countryRows && countryRows.length > 0) {
      const cols = ['x1','x2','x4','x6','x28','x41','x48','x49','x54'];
      const avgMap = {};
      for (const col of cols) {
        const vals = countryRows
          .map(r => r.price_map && r.price_map[col])
          .filter(v => typeof v === 'number' && v > 0);
        if (vals.length) avgMap[col] = vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      if (Object.keys(avgMap).length > 0) {
        return {
          price_map:          avgMap,
          city_name:          city,
          country:            countryRows[0].country,
          isRegionalFallback: true,
        };
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// Exchange rates — Supabase cache → live fallback
// ─────────────────────────────────────────────────────────────
async function getExchangeRates() {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: cached } = await supabase
    .from('exchange_rates')
    .select('rates')
    .gte('fetched_at', cutoff)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cached?.rates) return cached.rates;

  // Fetch live (free, no key)
  try {
    const data = await httpsGetJSON('https://api.exchangerate-api.com/v4/latest/USD');
    const rates = data.rates || {};

    // Cache for next time (upsert row id=1)
    supabase
      .from('exchange_rates')
      .upsert({ id: 1, rates, fetched_at: new Date().toISOString() }, { onConflict: 'id' })
      .then(() => {})
      .catch(() => {});

    return rates;
  } catch (_) {
    // Rough static fallback so the calculator never fully breaks
    return {
      USD: 1,    EUR: 0.92, GBP: 0.79, CAD: 1.36, AUD: 1.53,
      CHF: 0.90, JPY: 149,  SGD: 1.34, HKD: 7.82, NZD: 1.64,
      SEK: 10.5, NOK: 10.7, DKK: 6.9,  MXN: 17.1, BRL: 4.97,
      ARS: 860,  ZAR: 18.6, AED: 3.67, THB: 35.1, INR: 83.1,
      KRW: 1327, IDR: 15700, MYR: 4.72, PHP: 56.3, TRY: 32.2,
      PLN: 3.99, CZK: 23.4, HUF: 358,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { city, country, nights, travellers, style, currency } = req.query;
  if (!city) return res.status(400).json({ error: 'Missing required parameter: city' });

  const nightsNum     = Math.max(1, Math.min(365, parseInt(nights)     || 7));
  const travellersNum = Math.max(1, Math.min(20,  parseInt(travellers) || 2));
  const selectedStyle = STYLE[style] ? style : 'mid-range';
  const selectedCurrency = (currency || 'USD').toUpperCase();

  try {
    // 1. Get city price data from Supabase
    const cityRow = await getCityPrices(city, country);
    if (!cityRow) {
      return res.status(404).json({
        error: `No data found for "${city}". Try a nearby major city, or check the spelling.`,
      });
    }

    // 2. Calculate in USD
    const result = calculateCosts(cityRow.price_map, nightsNum, travellersNum, selectedStyle);

    // 3. Convert to requested currency
    const rates = await getExchangeRates();
    const rate  = rates[selectedCurrency] || 1;
    const fx    = v => Math.round(v * rate);

    return res.status(200).json({
      success:            true,
      city:               `${cityRow.city_name}${cityRow.country ? ', ' + cityRow.country : ''}`,
      currency:           selectedCurrency,
      nights:             nightsNum,
      travellers:         travellersNum,
      style:              selectedStyle,
      styleLabel:         result.styleLabel,
      isRegionalFallback: cityRow.isRegionalFallback || false,
      total:              fx(result.total),
      breakdown: {
        accommodation: fx(result.breakdown.accommodation),
        food:          fx(result.breakdown.food),
        drinks:        fx(result.breakdown.drinks),
        transport:     fx(result.breakdown.transport),
        entertainment: fx(result.breakdown.entertainment),
      },
    });

  } catch (err) {
    console.error('Calculator costs error:', err);
    return res.status(500).json({ error: 'Could not calculate costs. Please try again.' });
  }
}
