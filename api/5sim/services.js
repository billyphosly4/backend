const axios = require('axios');

module.exports = async (req, res) => {
  const country = req.query.country || req.body.country;
  if (!country) return res.status(400).json({ error: 'country parameter is required' });

  try {
    const url = `https://5sim.net/v1/guest/prices?country=${encodeURIComponent(country)}`;
    const resp = await axios.get(url, { headers: { Accept: 'application/json' }, timeout: 10000 });
    return res.status(200).json(resp.data);
  } catch (err) {
    console.error('api/5sim/services error:', err.message || err);
    return res.status(502).json({ error: 'Could not fetch prices from 5sim', details: err.response?.data || err.message });
  }
};
