module.exports = function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    return res.status(500).json({ error: 'Konfigurasi login belum lengkap.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY
  });
};
