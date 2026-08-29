require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const deployCommands = require('./deploy-commands');
const { initDatabase, getRanksData, saveRank, deleteRank, getPromosData, savePromo, deletePromo } = require('./utils/db');
const { handleInteraction } = require('./handlers/interactionHandler');
const { handleWebhook } = require('./handlers/webhookHandler');

// 1. Inisialisasi Database SQLite
initDatabase();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ] 
});

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

let validAdminSessionToken = null;

// Middleware Proteksi Admin API
function requireAdminAuth(req, res, next) {
    const authHeader = req.headers['x-admin-auth'];
    const sessionCookie = req.cookies['admin_session'];

    if (validAdminSessionToken && (authHeader === validAdminSessionToken || sessionCookie === validAdminSessionToken)) {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized! Password admin salah atau session habis.' });
}

// --- AUTH ENDPOINTS ---
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    if (password === adminPassword) {
        validAdminSessionToken = crypto.randomBytes(32).toString('hex');
        res.cookie('admin_session', validAdminSessionToken, {
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000 // 24 Jam
        });
        return res.json({ success: true, token: validAdminSessionToken });
    }
    return res.status(401).json({ success: false, message: 'Password Admin Salah!' });
});

app.get('/api/admin/check-auth', requireAdminAuth, (req, res) => {
    res.json({ success: true, authenticated: true });
});

app.post('/api/admin/logout', (req, res) => {
    validAdminSessionToken = null;
    res.clearCookie('admin_session');
    res.json({ success: true, message: 'Logged out' });
});

// --- PUBLIC & PROTECTED DATA API ---
app.get('/api/ranks', (req, res) => {
    res.json({ success: true, data: getRanksData() });
});

app.get('/api/promos', (req, res) => {
    res.json({ success: true, data: getPromosData() });
});

// Protected Rank Management
app.post('/api/admin/rank', requireAdminAuth, (req, res) => {
    const { id, price, discordRoleId, benefits, commands } = req.body;
    if (!id || !price) return res.status(400).json({ success: false, message: 'ID dan Price wajib diisi' });
    saveRank(id, price, '#00AAFF', discordRoleId, benefits, commands);
    res.json({ success: true, message: 'Rank saved' });
});

app.delete('/api/admin/rank/:id', requireAdminAuth, (req, res) => {
    deleteRank(req.params.id);
    res.json({ success: true, message: 'Rank deleted' });
});

// Protected Promo Management
app.post('/api/admin/promo', requireAdminAuth, (req, res) => {
    const { code, discountPercent, maxUses } = req.body;
    if (!code || !discountPercent || !maxUses) return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
    savePromo(code, discountPercent, maxUses);
    res.json({ success: true, message: 'Promo saved' });
});

app.delete('/api/admin/promo/:code', requireAdminAuth, (req, res) => {
    deletePromo(req.params.code);
    res.json({ success: true, message: 'Promo deleted' });
});

// --- MIDTRANS WEBHOOK ---
app.post('/webhook/midtrans', (req, res) => handleWebhook(req, res, client));

// --- DISCORD CLIENT READY ---
client.once('ready', async () => {
    await deployCommands();
    console.log(`🤖 Bot Discord Online: ${client.user.tag}`);
    console.log(`✨ GalaStore Admin Panel: http://localhost:${process.env.PORT || 3000}/admin.html`);

    client.user.setPresence({
        activities: [{ name: 'Ketik /buyrank | GalaMC Store 🛒', type: ActivityType.Custom }],
        status: 'idle'
    });
});

client.on('interactionCreate', (interaction) => handleInteraction(interaction));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);