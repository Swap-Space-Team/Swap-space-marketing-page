/**
 * Import Kaggle "Cost of Living Around the World" dataset into Supabase
 *
 * Dataset: https://www.kaggle.com/datasets/mvieira101/global-cost-of-living
 *
 * Usage:
 *   1. Download the dataset from Kaggle → save the CSV file
 *   2. Run: node scripts/import-city-costs.js /path/to/cost-of-living_v2.csv
 *
 * The script will upsert all rows into the city_costs table.
 * Safe to re-run — it will update existing rows, not duplicate them.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────
// Columns we extract from the Kaggle CSV (all prices in USD)
// These map to Numbeo's item numbering used in the dataset.
// ─────────────────────────────────────────────────────────────
const PRICE_COLUMNS = [
  'x1',   // Meal, Inexpensive Restaurant
  'x2',   // Meal for 2 People, Mid-range Restaurant, Three-course
  'x3',   // McMeal at McDonalds (or Equivalent Combo Meal)
  'x4',   // Domestic Beer (0.5 liter draught), in Restaurants
  'x5',   // Imported Beer (0.33 liter bottle), in Restaurants
  'x6',   // Cappuccino (regular)
  'x7',   // Coke/Pepsi (0.33 liter bottle)
  'x8',   // Water (0.33 liter bottle)
  'x28',  // One-way Ticket (Local Transport)
  'x29',  // Monthly Pass (Regular Price)
  'x30',  // Taxi Start (Normal Tariff)
  'x31',  // Taxi 1km (Normal Tariff)
  'x41',  // Cinema, International Release, 1 Seat
  'x48',  // Apartment (1 bedroom) in City Centre, monthly — hotel proxy
  'x49',  // Apartment (1 bedroom) Outside of Centre, monthly
  'x54',  // Average Monthly Net Salary (After Tax)
];

// ─────────────────────────────────────────────────────────────
// CSV parser (handles quoted fields, no external deps required)
// ─────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Handle escaped quotes ("")
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(content) {
  // Normalise Windows line endings
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const headers = parseCSVLine(lines[0]);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

// ─────────────────────────────────────────────────────────────
// Normalise city name for search key
// ─────────────────────────────────────────────────────────────
function normaliseCityQuery(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')  // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/import-city-costs.js /path/to/cost-of-living_v2.csv');
    process.exit(1);
  }

  const resolvedPath = path.resolve(csvPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.');
    process.exit(1);
  }

  console.log(`Reading ${resolvedPath}…`);
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const { headers, rows } = parseCSV(content);

  console.log(`Parsed ${rows.length} rows. Headers: ${headers.join(', ')}\n`);

  // Validate that expected columns exist
  const hasCityCol    = headers.includes('city');
  const hasCountryCol = headers.includes('country');
  const missingPriceCols = PRICE_COLUMNS.filter(c => !headers.includes(c));

  if (!hasCityCol) {
    console.error('ERROR: CSV has no "city" column. Check the file format.');
    process.exit(1);
  }
  if (missingPriceCols.length > 0) {
    console.warn(`WARNING: Missing expected price columns: ${missingPriceCols.join(', ')}`);
    console.warn('These will be stored as null. The calculator will use fallback estimates for them.\n');
  }

  // Build upsert records
  const records = [];
  let skipped = 0;

  for (const row of rows) {
    const cityName    = (row['city'] || '').trim();
    const countryName = (row['country'] || '').trim();

    if (!cityName) { skipped++; continue; }

    // Only keep numeric prices for the columns we care about
    const priceMap = {};
    for (const col of PRICE_COLUMNS) {
      if (headers.includes(col) && row[col] !== '' && row[col] !== undefined) {
        const val = parseFloat(row[col]);
        if (!isNaN(val) && val > 0) {
          priceMap[col] = val;
        }
      }
    }

    // Skip rows with no price data at all
    if (Object.keys(priceMap).length === 0) {
      skipped++;
      continue;
    }

    records.push({
      city_query:  normaliseCityQuery(cityName),
      city_name:   cityName,
      country:     countryName || '',
      price_map:   priceMap,
      fetched_at:  new Date().toISOString(),
    });
  }

  console.log(`Prepared ${records.length} records (skipped ${skipped} empty/invalid rows).`);

  // Upsert in batches of 100
  const BATCH_SIZE = 100;
  let inserted = 0;
  let failed   = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    const { error } = await supabase
      .from('city_costs')
      .upsert(batch, { onConflict: 'city_query,country' });

    if (error) {
      console.error(`Batch ${batchNum}/${totalBatches} FAILED: ${error.message}`);
      failed += batch.length;
    } else {
      inserted += batch.length;
      process.stdout.write(`\rBatch ${batchNum}/${totalBatches} — ${inserted} rows inserted`);
    }
  }

  console.log('\n');
  console.log('─'.repeat(50));
  console.log(`✅ Done! ${inserted} cities imported, ${failed} failed, ${skipped} skipped.`);

  if (failed > 0) {
    console.log('\nSome batches failed. Check the errors above and re-run if needed.');
  }

  // Quick verification
  const { count } = await supabase
    .from('city_costs')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal rows now in city_costs table: ${count}`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
