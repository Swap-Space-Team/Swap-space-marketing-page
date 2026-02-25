import multiparty from 'multiparty';
import fs from 'fs';

// No bodyParser config needed — multiparty handles raw request body on Vercel too
export const config = {
    api: {
        bodyParser: false,
    },
};

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

    const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

    if (!AIRTABLE_TOKEN || !BASE_ID || !TABLE_ID) {
        console.error('Missing Airtable environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        // Parse the multipart form data using multiparty
        const form = new multiparty.Form();

        const data = await new Promise((resolve, reject) => {
            form.parse(req, function (err, fields, files) {
                if (err) reject(err);
                resolve({ fields, files });
            });
        });

        const recordId = data.fields.recordId ? data.fields.recordId[0] : null;
        const images = data.files.images || [];

        if (!recordId) {
            return res.status(400).json({ error: 'Missing recordId' });
        }

        if (images.length === 0) {
            return res.status(400).json({ error: 'No images uploaded' });
        }

        // 1. Upload each image directly to Airtable's Attachment Upload API
        //    The uploadAttachment endpoint expects JSON with base64-encoded file bytes.
        for (const file of images) {
            const fileBuffer = fs.readFileSync(file.path);
            const contentType = file.headers['content-type'] || 'image/jpeg';
            const filename = file.originalFilename || `photo-${Date.now()}.jpg`;
            const base64Content = fileBuffer.toString('base64');

            const uploadUrl = `https://content.airtable.com/v0/${BASE_ID}/${recordId}/Photos/uploadAttachment`;
            console.log(`[upload-images] Uploading "${filename}" (${contentType}) to: ${uploadUrl}`);

            const uploadRes = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contentType,
                    filename,
                    file: base64Content,
                }),
            });

            if (!uploadRes.ok) {
                const rawText = await uploadRes.text();
                console.error(`[upload-images] FAILED (${uploadRes.status}): ${rawText}`);
                let errData = {};
                try { errData = JSON.parse(rawText); } catch (e) { }
                const errMsg = typeof errData.error === 'string'
                    ? errData.error
                    : errData.error?.message || errData.error?.type || JSON.stringify(errData.error) || `Airtable returned ${uploadRes.status}`;
                return res.status(uploadRes.status).json({ error: errMsg });
            }

            console.log(`[upload-images] Successfully uploaded "${filename}"`);
        }

        // 2. Update the "Application Status" field to "Photos Received" via the standard REST API
        const updateResponse = await fetch(
            `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${recordId}`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    fields: {
                        'Application Status': 'Photos Received',
                    },
                }),
            }
        );

        const updateData = await updateResponse.json();

        if (!updateResponse.ok) {
            console.error('Airtable status update error:', updateData);
            return res.status(updateResponse.status).json({
                error: updateData.error?.message || 'Failed to update Application Status',
            });
        }

        return res.status(200).json({
            success: true,
            recordId: updateData.id,
            uploadedPhotos: images.length,
        });

    } catch (error) {
        console.error('Server error processing image upload:', error);
        return res.status(500).json({ error: 'Internal server error processing upload' });
    }
};


