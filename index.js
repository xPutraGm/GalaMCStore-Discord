require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const deployCommands = require('./deploy-commands');
const { initDatabase, getRanksData, saveRank, deleteRank, getPromosData, savePromo, deletePromo, getSetting, saveSetting, updateBotPresence } = require('./utils/db');
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

// --- ADVANCED BOT & STORE SETTINGS ENDPOINTS ---
app.get('/api/admin/settings', requireAdminAuth, async (req, res) => {
    try {
        const data = {
            // Live Feed
            channelId: await getSetting('live_feed_channel') || '',
            isEnabled: (await getSetting('live_feed_status')) === '1',
            title: await getSetting('live_feed_title') || '🎉 ADA YANG BARU BELANJA NIH!',
            desc: await getSetting('live_feed_desc') || 'Terima kasih kepada **{player}** {discord} yang baru saja membeli **Rank {rank}**!\n\n✨ *Dukung terus server GalaMC dengan berbelanja di Official Store!*',
            color: await getSetting('live_feed_color') || '#F1C40F',
            footer: await getSetting('live_feed_footer') || 'GalaMC Store System',
            
            // 1. Presence Config
            botStatus: await getSetting('bot_status') || 'idle',
            botActivityType: await getSetting('bot_activity_type') || 'Custom',
            botActivityText: await getSetting('bot_activity_text') || 'Ketik /buyrank | GalaMC Store 🛒',
            
            // 2. Expiry Timeout
            paymentExpiry: parseInt(await getSetting('payment_expiry_minutes') || '15'),
            
            // 3. Dynamic Catalog Embed
            catalogTitle: await getSetting('catalog_embed_title') || '🛒 MC SERVER OFFICIAL STORE',
            catalogDesc: await getSetting('catalog_embed_desc') || 'Selamat datang di Official Store! Pilih tombol di bawah untuk membeli rank diri sendiri atau mengirim hadiah ke teman.',
            catalogColor: await getSetting('catalog_embed_color') || '#5865F2',
            
            // 4. Maintenance Switch
            isMaintenance: (await getSetting('maintenance_mode')) === '1',
            maintenanceText: await getSetting('maintenance_text') || '⚠️ Store sedang dalam pemeliharaan (Maintenance). Silakan coba lagi nanti!'
        };

        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/settings', requireAdminAuth, async (req, res) => {
    try {
        const { 
            channelId, isEnabled, title, desc, color, footer,
            botStatus, botActivityType, botActivityText,
            paymentExpiry,
            catalogTitle, catalogDesc, catalogColor,
            isMaintenance, maintenanceText
        } = req.body;
        
        // Live Feed
        await saveSetting('live_feed_channel', channelId || '');
        await saveSetting('live_feed_status', isEnabled ? '1' : '0');
        await saveSetting('live_feed_title', title || '');
        await saveSetting('live_feed_desc', desc || '');
        await saveSetting('live_feed_color', color || '#F1C40F');
        await saveSetting('live_feed_footer', footer || '');

        // 1. Presence Config
        await saveSetting('bot_status', botStatus || 'idle');
        await saveSetting('bot_activity_type', botActivityType || 'Custom');
        await saveSetting('bot_activity_text', botActivityText || '');

        // 2. Expiry
        await saveSetting('payment_expiry_minutes', (paymentExpiry || 15).toString());

        // 3. Catalog Embed
        await saveSetting('catalog_embed_title', catalogTitle || '');
        await saveSetting('catalog_embed_desc', catalogDesc || '');
        await saveSetting('catalog_embed_color', catalogColor || '#5865F2');

        // 4. Maintenance
        await saveSetting('maintenance_mode', isMaintenance ? '1' : '0');
        await saveSetting('maintenance_text', maintenanceText || '');

        // UPDATE PRESENCE BOT REALTIME LIVE
        await updateBotPresence(client);

        res.json({ success: true, message: 'Semua Pengaturan Bot berhasil disimpan & diperbarui!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- MIDTRANS WEBHOOK ---
app.post('/webhook/midtrans', (req, res) => handleWebhook(req, res, client));

// --- DISCORD CLIENT READY ---
client.once('ready', async () => {
    await deployCommands();
    await updateBotPresence(client); // Set presence saat startup
    console.log(`🤖 Bot Discord Online: ${client.user.tag}`);
    console.log(`✨ GalaStore Admin Panel: http://localhost:${process.env.PORT || 6330}/admin.html`);
});

client.on('interactionCreate', (interaction) => handleInteraction(interaction));

const PORT = process.env.PORT || 6330;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);