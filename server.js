const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mock Database Sederhana (Bisa diganti file JSON atau database asli)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galasecret123'; // Ganti password admin di sini
const ADMIN_TOKEN = 'galatoken_secret_session_xyz';

let ranksData = {
    "VIP": { price: 25000, discordRoleId: "123456789", benefits: ["• Prefix Tag [VIP]", "• Akses Command /fly"] },
    "MVP": { price: 50000, discordRoleId: "987654321", benefits: ["• Prefix Tag [MVP]", "• Akses Command /heal"] }
};

let promosData = {
    "OPENING": { discountPercent: 20, maxUses: 50, usedCount: 5 }
};

let settingsData = {
    botStatus: "online",
    botActivityType: "Playing",
    botActivityText: "Ketik /buyrank | Store",
    paymentExpiry: 15,
    isMaintenance: false,
    maintenanceText: "Toko sedang dalam pemeliharaan.",
    isEnabled: true,
    channelId: "123456789012345678",
    title: "🛒 MC SERVER OFFICIAL STORE",
    desc: "Selamat datang di store resmi GalavectMC!",
    color: "#F1C40F",
    footer: "GalavectMC Store System"
};

// --- AUTH API ---
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true, token: ADMIN_TOKEN });
    } else {
        res.status(401).json({ success: false, message: 'Password salah!' });
    }
});

app.get('/api/admin/check-auth', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token === ADMIN_TOKEN) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false });
    }
});

app.post('/api/admin/logout', (req, res) => {
    res.json({ success: true });
});

// --- RANKS API ---
app.get('/api/ranks', (req, res) => {
    res.json({ success: true, data: ranksData });
});

app.post('/api/admin/rank', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { id, price, discordRoleId, benefits, commands } = req.body;
    ranksData[id] = { price, discordRoleId, benefits, commands };
    res.json({ success: true, message: 'Rank berhasil disimpan' });
});

app.delete('/api/admin/rank/:id', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { id } = req.params;
    if (ranksData[id]) {
        delete ranksData[id];
        res.json({ success: true, message: 'Rank dihapus' });
    } else {
        res.status(404).json({ success: false, message: 'Rank tidak ditemukan' });
    }
});

// --- PROMOS API ---
app.get('/api/promos', (req, res) => {
    res.json({ success: true, data: promosData });
});

app.post('/api/admin/promo', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { code, discountPercent, maxUses } = req.body;
    promosData[code] = { discountPercent, maxUses, usedCount: 0 };
    res.json({ success: true });
});

app.delete('/api/admin/promo/:code', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized' });

    delete promosData[req.params.code];
    res.json({ success: true });
});

// --- STATS & SALES API (REAL DATA MOCK) ---
app.get('/api/admin/stats', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false });

    res.json({
        success: true,
        data: {
            totalRevenue: 1450000,
            totalTransactions: 32,
            pendingTransactions: 2
        }
    });
});

app.get('/api/admin/recent-sales', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false });

    res.json({
        success: true,
        data: [
            { rankId: "Rank VIP", username: "Stev3_ID", amount: 25000, status: "settlement", timeAgo: "2m ago" },
            { rankId: "Rank MVP", username: "Notch", amount: 50000, status: "settlement", timeAgo: "1h ago" }
        ]
    });
});

// --- SETTINGS API ---
app.get('/api/admin/settings', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false });
    res.json({ success: true, data: settingsData });
});

app.post('/api/admin/settings', (req, res) => {
    const token = req.headers['x-admin-auth'];
    if (token !== ADMIN_TOKEN) return res.status(401).json({ success: false });
    settingsData = { ...settingsData, ...req.body };
    res.json({ success: true });
});

// Jalankan Server
app.listen(PORT, () => {
    console.log(`🚀 GalavectMC Server berjalan di http://localhost:${PORT}`);
});