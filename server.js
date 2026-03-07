// backend/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Dynamic CORS for development & production
const allowedOrigins = [
  'http://localhost:5173',        // Vite dev
  'http://localhost:3000',        // React dev
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://prime-sms-hub-react.vercel.app',  // Vercel production
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])  // Vercel frontend from env
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// ==================== 5SIM MOCK DATA ====================
// Mock countries - 5sim API returns: {country: {iso: {code: 1}, prefix: {+prefix: 1}, text_en: "Name", operator: {category: 1}}}
const mockCountries = {
  russia: { iso: { ru: 1 }, prefix: { '+7': 1 }, text_en: 'Russia', facebook: { activation: 1 }, telegram: { activation: 1 } },
  ukraine: { iso: { ua: 1 }, prefix: { '+380': 1 }, text_en: 'Ukraine', facebook: { activation: 1 }, telegram: { activation: 1 } },
  kazakhstan: { iso: { kz: 1 }, prefix: { '+7': 1 }, text_en: 'Kazakhstan', facebook: { activation: 1 }, telegram: { activation: 1 } },
  usa: { iso: { us: 1 }, prefix: { '+1': 1 }, text_en: 'United States', facebook: { activation: 1 }, telegram: { activation: 1 } },
  britain: { iso: { gb: 1 }, prefix: { '+44': 1 }, text_en: 'United Kingdom', facebook: { activation: 1 }, telegram: { activation: 1 } },
  kenya: { iso: { ke: 1 }, prefix: { '+254': 1 }, text_en: 'Kenya', facebook: { activation: 1 }, telegram: { activation: 1 } },
  nigeria: { iso: { ng: 1 }, prefix: { '+234': 1 }, text_en: 'Nigeria', facebook: { activation: 1 }, telegram: { activation: 1 } },
  germany: { iso: { de: 1 }, prefix: { '+49': 1 }, text_en: 'Germany', facebook: { activation: 1 }, telegram: { activation: 1 } }
};

// Mock prices - 5sim API returns: {country: {product: {operator: {cost: x, count: y, rate: z}}}}
const mockPrices = {
  russia: {
    facebook: { virtual1: { cost: 3.5, count: 100, rate: 99.5 }, mts: { cost: 3.8, count: 50 } },
    telegram: { virtual1: { cost: 2.5, count: 200, rate: 99.9 }, mts: { cost: 2.8, count: 150 } }
  },
  kenya: {
    facebook: { safaricom: { cost: 4.5, count: 80 }, airtel: { cost: 4.2, count: 60 } },
    telegram: { safaricom: { cost: 3.5, count: 120 }, airtel: { cost: 3.2, count: 90 } }
  }
};

// Helper to call 5sim API with protocol key (no auth needed for /guest endpoints)
const FIVESIM_BASE = process.env.FIVESIM_BASE_URL || 'https://5sim.net/v1';
const PROTO_KEY = process.env.FIVESIM_PROTOCOL_KEY || process.env.FIVESIM_KEY || process.env.FIVESIM_API_KEY || process.env['5SIM_API_KEY'] || null;
const OLD_KEY = process.env.FIVESIM_OLD_KEY || null;

console.log('🔑 5sim Configuration:', {
  BASE_URL: FIVESIM_BASE,
  PROTO_KEY: PROTO_KEY ? PROTO_KEY.slice(0, 10) + '...' : 'NOT SET',
  OLD_KEY: OLD_KEY ? 'SET' : 'NOT SET'
});

async function call5sim(path, opts = {}) {
  const url = FIVESIM_BASE + path;
  const params = opts.params || {};
  const data = opts.data || undefined;
  const requiresAuth = opts.requiresAuth !== false; // Default true for /user/* endpoints

  async function tryRequest(key) {
    const headers = { 'Accept': 'application/json' };
    if (requiresAuth && key) {
      headers['Authorization'] = `Bearer ${key}`;
    }
    console.log(`📡 5sim: ${opts.method || 'GET'} ${url}`, { requiresAuth, keyPresent: !!key });
    return axios({
      url,
      method: opts.method || 'get',
      params,
      data,
      headers,
      timeout: 5000  // Reduced from 15000 to fail faster and use fallback
    });
  }

  // For public endpoints, don't require auth
  if (!requiresAuth) {
    try {
      return await tryRequest(null);
    } catch (err) {
      console.error('❌ 5sim error:', err.response?.status, err.response?.data?.error || err.message);
      throw err;
    }
  }

  // For protected endpoints, try with keys
  if (PROTO_KEY) {
    try {
      return await tryRequest(PROTO_KEY);
    } catch (err) {
      if (OLD_KEY && err.response && [401, 403].includes(err.response.status)) {
        console.warn('⚠️ Auth error, trying fallback key...');
        return await tryRequest(OLD_KEY);
      }
      console.error('❌ 5sim error:', err.response?.status, err.response?.data || err.message);
      throw err;
    }
  }

  if (OLD_KEY) {
    return await tryRequest(OLD_KEY);
  }

  // No keys for protected endpoint
  console.warn('⚠️ No 5sim API key configured for protected endpoint');
  const e = new Error('No 5sim API key configured');
  e.code = 'NO_KEY';
  throw e;
}

app.get('/api/5sim/countries', async (req, res) => {
  try {
    // 5sim endpoint: GET /v1/guest/countries (public, no auth)
    const resp = await call5sim('/guest/countries', { requiresAuth: false });
    console.log('✅ 5sim countries loaded successfully');
    return res.json(resp.data);
  } catch (err) {
    console.warn('⚠️ 5sim countries fetch failed, using mock:', err.message);
    return res.json(mockCountries);
  }
});

// Fast mock endpoint - always returns mock data instantly (no 5sim call)
app.get('/api/mock/countries', (req, res) => {
  console.log('📦 Returning mock countries (instant, no 5sim call)');
  return res.json(mockCountries);
});

app.get('/api/5sim/key-status', (req, res) => {
  res.json({
    protocolConfigured: !!PROTO_KEY,
    oldConfigured: !!OLD_KEY,
    note: 'Keys are not exposed. This endpoint only reports whether keys are configured.'
  });
});

// Get prices/services for a country and optionally by product
// 5sim endpoint: GET /v1/guest/prices?country=$country or ?country=$country&product=$product (public, no auth)
app.get('/api/5sim/services', async (req, res) => {
  const { country, product } = req.query;

  if (!country) {
    return res.status(400).json({ error: 'country parameter required' });
  }

  console.log(`📱 5sim prices request: country=${country}, product=${product}`);

  try {
    const params = { country };
    if (product) params.product = product;

    const resp = await call5sim('/guest/prices', { params, requiresAuth: false });
    console.log(`✅ 5sim prices response received`);

    // 5sim returns: {country: {product: {operator: {cost, count, rate}}}}
    // Extract and format for frontend
    const data = resp.data || {};
    const countryData = data[country] || {};

    return res.json({
      country,
      products: countryData,
      operators: Object.keys(countryData[product] || {})
    });
  } catch (err) {
    console.warn(`⚠️ 5sim prices failed (${country}), using mock:`, err.message);
    const mockData = mockPrices[country] || {};
    return res.json({
      country,
      products: mockData,
      operators: Object.keys(mockData[product] || {})
    });
  }
});

// Buy a number (requires authentication)
// 5sim endpoint: GET /v1/user/buy/activation/$country/$operator/$product
app.post('/api/5sim/buy', async (req, res) => {
  const { country, operator, product } = req.body;

  if (!country || !operator || !product) {
    return res.status(400).json({ error: 'country, operator, and product are required' });
  }

  console.log(`💳 5sim buy request: ${country}/${operator}/${product}`);

  try {
    // Use GET with path params (as per 5sim docs)
    const path = `/user/buy/activation/${country}/${operator}/${product}`;
    const resp = await call5sim(path, { requiresAuth: true });

    console.log(`✅ 5sim buy successful: ${resp.data.id}`);
    return res.json(resp.data);
  } catch (err) {
    console.error('❌ 5sim buy error:', err.response?.status, err.response?.data?.error || err.message);

    // Return actual error instead of mock - let frontend know the purchase failed
    return res.status(err.response?.status || 500).json({
      error: err.response?.data?.error || 'Failed to purchase number from 5sim. Please check API credentials and try again.',
      details: err.message
    });
  }
});

// Check order / Get SMS (requires authentication)
// 5sim endpoint: GET /v1/user/check/$id
app.get('/api/5sim/check/:id', async (req, res) => {
  const { id } = req.params;

  console.log(`📨 5sim check order: ${id}`);

  try {
    const resp = await call5sim(`/user/check/${id}`, { requiresAuth: true });
    console.log(`✅ 5sim check response: ${resp.data.status} with ${(resp.data.sms || []).length} SMS`);
    return res.json(resp.data);
  } catch (err) {
    console.warn(`⚠️ 5sim check failed (${id}):`, err.message);

    // Return mock
    return res.json({
      id: parseInt(id),
      phone: '+1234567890',
      product: 'facebook',
      price: 3.5,
      status: 'PENDING',
      sms: [],
      created_at: new Date().toISOString()
    });
  }
});

// Alternative endpoint for checking SMS (some frontends may use this)
app.get('/api/5sim/check-sms/:id', async (req, res) => {
  const { id } = req.params;
  // Redirect to check endpoint
  try {
    const resp = await call5sim(`/user/check/${id}`, { requiresAuth: true });
    return res.json({ sms: resp.data.sms || [], status: resp.data.status });
  } catch (err) {
    console.warn(`⚠️ 5sim check-sms failed (${id}):`, err.message);
    return res.json({ sms: [], status: 'PENDING' });
  }
});

// ==================== SEARCH ENDPOINTS ====================
// Search countries by name/code
app.get('/api/5sim/search/countries', async (req, res) => {
  const { q } = req.query;

  try {
    const resp = await call5sim('/guest/countries', { requiresAuth: false });
    let countries = resp.data || mockCountries;

    if (q) {
      const query = q.toLowerCase();
      const filtered = {};

      for (const [code, data] of Object.entries(countries)) {
        const text = (data.text_en || '').toLowerCase();
        const prefix = Object.keys(data.prefix || {})[0] || '';

        if (
          code.toLowerCase().includes(query) ||
          text.includes(query) ||
          prefix.includes(query)
        ) {
          filtered[code] = data;
        }
      }

      console.log(`🔍 Search countries: "${q}" → ${Object.keys(filtered).length} results`);
      return res.json(filtered);
    }

    return res.json(countries);
  } catch (err) {
    console.warn('⚠️ Country search failed:', err.message);
    
    if (q) {
      const query = q.toLowerCase();
      const filtered = {};

      for (const [code, data] of Object.entries(mockCountries)) {
        const text = (data.text_en || '').toLowerCase();
        if (code.toLowerCase().includes(query) || text.includes(query)) {
          filtered[code] = data;
        }
      }

      return res.json(filtered);
    }

    return res.json(mockCountries);
  }
});

// Search services/prices with filters
app.get('/api/5sim/search/services', async (req, res) => {
  const { country, product, operator, minPrice, maxPrice, minCount, sortBy } = req.query;

  if (!country) {
    return res.status(400).json({ error: 'country parameter required' });
  }

  try {
    const params = { country };
    const resp = await call5sim('/guest/prices', { params, requiresAuth: false });

    const countryData = resp.data?.[country] || mockPrices[country] || {};
    const results = [];

    // Iterate through products
    for (const [prod, operators] of Object.entries(countryData)) {
      // Filter by product if specified
      if (product && prod.toLowerCase() !== product.toLowerCase()) {
        continue;
      }

      // Iterate through operators
      for (const [op, data] of Object.entries(operators)) {
        // Filter by operator if specified
        if (operator && op.toLowerCase() !== operator.toLowerCase()) {
          continue;
        }

        const cost = parseFloat(data.cost);
        const count = parseInt(data.count) || 0;

        // Filter by price range
        if (minPrice && cost < parseFloat(minPrice)) continue;
        if (maxPrice && cost > parseFloat(maxPrice)) continue;

        // Filter by count
        if (minCount && count < parseInt(minCount)) continue;

        results.push({
          product: prod,
          operator: op,
          cost,
          count,
          rate: data.rate || null
        });
      }
    }

    // Sort results
    if (sortBy === 'price-asc') {
      results.sort((a, b) => a.cost - b.cost);
    } else if (sortBy === 'price-desc') {
      results.sort((a, b) => b.cost - a.cost);
    } else if (sortBy === 'count-asc') {
      results.sort((a, b) => a.count - b.count);
    } else if (sortBy === 'count-desc') {
      results.sort((a, b) => b.count - a.count);
    }

    console.log(`🔍 Search services: ${country}${product ? '/' + product : ''}${operator ? '/' + operator : ''} → ${results.length} results`);
    return res.json({
      country,
      filters: { product, operator, minPrice, maxPrice, minCount },
      results,
      count: results.length
    });
  } catch (err) {
    console.warn('⚠️ Services search failed:', err.message);

    // Fallback with mock data
    const countryData = mockPrices[country] || {};
    const results = [];

    for (const [prod, operators] of Object.entries(countryData)) {
      if (product && prod.toLowerCase() !== product.toLowerCase()) continue;

      for (const [op, data] of Object.entries(operators)) {
        if (operator && op.toLowerCase() !== operator.toLowerCase()) continue;

        const cost = parseFloat(data.cost);
        const count = parseInt(data.count) || 0;

        if (minPrice && cost < parseFloat(minPrice)) continue;
        if (maxPrice && cost > parseFloat(maxPrice)) continue;
        if (minCount && count < parseInt(minCount)) continue;

        results.push({
          product: prod,
          operator: op,
          cost,
          count,
          rate: data.rate || null
        });
      }
    }

    return res.json({
      country,
      filters: { product, operator, minPrice, maxPrice, minCount },
      results,
      count: results.length
    });
  }
});

// ==================== PAYSTACK MOCK API ====================
app.get('/paystack-public-key', (req, res) => {
  res.json({
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || 'pk_live_a0465f4104c57a61aa78866451b64a7bcf39a4bd'
  });
});

// Paystack verification using server-side secret key (do NOT expose secret)
app.get('/paystack/verify/:reference', async (req, res) => {
  const { reference } = req.params;
  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || null;

  if (!PAYSTACK_SECRET) {
    // Fallback mock behavior
    return res.json({ status: 'success', reference });
  }

  try {
    const url = `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`;
    const resp = await axios.get(url, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }, timeout: 10000 });
    // Forward Paystack response data to client
    return res.json(resp.data);
  } catch (err) {
    console.error('Paystack verify error:', err.response?.data || err.message || err);
    // Map error to 502
    return res.status(502).json({ error: 'Paystack verification failed', details: err.response?.data || err.message });
  }
});

// ==================== TELEGRAM MOCK API ====================
app.post('/api/telegram/notify/:userId', (req, res) => {
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running at http://localhost:${PORT}`);
  console.log(`📡 5sim API Endpoints (Proxy to https://5sim.net/v1):`);
  console.log(`   - GET  /api/5sim/key-status (Check if 5sim API key is configured)`);
  console.log(`   - GET  /api/5sim/countries (Fetch available countries) [PUBLIC]`);
  console.log(`   - GET  /api/5sim/services?country=russia (Fetch products/prices) [PUBLIC]`);
  console.log(`   - POST /api/5sim/buy (Buy activation number) [REQUIRES AUTH]`);
  console.log(`   - GET  /api/5sim/check/:id (Check order status) [REQUIRES AUTH]`);
  console.log(`� Search Endpoints:`);
  console.log(`   - GET  /api/5sim/search/countries?q=russia (Search countries by name/code) [PUBLIC]`);
  console.log(`   - GET  /api/5sim/search/services?country=russia&product=facebook&maxPrice=5&sortBy=price-asc (Search services with filters) [PUBLIC]`);
  console.log(`�💳 Paystack:`);
  console.log(`   - GET  /paystack-public-key (Get Paystack public key)`);
  console.log(`   - GET  /paystack/verify/:reference (Verify payment)`);
  console.log(`💚 Health:`);
  console.log(`   - GET  /health (Health check)`);
});