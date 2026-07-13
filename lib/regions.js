// Geographic auto-approval config.
//
// A single, auditable source of truth for which countries are eligible for
// automatic approval. Everything else falls through to the existing manual
// review pile. Codes are ISO 3166-1 alpha-2 (uppercase).

// North America (US + Canada). Mexico is deliberately excluded.
const NORTH_AMERICA = ['US', 'CA'];

// United Kingdom.
const UK = ['GB'];

// "Europe" per product definition: EU-27 + EEA + Switzerland + Balkans + Turkey.
// Deliberately EXCLUDES Russia (RU) and Belarus (BY).
const EUROPE = [
  // EU-27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
  // EEA (non-EU)
  'IS', 'LI', 'NO',
  // Switzerland
  'CH',
  // Balkans (non-EU)
  'AL', 'BA', 'RS', 'ME', 'MK', 'XK',
  // Turkey
  'TR',
];

// Region lookup — used for the stored `region` column and telemetry.
const REGION_BY_CODE = new Map();
NORTH_AMERICA.forEach((c) => REGION_BY_CODE.set(c, 'North America'));
UK.forEach((c) => REGION_BY_CODE.set(c, 'UK'));
EUROPE.forEach((c) => REGION_BY_CODE.set(c, 'Europe'));

// Full set of auto-approvable ISO codes.
export const ALLOWED_ISO = new Set([...NORTH_AMERICA, ...UK, ...EUROPE]);

// Normalise an incoming country code to uppercase alpha-2, or null.
function normalise(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const code = iso.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

// 'North America' | 'UK' | 'Europe' | 'Other'
export function regionForCountry(iso) {
  const code = normalise(iso);
  return (code && REGION_BY_CODE.get(code)) || 'Other';
}

// Whether an application from this country should be auto-approved.
export function isAutoApprovable(iso) {
  const code = normalise(iso);
  return !!code && ALLOWED_ISO.has(code);
}
