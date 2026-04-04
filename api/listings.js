import supabase from './lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [{ data: applications, error }, { data: photos }] = await Promise.all([
      supabase
        .from('applications')
        .select('id, name, city, country, home_type, bedrooms, guest_capacity, travel_dates')
        .eq('application_status', 'Approved')
        .order('created_at', { ascending: false }),
      supabase
        .from('application_photos')
        .select('application_id, storage_path')
        .order('uploaded_at', { ascending: true }),
    ]);

    if (error) return res.status(500).json({ error: error.message });

    // Build map of first photo path per application
    const firstPhoto = {};
    (photos || []).forEach(p => {
      if (!firstPhoto[p.application_id]) firstPhoto[p.application_id] = p.storage_path;
    });

    // Create signed URLs for the photos we need
    const appIds = (applications || []).map(a => a.id);
    const pathsToSign = appIds.map(id => firstPhoto[id]).filter(Boolean);
    const signedMap = {};

    if (pathsToSign.length > 0) {
      const { data: signedData } = await supabase.storage
        .from('application-photos')
        .createSignedUrls(pathsToSign, 3600);

      (signedData || []).forEach((item, i) => {
        if (item.signedUrl) signedMap[pathsToSign[i]] = item.signedUrl;
      });
    }

    const listings = (applications || [])
      .map(app => {
        const photoPath = firstPhoto[app.id];
        const photoUrl = photoPath ? (signedMap[photoPath] || null) : null;
        return {
          id: app.id,
          title: formatTitle(app.home_type, app.city),
          city: app.city,
          country: app.country,
          home_type: app.home_type,
          bedrooms: parseInt(app.bedrooms) || null,
          guest_capacity: parseInt(app.guest_capacity) || null,
          available_months: parseMonths(app.travel_dates),
          photo_url: photoUrl,
        };
      })
      .filter(l => l.photo_url);

    return res.status(200).json({ listings });
  } catch (err) {
    console.error('Listings error:', err);
    return res.status(500).json({ error: 'Failed to fetch listings' });
  }
}

function formatTitle(homeType, city) {
  const type = homeType
    ? homeType.charAt(0).toUpperCase() + homeType.slice(1).toLowerCase()
    : 'Home';
  return city ? `${type} in ${city}` : type;
}

function parseMonths(travelDates) {
  if (!travelDates) return [];
  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  return MONTHS.filter(m => travelDates.includes(m));
}
