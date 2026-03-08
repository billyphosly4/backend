const axios = require('axios');

module.exports = async (req, res) => {
  const country = req.query.country || req.body.country;
  const operator = req.query.operator || req.body.operator;
  const product = req.query.product || req.body.product;

  if (!country || !operator || !product) return res.status(400).json({ error: 'country, operator, product are required' });

  const KEY = process.env.FIVESIM_PROTOCOL_KEY || process.env.FIVESIM_API_KEY || null;
  if (!KEY) return res.status(500).json({ error: '5sim API key not configured on server' });

  try {
    const path = `/v1/user/buy/activation/${encodeURIComponent(country)}/${encodeURIComponent(operator)}/${encodeURIComponent(product)}`;
    const url = `https://5sim.net${path}`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, timeout: 20000 });
    
    // Apply 40% profit margin
    const data = resp.data;
    if (data.price) {
      data.cost_price = data.price;
      data.profit_margin = parseFloat((data.price * 0.40).toFixed(2));
      data.price = parseFloat((data.price * 1.40).toFixed(2));
    }
    
    return res.status(200).json(data);
  } catch (err) {
    console.error('api/5sim/buy error:', err.response?.status, err.response?.data || err.message || err);
    return res.status(502).json({ error: 'Could not complete purchase on 5sim', details: err.response?.data || err.message });
  }
};
