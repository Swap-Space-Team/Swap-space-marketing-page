import multiparty from 'multiparty';
import fs from 'fs';
import supabase from './lib/supabase.js';

export const config = {
    api: {
        bodyParser: false,
    },
};

// Resolve the application ID — supports both UUIDs and legacy Airtable record IDs
async function resolveApplicationId(recordId) {
    // If it looks like an Airtable ID (starts with "rec"), look up by airtable_record_id
    if (recordId.startsWith('rec')) {
        const { data, error } = await supabase
            .from('applications')
            .select('id')
            .eq('airtable_record_id', recordId)
            .single();

        if (error || !data) {
            console.error('Could not resolve Airtable record ID:', recordId, error);
            return null;
        }
        return data.id;
    }
    return recordId;
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Missing Supabase environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        // Parse the multipart form data using multiparty
        const form = new multiparty.Form();

        const formData = await new Promise((resolve, reject) => {
            form.parse(req, function (err, fields, files) {
                if (err) reject(err);
                resolve({ fields, files });
            });
        });

        const rawRecordId = formData.fields.recordId ? formData.fields.recordId[0] : null;
        const updateStatus = formData.fields.updateStatus ? formData.fields.updateStatus[0] : null;
        const images = formData.files.images || [];

        if (!rawRecordId) {
            return res.status(400).json({ error: 'Missing recordId' });
        }

        // Resolve to UUID (handles legacy Airtable IDs)
        const applicationId = await resolveApplicationId(rawRecordId);
        if (!applicationId) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Mode 1: Upload a single image to Supabase Storage
        if (images.length > 0) {
            const file = images[0]; // Handle one image per request
            const fileBuffer = await fs.promises.readFile(file.path);
            const contentType = file.headers['content-type'] || 'image/jpeg';
            const filename = file.originalFilename || `photo-${Date.now()}.jpg`;

            // Sanitize filename — remove characters Supabase storage rejects
            const safeFilename = filename
                .replace(/[^a-zA-Z0-9._-]/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '') || 'photo';

            // Upload to Supabase Storage
            const storagePath = `${applicationId}/${Date.now()}-${safeFilename}`;
            console.log(`[upload-images] Uploading "${filename}" (${contentType}, ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB)`);

            const { error: uploadError } = await supabase
                .storage
                .from('application-photos')
                .upload(storagePath, fileBuffer, {
                    contentType,
                    upsert: false,
                });

            if (uploadError) {
                console.error(`[upload-images] FAILED "${filename}":`, uploadError);
                return res.status(500).json({ error: uploadError.message || 'Failed to upload image' });
            }

            // Insert photo metadata into DB
            const { error: insertError } = await supabase
                .from('application_photos')
                .insert({
                    application_id: applicationId,
                    storage_path: storagePath,
                    original_filename: filename,
                    content_type: contentType,
                });

            if (insertError) {
                console.error(`[upload-images] Failed to insert photo record:`, insertError);
                // Photo is uploaded but metadata failed — log but don't fail the request
            }

            console.log(`[upload-images] Successfully uploaded "${filename}"`);
            return res.status(200).json({ success: true, uploaded: filename });
        }

        // Mode 2: Update the "Application Status" to "Photos Received"
        if (updateStatus === 'true') {
            const { data: updateData, error: updateError } = await supabase
                .from('applications')
                .update({ application_status: 'Photos Received' })
                .eq('id', applicationId)
                .select()
                .single();

            if (updateError) {
                console.error('Supabase status update error:', updateError);
                return res.status(500).json({
                    error: updateError.message || 'Failed to update Application Status',
                });
            }

            console.log(`[upload-images] Application Status updated to "Photos Received" for ${applicationId}`);
            return res.status(200).json({
                success: true,
                recordId: updateData.id,
            });
        }

        return res.status(400).json({ error: 'No image or updateStatus provided' });

    } catch (error) {
        console.error('Server error processing image upload:', error);
        return res.status(500).json({ error: 'Internal server error processing upload' });
    }
};
