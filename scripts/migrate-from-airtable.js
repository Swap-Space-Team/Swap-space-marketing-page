/**
 * One-time migration script: Airtable → Supabase
 *
 * Usage:
 *   1. Set these env vars (or create a .env file in the project root):
 *      - AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID
 *      - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   2. Run: node scripts/migrate-from-airtable.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchAllAirtableRecords() {
  const records = [];
  let offset = null;

  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`);
    if (offset) url.searchParams.set('offset', offset);

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` },
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Airtable fetch error: ${JSON.stringify(err)}`);
    }

    const data = await response.json();
    records.push(...data.records);
    offset = data.offset || null;

    console.log(`Fetched ${records.length} records so far...`);
  } while (offset);

  return records;
}

async function migrateRecord(record) {
  const f = record.fields;

  // Insert application
  const { data: app, error: insertError } = await supabase
    .from('applications')
    .insert({
      name: f.Name || null,
      email: f.Email || null,
      phone: f.Phone || null,
      address: f.Address || null,
      city: f.City || null,
      country: f.Country || null,
      home_type: f['Home Type'] || null,
      bedrooms: f.Bedrooms || null,
      guest_capacity: f['Guest Capacity'] || null,
      submission_date: f['Submission Date'] || null,
      application_status: f['Application Status'] || 'Photos Requested',
      approval_email_sent: f['Approval Email Sent'] || false,
      resend_photo_request: f['Resend Photo Request'] || false,
      airtable_record_id: record.id,
    })
    .select()
    .single();

  if (insertError) {
    console.error(`Failed to insert record ${record.id}:`, insertError.message);
    return { success: false, airtableId: record.id };
  }

  // Migrate photos (Airtable attachments)
  const photos = f.Photos || [];
  let photosOk = 0;

  for (const photo of photos) {
    try {
      // Download from Airtable
      const photoResponse = await fetch(photo.url);
      if (!photoResponse.ok) {
        console.error(`  Failed to download photo ${photo.filename} for ${record.id}`);
        continue;
      }

      const buffer = Buffer.from(await photoResponse.arrayBuffer());
      const storagePath = `${app.id}/${Date.now()}-${photo.filename}`;
      const contentType = photo.type || 'image/jpeg';

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase
        .storage
        .from('application-photos')
        .upload(storagePath, buffer, { contentType, upsert: false });

      if (uploadError) {
        console.error(`  Failed to upload photo ${photo.filename}:`, uploadError.message);
        continue;
      }

      // Insert photo metadata
      const { error: metaError } = await supabase
        .from('application_photos')
        .insert({
          application_id: app.id,
          storage_path: storagePath,
          original_filename: photo.filename,
          content_type: contentType,
        });

      if (metaError) {
        console.error(`  Failed to insert photo metadata:`, metaError.message);
        continue;
      }

      photosOk++;
    } catch (err) {
      console.error(`  Photo migration error for ${photo.filename}:`, err.message);
    }
  }

  return {
    success: true,
    airtableId: record.id,
    supabaseId: app.id,
    photosTotal: photos.length,
    photosMigrated: photosOk,
  };
}

async function main() {
  console.log('=== Airtable → Supabase Migration ===\n');

  // Validate env vars
  if (!AIRTABLE_TOKEN || !BASE_ID || !TABLE_ID) {
    console.error('Missing Airtable env vars (AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID)');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase env vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    process.exit(1);
  }

  // Step 1: Fetch all Airtable records
  console.log('Step 1: Fetching Airtable records...');
  const records = await fetchAllAirtableRecords();
  console.log(`Found ${records.length} records.\n`);

  if (records.length === 0) {
    console.log('No records to migrate. Done.');
    return;
  }

  // Step 2: Migrate each record
  console.log('Step 2: Migrating records...');
  const results = { success: 0, failed: 0, photosTotal: 0, photosMigrated: 0 };

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    console.log(`[${i + 1}/${records.length}] Migrating ${record.id} (${record.fields.Name || 'unnamed'})...`);

    const result = await migrateRecord(record);

    if (result.success) {
      results.success++;
      results.photosTotal += result.photosTotal;
      results.photosMigrated += result.photosMigrated;
      console.log(`  ✓ ${result.airtableId} → ${result.supabaseId} (${result.photosMigrated}/${result.photosTotal} photos)`);
    } else {
      results.failed++;
      console.log(`  ✗ ${result.airtableId} — FAILED`);
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  // Step 3: Summary
  console.log('\n=== Migration Complete ===');
  console.log(`Records: ${results.success} migrated, ${results.failed} failed (${records.length} total)`);
  console.log(`Photos:  ${results.photosMigrated} migrated of ${results.photosTotal} total`);

  // Step 4: Verify counts
  console.log('\nStep 3: Verifying...');
  const { count: dbCount } = await supabase
    .from('applications')
    .select('*', { count: 'exact', head: true });

  console.log(`Supabase applications count: ${dbCount}`);
  console.log(`Airtable records count: ${records.length}`);

  if (dbCount >= results.success) {
    console.log('Count verification passed.');
  } else {
    console.warn('WARNING: Count mismatch — verify manually.');
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
