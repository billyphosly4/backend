// backend/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { FiveSim } from 'node-five-sim';

dotenv.config();

// Initialize Firebase Admin
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    admin.initializeApp();
  }
  console.log('✅ Firebase Admin initialized successfully');
} catch (error) {
  console.warn('⚠️ Firebase Admin initialization failed. Secure features may not work:', error.message);
}

const db = admin.apps.length > 0 ? admin.firestore() : null;

const app = express();
const PORT = process.env.PORT || 5000;

// Dynamic CORS for development & production
const allowedOrigins = [
  'http://localhost:5173',        // Vite dev
  'http://localhost:3000',        // React dev
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://prime-sms-hub-react.vercel.app',  // Vercel production
  'http://localhost:5174',        // Admin Vite dev
  'http://localhost:5175',        // Admin Vite dev
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])  // Frontend URL from env
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow no origin (mobile apps, curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    
    // Log rejected origins for debugging
    console.warn(`CORS rejected origin: ${origin}`);
    console.warn(`Allowed origins: ${allowedOrigins.join(', ')}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

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

const KES_TO_USD_RATE = 0.0078; // 1 KES = $0.0078 USD (Example rate, should be updated or fetched)

const PROFIT_PERCENTAGE = 35; // 35% profit margin
const PROFIT_MULTIPLIER = 1.35;

/**
 * Price Calculator Function
 * Calculates what the user pays based on API cost and 35% profit
 */
const calculateUserPrice = (apiCost) => {
  return parseFloat((apiCost * PROFIT_MULTIPLIER).toFixed(2));
};

const FIVESIM_BASE = process.env.FIVESIM_BASE_URL || 'https://5sim.net/v1';
const PROTO_KEY = process.env.FIVESIM_PROTOCOL_KEY || process.env.FIVESIM_KEY || process.env.FIVESIM_API_KEY || process.env['5SIM_API_KEY'] || null;
const OLD_KEY = process.env.FIVESIM_OLD_KEY || null;

// Initialize FiveSim library
const fiveSim = new FiveSim({ token: PROTO_KEY || OLD_KEY });

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
    // Extract and format for frontend with 35% markup
    const data = resp.data || {};
    const countryData = data[country] || {};

    // Apply 35% markup to all costs
    for (const prod in countryData) {
      for (const op in countryData[prod]) {
        if (countryData[prod][op].cost) {
          countryData[prod][op].apiCost = countryData[prod][op].cost; // Keep original for reference if needed
          countryData[prod][op].cost = calculateUserPrice(countryData[prod][op].cost);
        }
      }
    }

    return res.json({
      country,
      products: countryData,
      operators: Object.keys(countryData[product] || {})
    });
  } catch (err) {
    console.warn(`⚠️ 5sim prices failed (${country}), using mock:`, err.message);
    const mockData = JSON.parse(JSON.stringify(mockPrices[country] || {}));
    // Apply 35% markup to mock costs
    for (const prod in mockData) {
      for (const op in mockData[prod]) {
        if (mockData[prod][op].cost) {
          mockData[prod][op].cost = calculateUserPrice(mockData[prod][op].cost);
        }
      }
    }
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
  const { country, operator, product, uid } = req.body;

  if (!country || !operator || !product) {
    return res.status(400).json({ error: 'country, operator, and product are required' });
  }

  if (!uid) {
    return res.status(401).json({ error: 'User authentication required (uid missing)' });
  }

  console.log(`💳 5sim buy request: ${country}/${operator}/${product} for user ${uid}`);

  try {
    // 1. Check user balance in Firestore
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const balance = userSnap.exists ? (Number(userSnap.data().wallet) || 0) : 0;

    // 2. Get the best available price from 5sim using the library's built-in cheapest selector
    const { operator: bestOperator, data: bestData } = await fiveSim.getCheapestPriceByCountryAndProduct(country, product);
    
    if (!bestOperator || !bestData) {
      return res.status(400).json({ error: 'No operators found with stock for this service/country' });
    }

    const apiCost = parseFloat(bestData.cost);
    const userPrice = calculateUserPrice(apiCost);
    const myProfit = parseFloat((userPrice - apiCost).toFixed(2));

    if (balance < userPrice) {
      return res.status(402).json({ error: `Insufficient funds. Balance: $${balance.toFixed(2)}, Cost: $${userPrice.toFixed(2)}` });
    }

    // 3. Purchase the number from 5sim (pay only API cost)
    console.log(`📡 Purchasing: ${country}/${bestOperator}/${product} at cost $${apiCost}`);
    const order = await fiveSim.purchase(country, product, bestOperator);

    if (!order || !order.id) {
       throw new Error('Failed to obtain order from 5sim');
    }

    // 4. Update balance and record detailed transaction
    const newBalance = Number((balance - userPrice).toFixed(2));
    const batch = db.batch();
    const txRef = db.collection('transactions').doc();
    
    batch.set(txRef, {
      uid: uid,
      type: 'debit',
      amount: userPrice,       // Required by frontend wallet reconciliation (reads tx.amount)
      orderId: order.id,
      product: product,
      country: country,
      apiCost: apiCost,
      userPrice: userPrice,
      myProfit: myProfit,
      profitPercentage: PROFIT_PERCENTAGE,
      status: 'success',
      description: `Purchased ${product} number for ${country}`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      reference: `5sim_${order.id}`
    });

    batch.update(userRef, {
      wallet: newBalance,
      lastTransactionAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();
    console.log(`✅ Purchased order ${order.id}. User paid: $${userPrice}, Profit: $${myProfit}`);

    return res.json({
      ...order,
      userPrice,
      price: userPrice, // Added for frontend compatibility
      status: 'success'
    });
  } catch (err) {
    console.error('❌ Purchase error:', err.message);
    return res.status(500).json({
      error: err.message || 'Failed to purchase number from 5sim.'
    });
  }
});

// ==================== ADMIN PROFIT REPORT ====================
app.get('/api/admin/profit-report', async (req, res) => {
  try {
    const snap = await db.collection('transactions')
      .where('type', '==', 'debit')
      .where('status', '==', 'success')
      .get();

    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let orderCount = 0;

    snap.forEach(doc => {
      const data = doc.data();
      if (data.userPrice) {
        totalRevenue += data.userPrice;
        totalCost += (data.apiCost || 0);
        totalProfit += (data.myProfit || 0);
        orderCount++;
      }
    });

    return res.json({
      summary: {
        orderCount,
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalCost: parseFloat(totalCost.toFixed(2)),
        totalProfit: parseFloat(totalProfit.toFixed(2)),
        avgProfitPercentage: orderCount > 0 ? parseFloat(((totalProfit / totalRevenue) * 100).toFixed(2)) : 0
      },
      note: 'Target Profit Percentage is 35%'
    });
  } catch (err) {
    console.error('Profit report error:', err);
    res.status(500).json({ error: 'Failed to generate profit report' });
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

// Cancel order (Proxy)
app.get('/api/5sim/cancel/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`🚫 5sim cancel order request: ${id}`);
  try {
    const resp = await call5sim(`/user/cancel/${id}`, { method: 'get', requiresAuth: true });
    return res.json(resp.data);
  } catch (err) {
    console.error('❌ Cancel error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to cancel order' });
  }
});

// Ban number (Proxy)
app.get('/api/5sim/ban/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`🔨 5sim ban number request: ${id}`);
  try {
    const resp = await call5sim(`/user/ban/${id}`, { method: 'get', requiresAuth: true });
    return res.json(resp.data);
  } catch (err) {
    console.error('❌ Ban error:', err.message);
    return res.status(500).json({ error: err.message || 'Failed to ban number' });
  }
});

// Admin Buy activation number (No wallet deduction)
app.post('/api/admin/5sim/buy', async (req, res) => {
  const { country, operator, product } = req.body;
  console.log(`👑 Admin 5sim buy request: ${country}/${operator}/${product}`);
  try {
    const resp = await call5sim(`/user/buy/activation/${country}/${operator}/${product}`, { method: 'get', requiresAuth: true });
    return res.json(resp.data);
  } catch (err) {
    console.error('❌ Admin Buy error:', err.message);
    return res.status(500).json({ error: err.message || 'Admin Purchase Failed' });
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

        const apiCost = parseFloat(data.cost);
        const userPrice = calculateUserPrice(apiCost);
        const count = parseInt(data.count) || 0;

        // Filter by price range (based on user price)
        if (minPrice && userPrice < parseFloat(minPrice)) continue;
        if (maxPrice && userPrice > parseFloat(maxPrice)) continue;

        // Filter by count
        if (minCount && count < parseInt(minCount)) continue;

        results.push({
          product: prod,
          operator: op,
          cost: userPrice, // Show the marked-up price
          apiCost,       // Include raw cost for internal verification
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
    
    // SECURE: Also perform the credit if it's successful and not already processed
    if (resp.data?.data?.status === 'success') {
      const data = resp.data.data;
      let amount = data.amount / 100;
      const currency = data.currency;
      
      // Convert KES to USD if necessary
      if (currency === 'KES') {
        amount = Number((amount * KES_TO_USD_RATE).toFixed(2));
      }
      
      let metadata = data.metadata || {};
      if (typeof metadata === 'string' && metadata.trim().startsWith('{')) {
        try { metadata = JSON.parse(metadata); } catch(e) { console.error('Metadata parse error:', e); }
      }
      
      const uid = metadata.custom_fields?.find(f => f.variable_name === 'uid')?.value || metadata.uid || null;

      if (uid) {
        const existing = await db.collection('transactions').where('reference', '==', reference).get();
        if (existing.empty) {
          const batch = db.batch();
          const txRef = db.collection('transactions').doc();
          batch.set(txRef, {
            uid: uid,
            type: 'credit',
            amount: amount,
            currency: currency,
            originalAmount: data.amount / 100,  // Raw amount before KES conversion
            originalCurrency: currency,          // Track original currency for audit trail
            description: `Funded wallet via Paystack Verify`,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            reference: reference,
            status: 'success',
            paystackData: data
          });

          const userRef = db.collection('users').doc(uid);
          const userSnap = await userRef.get();
          let currentWallet = 0;
          if (userSnap.exists) {
            currentWallet = Number(userSnap.data().wallet) || 0;
          }
          const newWallet = Number((currentWallet + amount).toFixed(2));
          batch.update(userRef, { 
            wallet: newWallet,
            lastTransactionAt: admin.firestore.FieldValue.serverTimestamp()
          });

          await batch.commit();
          console.log(`✅ Paystack verify: successfully funded $${amount} for user ${uid}. New wallet: $${newWallet}`);
        }
      } else {
        console.warn('⚠️ Paystack verify: Success but no uid found in metadata');
      }
    }

    return res.json(resp.data);
  } catch (err) {
    console.error('Paystack verify error:', err.response?.data || err.message || err);
    return res.status(502).json({ error: 'Paystack verification failed', details: err.response?.data || err.message });
  }
});

// ==================== PAYSTACK WEBHOOK (REAL) ====================
// New endpoint as requested by user
app.post('/api/payments/webhook', async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    console.error('❌ Paystack webhook: PAYSTACK_SECRET_KEY not configured in environment');
    return res.status(200).send('Webhook secret not configured');
  }

  const hash = crypto.createHmac('sha512', secret).update(req.rawBody).digest('hex');
  if (hash !== req.headers['x-paystack-signature']) {
    console.error('❌ Paystack webhook: Invalid signature header');
    return res.status(401).send('Invalid signature');
  }

  try {
    const event = req.body;
    console.log(`📩 Paystack Webhook received: ${event.event}`, { 
      reference: event.data?.reference,
      amount: event.data?.amount,
      currency: event.data?.currency
    });

    if (event.event === 'charge.success') {
      const data = event.data;
      const reference = data.reference;
      let amount = data.amount / 100; 
      const currency = data.currency;

      // Convert KES to USD if necessary
      if (currency === 'KES') {
        amount = Number((amount * KES_TO_USD_RATE).toFixed(2));
      }

      let metadata = data.metadata || {};
      if (typeof metadata === 'string' && metadata.trim().startsWith('{')) {
        try { metadata = JSON.parse(metadata); } catch(e) { console.error('Metadata parse error (webhook):', e); }
      }

      // Robust UID extraction
      const uid = metadata.custom_fields?.find(f => f.variable_name === 'uid')?.value || 
                  metadata.uid || 
                  data.customer?.metadata?.uid || 
                  null;

      if (!uid) {
        console.error('⚠️ Paystack webhook: No uid in metadata for reference', reference);
        // Still return 200 to acknowledge receipt, otherwise Paystack will keep retrying
        return res.status(200).send('No uid found in metadata');
      }

      const existing = await db.collection('transactions').where('reference', '==', reference).get();
      if (!existing.empty) {
        console.log('✅ Paystack webhook: transaction already processed', reference);
        return res.status(200).send('Already processed');
      }

      const batch = db.batch();
      const txRef = db.collection('transactions').doc();
      batch.set(txRef, {
        uid: uid,
        type: 'credit',
        amount: amount,
        currency: currency,
        originalAmount: data.amount / 100,  // Raw amount before KES conversion
        originalCurrency: currency,          // Track original currency for audit trail
        description: `Funded wallet via Paystack Webhook`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reference: reference,
        status: 'success',
        paystackData: data
      });

      // Update user wallet
      const userRef = db.collection('users').doc(uid);
      const userSnap = await userRef.get();
      let currentWallet = 0;
      if (userSnap.exists) {
        currentWallet = Number(userSnap.data().wallet) || 0;
      }
      const newWallet = Number((currentWallet + amount).toFixed(2));
      batch.update(userRef, { 
        wallet: newWallet,
        lastTransactionAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await batch.commit();
      console.log(`✅ Paystack webhook: successfully funded $${amount} for user ${uid}. New wallet: $${newWallet}`);
    } else {
      console.log(`ℹ️ Paystack webhook: Ignored event type: ${event.event}`);
    }
    
    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Paystack webhook process error:', err);
    res.sendStatus(500);
  }
});

// Legacy endpoint for backward compatibility (delegates to new one)
app.post('/paystack/webhook', (req, res) => {
  console.log('🔄 Paystack webhook: legacy endpoint called, redirecting internally...');
  // Since it's a POST, we can't easily redirect, so we just call the same logic
  // express will handle it since we use app.post for both.
  // Actually, I'll just keep the logic in one and call it.
  // For simplicity, I'll just make both point to the same handler function if I were refactoring more deeply.
  // But here I'll just duplicate or keep it similar.
  req.url = '/api/payments/webhook';
  app.handle(req, res);
});

// ==================== REAL TELEGRAM INTEGRATION ====================
app.post('/api/telegram/notify/:userId', async (req, res) => {
  const { userId } = req.params;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    console.warn('Telegram notification skipped: No bot token configured');
    return res.status(200).json({ success: true, note: 'Mocked - No token' });
  }

  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    
    const telegramId = userDoc.data().telegramId;
    if (!telegramId) return res.status(400).json({ error: 'User has no linked Telegram ID' });

    const message = req.body.message || `Hello from Prime SMS Hub! Your account is successfully linked.`;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    await axios.post(url, {
      chat_id: telegramId,
      text: message,
      parse_mode: 'HTML'
    });

    console.log(`✅ Telegram message sent to ${userId} (${telegramId})`);
    return res.json({ success: true });
  } catch (err) {
    console.error('❌ Telegram error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to send Telegram message' });
  }
});

// ==================== AUTH TO FIRESTORE SYNC ====================
app.get('/api/admin/sync-users', async (req, res) => {
  try {
    const listUsersResult = await admin.auth().listUsers(1000);
    const batch = db.batch();
    let added = 0;
    
    for (const userRecord of listUsersResult.users) {
        const userRef = db.collection('users').doc(userRecord.uid);
        const docSnap = await userRef.get();
        if (!docSnap.exists) {
            batch.set(userRef, {
                email: userRecord.email,
                fullName: userRecord.displayName || (userRecord.email ? userRecord.email.split('@')[0] : 'Unknown'),
                walletBalance: 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                isVerified: userRecord.emailVerified || false,
                status: 'active',
                role: 'user'
            });
            added++;
        }
    }
    if (added > 0) {
       // Note: Firestore batches support up to 500 operations. If >500 missing users exist, 
       // this would need chunking, but for <500 this works flawlessly.
       await batch.commit();
    }
    return res.json({ success: true, message: `Synced ${added} missing users from Firebase Auth to Firestore.` });
  } catch(e) {
    console.error("Sync Auth Error:", e);
    return res.status(500).json({ error: e.message });
  }
});

// ==================== ADMIN MANUAL CREDIT ====================
// POST /api/admin/manual-credit
// Body: { uid?, email?, amountKES?, amountUSD?, description?, reference? }
// Use uid OR email to identify the user.
// Supply either amountKES (converted at KES_TO_USD_RATE) or amountUSD (used as-is).
app.post('/api/admin/manual-credit', async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin-secret-change-me';
  const providedSecret = req.headers['x-admin-secret'] || req.body.adminSecret;

  if (providedSecret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden – wrong admin secret' });
  }

  let { uid, email, amountKES, amountUSD, description, reference } = req.body;

  try {
    // Resolve uid from email if not provided
    if (!uid && email) {
      const userRecord = await admin.auth().getUserByEmail(email);
      uid = userRecord.uid;
      console.log(`🔍 Resolved uid ${uid} from email ${email}`);
    }
    if (!uid) return res.status(400).json({ error: 'Provide uid or email' });

    // Resolve amount
    let creditAmount;
    if (amountUSD !== undefined) {
      creditAmount = Number(parseFloat(amountUSD).toFixed(2));
    } else if (amountKES !== undefined) {
      creditAmount = Number((parseFloat(amountKES) * KES_TO_USD_RATE).toFixed(2));
    } else {
      return res.status(400).json({ error: 'Provide amountKES or amountUSD' });
    }

    if (creditAmount <= 0) {
      return res.status(400).json({ error: `Computed credit amount is $${creditAmount} – too small` });
    }

    // Prevent double-processing if a reference is given
    const ref = reference || `manual_${Date.now()}`;
    if (reference) {
      const dup = await db.collection('transactions').where('reference', '==', reference).get();
      if (!dup.empty) {
        return res.status(409).json({ error: 'Transaction with this reference already exists', reference });
      }
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(404).json({ error: `User document not found for uid: ${uid}` });
    }

    const currentWallet = Number(userSnap.data().wallet) || 0;
    const newWallet = Number((currentWallet + creditAmount).toFixed(2));

    const batch = db.batch();
    const txRef = db.collection('transactions').doc();
    batch.set(txRef, {
      uid,
      type: 'credit',
      amount: creditAmount,
      originalAmount: amountKES ? parseFloat(amountKES) : creditAmount,
      originalCurrency: amountKES ? 'KES' : 'USD',
      currency: 'USD',
      description: description || `Manual wallet credit by admin`,
      reference: ref,
      status: 'success',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      manualCredit: true
    });
    batch.update(userRef, {
      wallet: newWallet,
      lastTransactionAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();

    console.log(`✅ Manual credit: $${creditAmount} added to user ${uid}. Wallet: $${currentWallet} → $${newWallet}`);
    return res.json({
      success: true,
      uid,
      creditAmount,
      previousWallet: currentWallet,
      newWallet,
      transactionId: txRef.id,
      reference: ref
    });
  } catch (err) {
    console.error('❌ Manual credit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ==================== PAYSTACK REFUND (ADMIN) ====================
app.post('/api/admin/paystack/refund', async (req, res) => {
  const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin-secret-change-me';
  const providedSecret = req.headers['x-admin-secret'] || req.body.adminSecret;
  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

  if (providedSecret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden – wrong admin secret' });
  }

  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: 'Paystack secret key not configured on server' });
  }

  const { transactionId, paystackReference, amount } = req.body;

  if (!transactionId || !paystackReference) {
    return res.status(400).json({ error: 'transactionId and paystackReference are required' });
  }

  console.log(`♻️ Refund request for transaction ${transactionId} (Ref: ${paystackReference})`);

  try {
    const url = 'https://api.paystack.co/refund';
    const resp = await axios.post(url, 
      { transaction: paystackReference, amount: amount ? (amount * 100) : undefined }, // Amount in kobo/cents if provided
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    if (resp.data.status) {
      // Update Firestore
      await db.collection('transactions').doc(transactionId).update({
        status: 'refunded',
        refundRef: resp.data.data?.id || `RRN_${Date.now()}`,
        refundedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✅ Refund successful for transaction ${transactionId}`);
      return res.json({ success: true, data: resp.data.data });
    } else {
      console.error('❌ Paystack refund failed:', resp.data.message);
      return res.status(400).json({ error: resp.data.message });
    }
  } catch (err) {
    console.error('❌ Refund process error:', err.response?.data || err.message);
    return res.status(502).json({ error: 'Paystack refund call failed', details: err.response?.data || err.message });
  }
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