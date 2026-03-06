const axios = require('axios');

module.exports = async (req, res) => {
  try {
    const url = 'https://5sim.net/v1/guest/countries';
    const resp = await axios.get(url, { headers: { Accept: 'application/json' }, timeout: 10000 });
    return res.status(200).json(resp.data);
  } catch (err) {
    console.error('api/5sim/countries error:', err.message || err);
    return res.status(502).json({ error: 'Could not fetch countries from 5sim', details: err.response?.data || err.message });
  }
};
