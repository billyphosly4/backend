#!/bin/bash

# Backend API Test Script
# Run after backend is started on http://localhost:5000

BACKEND_URL="http://localhost:5000"
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Backend API Tests ===${NC}\n"

# Test 1: Health Check
echo -e "${BLUE}1. Testing Health Check${NC}"
curl -s "$BACKEND_URL/health" | jq . || echo "Failed"
echo ""

# Test 2: Get Countries
echo -e "${BLUE}2. Testing Get Countries${NC}"
curl -s "$BACKEND_URL/api/5sim/countries" | jq '.russia' || echo "Failed"
echo ""

# Test 3: Key Status
echo -e "${BLUE}3. Testing Key Status${NC}"
curl -s "$BACKEND_URL/api/5sim/key-status" | jq . || echo "Failed"
echo ""

# Test 4: Get Services for Russia
echo -e "${BLUE}4. Testing Get Services (Russia)${NC}"
curl -s "$BACKEND_URL/api/5sim/services?country=russia" | jq .country || echo "Failed"
echo ""

# Test 5: Paystack Public Key
echo -e "${BLUE}5. Testing Paystack Public Key${NC}"
curl -s "$BACKEND_URL/paystack-public-key" | jq . || echo "Failed"
echo ""

echo -e "${GREEN}✓ All tests completed!${NC}"
