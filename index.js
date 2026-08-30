require('dotenv').config();
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const deployCommands = require('./deploy-commands');
const { initDatabase, getRanksData, saveRank, deleteRank, getPromosData, savePromo, deletePromo, getSetting, saveSetting } = require('./utils/db');
const { handleInteraction } = require('./handlers/interactionHandler');
const { handleWebhook } = require('./handlers/webhookHandler');

(async () => {
    await initDatabase();
})();

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
            maxAge: 24 * 60 * 60 * 1000
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
app.get('/api/ranks', async (req, res) => {
    try {
        const data = await getRanksData();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/promos', async (req, res) => {
    try {
        const data = await getPromosData();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/rank', requireAdminAuth, async (req, res) => {
    try {
        const { id, price, discordRoleId, benefits, commands } = req.body;
        if (!id || !price) return res.status(400).json({ success: false, message: 'ID dan Price wajib diisi' });
        await saveRank(id, price, '#00AAFF', discordRoleId, benefits, commands);
        res.json({ success: true, message: 'Rank saved' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/admin/rank/:id', requireAdminAuth, async (req, res) => {
    try {
        await deleteRank(req.params.id);
        res.json({ success: true, message: 'Rank deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/promo', requireAdminAuth, async (req, res) => {
    try {
        const { code, discountPercent, maxUses } = req.body;
        if (!code || !discountPercent || !maxUses) return res.status(400).json({ success: false, message: 'Data tidak lengkap' });
        await savePromo(code, discountPercent, maxUses);
        res.json({ success: true, message: 'Promo saved' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/admin/promo/:code', requireAdminAuth, async (req, res) => {
    try {
        await deletePromo(req.params.code);
        res.json({ success: true, message: 'Promo deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- FULL CUSTOMIZABLE SETTINGS MANAGEMENT ---
app.get('/api/admin/settings', requireAdminAuth, async (req, res) => {
    try {
        const channelId = await getSetting('live_feed_channel') || '';
        const isEnabled = await getSetting('live_feed_status') || '0';
        const title = await getSetting('live_feed_title') || '🎉 ADA YANG BARU BELANJA NIH!';
        const desc = await getSetting('live_feed_desc') || 'Terima kasih kepada **{player}** {discord} yang baru saja membeli **Rank {rank}**!\n\n✨ *Dukung terus server GalaMC dengan berbelanja di Official Store!*';
        const color = await getSetting('live_feed_color') || '#F1C40F';
        const footer = await getSetting('live_feed_footer') || 'GalaMC Store System';

        res.json({ 
            success: true, 
            data: { channelId, isEnabled: isEnabled === '1', title, desc, color, footer } 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/settings', requireAdminAuth, async (req, res) => {
    try {
        const { channelId, isEnabled, title, desc, color, footer } = req.body;
        
        await saveSetting('live_feed_channel', channelId || '');
        await saveSetting('live_feed_status', isEnabled ? '1' : '0');
        await saveSetting('live_feed_title', title || '🎉 ADA YANG BARU BELANJA NIH!');
        await saveSetting('live_feed_desc', desc || '');
        await saveSetting('live_feed_color', color || '#F1C40F');
        await saveSetting('live_feed_footer', footer || 'GalaMC Store System');

        res.json({ success: true, message: 'Pengaturan & Pesan Live Feed berhasil disimpan!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- MIDTRANS WEBHOOK ---
app.post('/webhook/midtrans', (req, res) => handleWebhook(req, res, client));

// --- DISCORD CLIENT READY ---
client.once('ready', async () => {
    await deployCommands();
    console.log(`🤖 Bot Discord Online: ${client.user.tag}`);
    console.log(`✨ GalaStore Admin Panel: http://localhost:${process.env.PORT || 6330}/admin.html`);

    client.user.setPresence({
        activities: [{ name: 'Ketik /buyrank | GalaMC Store 🛒', type: ActivityType.Custom }],
        status: 'idle'
    });
});

client.on('interactionCreate', (interaction) => handleInteraction(interaction));

const PORT = process.env.PORT || 6330;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);