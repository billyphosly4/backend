# Backend Deployment Guide

## Quick Setup for Local Development

```bash
cd backend
npm install
npm run dev
```

Backend will run on `http://localhost:5000`

---

## Deployment on Render

### 1. **Create Render Account**
- Go to [render.com](https://render.com)
- Sign up and connect your GitHub repository

### 2. **Create New Web Service**
- Click "New +" → "Web Service"
- Select your GitHub repository `prime-sms-hub.sms`
- Settings:
  - **Name**: `prime-sms-hub-backend` (or any name)
  - **Environment**: Node
  - **Region**: Choose closest to your users
  - **Branch**: main
  - **Build Command**: `cd backend && npm install`
  - **Start Command**: `node server.js`
  - **Plan**: Free or Paid (Free tier gets 0.50 CPU, 512MB RAM)

### 3. **Set Environment Variables in Render Dashboard**

Go to your Web Service → Environment

Add these variables:
```
PORT=5000
NODE_ENV=production
FRONTEND_URL=https://your-app.vercel.app

FIVESIM_PROTOCOL_KEY=your_5sim_api_key_here
PAYSTACK_PUBLIC_KEY=pk_live_xxxx
PAYSTACK_SECRET_KEY=sk_live_xxxx
TELEGRAM_BOT_TOKEN=your_bot_token
DATABASE_URL=your_db_url (if using one)
```

### 4. **Deploy**
- Render auto-deploys on every push to `main` branch
- Your backend URL will be: `https://prime-sms-hub-backend.onrender.com`

---

## Frontend Configuration (Vercel)

### Set Backend URL in Vercel Dashboard

Your Vercel frontend needs to know the backend URL.

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add:
   ```
   VITE_BACKEND_URL=https://prime-sms-hub-backend.onrender.com
   ```

Or update your frontend `.env.production`:
```bash
VITE_BACKEND_URL=https://prime-sms-hub-backend.onrender.com
```

---

## API Endpoints

### Public Endpoints (No Auth Required)
- `GET /api/5sim/countries` - Get available countries
- `GET /api/5sim/services?country=russia` - Get prices and services
- `GET /health` - Health check
- `GET /paystack-public-key` - Get Paystack public key

### Search Endpoints (No Auth Required)
- `GET /api/5sim/search/countries?q=russia` - Search countries by name or code
  ```bash
  # Examples:
  curl "http://localhost:5000/api/5sim/search/countries?q=russia"
  curl "http://localhost:5000/api/5sim/search/countries?q=us"
  curl "http://localhost:5000/api/5sim/search/countries?q=+7"
  ```

- `GET /api/5sim/search/services` - Search services with filters
  ```bash
  # Examples:
  # Get all services for Russia
  curl "http://localhost:5000/api/5sim/search/services?country=russia"
  
  # Get only Facebook services in Russia under $5, sorted by price
  curl "http://localhost:5000/api/5sim/search/services?country=russia&product=facebook&maxPrice=5&sortBy=price-asc"
  
  # Get Telegram services with specific operator
  curl "http://localhost:5000/api/5sim/search/services?country=russia&product=telegram&operator=virtual1"
  
  # Get services with at least 100 available
  curl "http://localhost:5000/api/5sim/search/services?country=russia&minCount=100"
  ```
  
  **Filter Parameters:**
  - `country` (required) - Country code (russia, usa, ukraine, etc.)
  - `product` (optional) - Product type (facebook, telegram, etc.)
  - `operator` (optional) - Operator name
  - `minPrice` (optional) - Minimum price filter
  - `maxPrice` (optional) - Maximum price filter
  - `minCount` (optional) - Minimum available count
  - `sortBy` (optional) - Sort results: `price-asc`, `price-desc`, `count-asc`, `count-desc`

### Protected Endpoints (Requires 5sim API Key)
- `POST /api/5sim/buy` - Buy phone number
  ```json
  {
    "country": "russia",
    "operator": "virtual1",
    "product": "facebook"
  }
  ```
- `GET /api/5sim/check/:id` - Check order status
- `GET /api/5sim/check-sms/:id` - Get SMS messages

### Other Endpoints
- `GET /paystack/verify/:reference` - Verify Paystack payment
- `POST /api/telegram/notify/:userId` - Notify via Telegram

---

## Troubleshooting

### Backend won't start
```bash
npm install
# Check for any missing dependencies
```

### CORS Errors
Make sure your Vercel frontend URL is set in `FRONTEND_URL` environment variable

### 5sim API Not Working
- Verify your `FIVESIM_PROTOCOL_KEY` is correct
- Check if the key has sufficient balance
- Get key from: https://5sim.net/account/security

### Render Free Tier Issues
- Free tier instances spin down after 15 minutes of inactivity
- First request may take 30 seconds to wake up
- For production, use Paid tier

---

## Local Testing

```bash
# Start backend
cd backend
npm run dev

# Start frontend (in another terminal)
npm run dev

# Test endpoints
curl http://localhost:5000/api/5sim/countries
curl http://localhost:5000/health
```

---

## File Structure

```
backend/
├── api/
│   └── 5sim/
│       ├── buy.js
│       ├── countries.js
│       └── services.js
├── server.js          # Main server file
├── package.json
├── .env               # Environment variables (don't commit)
├── .env.example       # Template
└── Procfile           # Render deployment config
```

---

## Key Features

✅ 5sim integration (buy phone numbers, check SMS)
✅ Paystack payment verification
✅ Telegram bot notifications
✅ Health check endpoint
✅ CORS configured for Vercel
✅ Production-ready logging

Enjoy! 🚀
