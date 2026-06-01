// server.mjs 
import { onRequest } from 'firebase-functions/v2/https';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors'; // Import middleware CORS
import Midtrans from 'midtrans-client';
import fs from 'fs';
import path from 'path';

// Simple manual .env loader for maximum compatibility
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = (match[2] || '').trim();
        // Remove wrapping quotes if present
        if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
          value = value.substring(1, value.length - 1);
        }
        if (value.length > 0 && value.charAt(0) === "'" && value.charAt(value.length - 1) === "'") {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
    console.log('Loaded environment variables from .env');
  }
} catch (e) {
  console.warn('Failed to load manual .env file:', e.message);
}

const { Snap } = Midtrans;

const app = express();
app.use(bodyParser.json());

// Menambahkan middleware CORS
app.use(cors());

const snap = new Snap({
    isProduction: false,
    serverKey: 'SB-Mid-server-vvE5GyR1AqnJDPc6ng56K5dN', // Ganti dengan kunci server Midtrans Anda
});

// Penanganan rute untuk path root
app.get('/api/', (req, res) => {
    res.send('Hello, world!'); // Ganti dengan respons atau HTML yang sesuai
});

// ==========================================
// RAJAONGKIR SHIPPING API PROXY ENDPOINTS
// ==========================================

// Default Origin City ID (Bandung Kota)
const ORIGIN_ID = '151';

// Mock Destinations for Graceful Fallback
const MOCK_DESTINATIONS = [
  { id: '1', province: 'DKI Jakarta', city: 'Jakarta Pusat', district: 'Gambir', subdistrict: 'Gambir', postal_code: '10110' },
  { id: '2', province: 'Jawa Barat', city: 'Bandung', district: 'Cicendo', subdistrict: 'Cicendo', postal_code: '40171' },
  { id: '3', province: 'Jawa Timur', city: 'Surabaya', district: 'Tegalsari', subdistrict: 'Tegalsari', postal_code: '60261' },
  { id: '4', province: 'Sumatera Utara', city: 'Medan', district: 'Medan Baru', subdistrict: 'Medan Baru', postal_code: '20152' },
  { id: '5', province: 'Sulawesi Selatan', city: 'Makassar', district: 'Ujung Pandang', subdistrict: 'Ujung Pandang', postal_code: '90111' },
  { id: '6', province: 'Bali', city: 'Denpasar', district: 'Denpasar Barat', subdistrict: 'Denpasar Barat', postal_code: '80119' },
  { id: '7', province: 'DI Yogyakarta', city: 'Yogyakarta', district: 'Danurejan', subdistrict: 'Danurejan', postal_code: '55211' }
].map(d => ({
  ...d,
  label: `${d.subdistrict}, ${d.city}, ${d.province} (${d.postal_code})`
}));

// Route: searchDestination (Autocomplete Search)
app.get('/api/searchDestination', async (req, res) => {
    const search = req.query.search || '';
    const apiKey = process.env.RAJAONGKIR_API_KEY;

    if (!apiKey || apiKey === 'YOUR_RAJAONGKIR_API_KEY') {
        const filtered = MOCK_DESTINATIONS.filter(d => 
            d.label.toLowerCase().includes(search.toLowerCase())
        );
        return res.json({ status: 'success', data: filtered });
    }

    try {
        const response = await fetch(`https://rajaongkir.komerce.id/api/v1/destination/domestic-destination?search=${encodeURIComponent(search)}&limit=10`, {
            headers: { 'key': apiKey }
        });
        
        if (!response.ok) {
            const errText = await response.text();
            console.error(`RajaOngkir search error response (status ${response.status}):`, errText);
            throw new Error(`RajaOngkir returned status ${response.status}`);
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.warn('RajaOngkir Search API Failed, falling back to mock data:', error.message);
        const filtered = MOCK_DESTINATIONS.filter(d => 
            d.label.toLowerCase().includes(search.toLowerCase())
        );
        res.json({ status: 'success', data: filtered });
    }
});

// Route: getShippingCost (Parallel Courier Cost Calculator)
app.post('/api/getShippingCost', async (req, res) => {
    const { destination, weight } = req.body;
    const apiKey = process.env.RAJAONGKIR_API_KEY;
    const itemWeight = weight || 500; // default weight

    if (!apiKey || apiKey === 'YOUR_RAJAONGKIR_API_KEY') {
        return getMockShippingCosts(destination, itemWeight, res);
    }

    try {
        const couriers = ['jne', 'pos', 'tiki'];
        const promises = couriers.map(async (courier) => {
            try {
                const bodyParams = new URLSearchParams({
                    origin: ORIGIN_ID,
                    destination: destination.toString(),
                    weight: itemWeight.toString(),
                    courier: courier
                });

                const response = await fetch('https://rajaongkir.komerce.id/api/v1/calculate/domestic-cost', {
                    method: 'POST',
                    headers: {
                        'key': apiKey,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: bodyParams.toString()
                });

                if (!response.ok) {
                    return null;
                }

                const result = await response.json();
                return result.rajaongkir || result;
            } catch (e) {
                console.error(`Error fetching cost for courier ${courier}:`, e);
                return null;
            }
        });

        const responses = await Promise.all(promises);
        
        const mergedResults = [];
        const couriersMap = {};

        responses.forEach((resObj) => {
            if (resObj && Array.isArray(resObj.data)) {
                resObj.data.forEach(item => {
                    const code = (item.code || '').toLowerCase();
                    if (!code) return;
                    if (!couriersMap[code]) {
                        couriersMap[code] = {
                            code: code,
                            name: item.name || item.code.toUpperCase(),
                            costs: []
                        };
                    }
                    const etdCleaned = (item.etd || '').replace(/\s*(day|hari|days)\s*/gi, '');
                    couriersMap[code].costs.push({
                        service: item.service,
                        description: item.description || '',
                        cost: [{
                            value: item.cost || 0,
                            etd: etdCleaned,
                            note: ""
                        }]
                    });
                });
            }
        });

        Object.keys(couriersMap).forEach(key => {
            mergedResults.push(couriersMap[key]);
        });

        res.json({
            rajaongkir: {
                status: { code: 200, description: "OK" },
                results: mergedResults
            }
        });
    } catch (error) {
        console.warn('RajaOngkir Cost API Failed, falling back to mock data:', error.message);
        getMockShippingCosts(destination, itemWeight, res);
    }
});

// Mock Shipping Calculator Helper
function getMockShippingCosts(destination, weight, res) {
    const destId = parseInt(destination) || 1;
    const weightKg = Math.max(1, Math.ceil(weight / 1000));
    
    const jneRegRate = (15000 + (destId * 1500)) * weightKg;
    const jneOkeRate = (12000 + (destId * 1200)) * weightKg;
    
    const posRegRate = (14000 + (destId * 1300)) * weightKg;
    const posNextRate = (22000 + (destId * 2000)) * weightKg;
    
    const tikiRegRate = (14500 + (destId * 1400)) * weightKg;
    const tikiEcoRate = (11500 + (destId * 1100)) * weightKg;

    res.json({
        rajaongkir: {
            status: { code: 200, description: "OK" },
            results: [
                {
                    code: "jne",
                    name: "Jalur Nugraha Ekakurir (JNE)",
                    costs: [
                        {
                            service: "REG",
                            description: "Layanan Reguler",
                            cost: [{ value: jneRegRate, etd: "2-3", note: "" }]
                        },
                        {
                            service: "OKE",
                            description: "Ongkos Kirim Ekonomis",
                            cost: [{ value: jneOkeRate, etd: "4-5", note: "" }]
                        }
                    ]
                },
                {
                    code: "pos",
                    name: "POS Indonesia",
                    costs: [
                        {
                            service: "Kilat Khusus",
                            description: "Layanan Kilat Khusus",
                            cost: [{ value: posRegRate, etd: "3-4", note: "" }]
                        },
                        {
                            service: "Express",
                            description: "Layanan Express",
                            cost: [{ value: posNextRate, etd: "1-2", note: "" }]
                        }
                    ]
                },
                {
                    code: "tiki",
                    name: "Citra Van Titipan Kilat (TIKI)",
                    costs: [
                        {
                            service: "REG",
                            description: "Layanan Reguler",
                            cost: [{ value: tikiRegRate, etd: "2-3", note: "" }]
                        },
                        {
                            service: "ECO",
                            description: "Layanan Ekonomis",
                            cost: [{ value: tikiEcoRate, etd: "4-5", note: "" }]
                        }
                    ]
                }
            ]
        }
    });
}

app.post('/api/getTransactionToken', (req, res) => {
    const parameter = req.body;

    snap.createTransaction(parameter)
        .then((transaction) => {
            const transactionToken = transaction.token;
            res.json({ transactionToken });
        })
        .catch((error) => {
            console.error('Error creating transaction:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        });
});

app.get('/api/getOrderStatus/:order_id', async (req, res) => {
    const orderId = req.params.order_id;

    try {
        const transactionStatus = await snap.transaction.status(orderId);
        res.json({ transactionStatus });
    } catch (error) {
        console.error('Error getting transaction status:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// For local development (only run app.listen if not in a Firebase environment)
if (!process.env.FIREBASE_CONFIG && !process.env.FUNCTIONS_EMULATOR) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Backend server running on http://localhost:${PORT}`);
    });
}

export const api = onRequest(app);
