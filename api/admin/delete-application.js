import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ error: 'Missing applicationId' });

  // Fetch all photo storage paths for this application
  const { data: photos } = await supabase
    .from('application_photos')
    .select('storage_path')
    .eq('application_id', applicationId);

  // Delete files from storage
  if (photos && photos.length > 0) {
    const paths = photos.map(p => p.storage_path);
    const { error: storageError } = await supabase.storage
      .from('application-photos')
      .remove(paths);

    if (storageError) {
      console.error('[delete-application] Storage delete error:', storageError.message);
    }
  }

  // Delete the application row (cascades to application_photos via FK)
  const { error: dbError } = await supabase
    .from('applications')
    .delete()
    .eq('id', applicationId);

  if (dbError) {
    return res.status(500).json({ error: dbError.message });
  }

  return res.status(200).json({ success: true });
}
