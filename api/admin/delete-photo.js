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

  const { photoId, storagePath } = req.body;
  if (!photoId || !storagePath) {
    return res.status(400).json({ error: 'Missing photoId or storagePath' });
  }

  // Delete from storage (log error but don't fail if file is already gone)
  const { error: storageError } = await supabase.storage
    .from('application-photos')
    .remove([storagePath]);

  if (storageError) {
    console.error('[delete-photo] Storage delete error:', storageError.message);
  }

  // Delete metadata row
  const { error: dbError } = await supabase
    .from('application_photos')
    .delete()
    .eq('id', photoId);

  if (dbError) {
    return res.status(500).json({ error: dbError.message });
  }

  return res.status(200).json({ success: true });
}
