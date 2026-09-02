require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const deployCommands = require('./deploy-commands');
const { 
    initDatabase, 
    getRanksData, 
    saveRank, 
    deleteRank, 
    getPromosData, 
    savePromo, 
    deletePromo, 
    getSetting, 
    saveSetting, 
    updateBotPresence 
} = require('./utils/db');
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

// Helper Uptime Formatting
function getUptimeFormatted() {
    const totalSeconds = process.uptime();
    const days = Math.floor(totalSeconds / (3600 * 24));
    const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return parts.join(' ');
}

// Middleware Auth Admin
function requireAdminAuth(req, res, next) {
    const authHeader = req.headers['x-admin-auth'];
    const sessionCookie = req.cookies['admin_session'];

    if (validAdminSessionToken && (authHeader === validAdminSessionToken || sessionCookie === validAdminSessionToken)) {
        return next();
    }
    return res.status(401).json({ success: false, message: 'Unauthorized! Session expired or invalid.' });
}

// --- AUTH API ---
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

app.post('/api/admin/change-password', requireAdminAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const currentAdminPass = process.env.ADMIN_PASSWORD || 'admin123';

        if (currentPassword !== currentAdminPass) {
            return res.status(400).json({ success: false, message: 'Password lama tidak cocok!' });
        }
        if (!newPassword || newPassword.length < 5) {
            return res.status(400).json({ success: false, message: 'Password baru minimal 5 karakter!' });
        }

        await saveSetting('admin_password_override', newPassword);
        process.env.ADMIN_PASSWORD = newPassword;

        res.json({ success: true, message: 'Password Admin berhasil diubah!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- RANKS API (ENHANCED WITH TEMPORARY & ON/OFF TOGGLE) ---
app.get('/api/ranks', async (req, res) => {
    try {
        const data = await getRanksData();
        // Public API hanya menampilkan data rank (bisa difilter active di frontend bot)
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/rank', requireAdminAuth, async (req, res) => {
    try {
        const { 
            id, 
            price, 
            tempPrice,
            discordRoleId, 
            benefits, 
            commands,
            isActive = true,
            allowPermanent = true,
            allowTemporary = false,
            durationDays = 30,
            tempCommands = []
        } = req.body;

        if (!id) return res.status(400).json({ success: false, message: 'ID Rank wajib diisi' });
        if (allowPermanent && (!price || price <= 0)) {
            return res.status(400).json({ success: false, message: 'Harga permanen harus diisi jika permanent buy diaktifkan' });
        }
        if (allowTemporary && (!tempPrice || tempPrice <= 0)) {
            return res.status(400).json({ success: false, message: 'Harga temporary harus diisi jika temporary buy diaktifkan' });
        }

        const rankPayload = {
            id,
            price: price || 0,
            tempPrice: tempPrice || 0,
            color: '#5865F2',
            discordRoleId,
            benefits,
            commands,
            tempCommands,
            isActive: Boolean(isActive),
            allowPermanent: Boolean(allowPermanent),
            allowTemporary: Boolean(allowTemporary),
            durationDays: parseInt(durationDays) || 30
        };

        await saveRank(
            id, 
            rankPayload.price, 
            rankPayload.color, 
            rankPayload.discordRoleId, 
            rankPayload.benefits, 
            rankPayload.commands,
            rankPayload // Opsional passing full payload jika db helper mendukung JSON metadata
        );

        res.json({ success: true, message: `Rank ${id} berhasil disimpan!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Endpoint cepat untuk Toggle ON/OFF Status Rank
app.post('/api/admin/rank/toggle-status', requireAdminAuth, async (req, res) => {
    try {
        const { id, isActive } = req.body;
        const ranks = await getRanksData();
        if (ranks[id]) {
            ranks[id].isActive = Boolean(isActive);
            await saveRank(
                id, 
                ranks[id].price, 
                ranks[id].color || '#5865F2', 
                ranks[id].discordRoleId, 
                ranks[id].benefits, 
                ranks[id].commands,
                ranks[id]
            );
            return res.json({ success: true, message: `Status Rank ${id} diubah menjadi ${isActive ? 'ACTIVE' : 'DISABLED'}` });
        }
        res.status(404).json({ success: false, message: 'Rank tidak ditemukan' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/admin/rank/:id', requireAdminAuth, async (req, res) => {
    try {
        await deleteRank(req.params.id);
        res.json({ success: true, message: 'Rank dihapus' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- PROMOS API ---
app.get('/api/promos', async (req, res) => {
    try {
        const data = await getPromosData();
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/promo', requireAdminAuth, async (req, res) => {
    try {
        const { code, discountPercent, maxUses } = req.body;
        if (!code || !discountPercent || !maxUses) return res.status(400).json({ success: false, message: 'Data promo tidak lengkap' });
        await savePromo(code, discountPercent, maxUses);
        res.json({ success: true, message: 'Promo berhasil dibuat' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/admin/promo/:code', requireAdminAuth, async (req, res) => {
    try {
        await deletePromo(req.params.code);
        res.json({ success: true, message: 'Promo dihapus' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- STATS & SALES API ---
app.get('/api/admin/stats', requireAdminAuth, async (req, res) => {
    try {
        const totalRevenue = parseInt(await getSetting('total_revenue') || '0');
        const totalTransactions = parseInt(await getSetting('total_transactions') || '0');
        const pendingTransactions = parseInt(await getSetting('pending_transactions') || '0');
        
        res.json({
            success: true,
            data: {
                totalRevenue,
                totalTransactions,
                pendingTransactions,
                ping: client.ws ? client.ws.ping : 0,
                uptimeFormatted: getUptimeFormatted(),
                botTag: client.user ? client.user.tag : 'Offline'
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/recent-sales', requireAdminAuth, async (req, res) => {
    try {
        const salesRaw = await getSetting('recent_sales_log') || '[]';
        res.json({
            success: true,
            data: JSON.parse(salesRaw)
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- SETTINGS API ---
app.get('/api/admin/settings', requireAdminAuth, async (req, res) => {
    try {
        const data = {
            channelId: await getSetting('live_feed_channel') || process.env.STORE_LOG_CHANNEL_ID || '',
            isEnabled: (await getSetting('live_feed_status')) === '1',
            title: await getSetting('live_feed_title') || '🎉 ADA YANG BARU BELANJA NIH!',
            desc: await getSetting('live_feed_desc') || 'Terima kasih kepada **{player}** {discord} yang baru saja membeli **Rank {rank} ({duration})**!\n\n✨ *Dukung terus server GalaMC dengan berbelanja di Official Store!*',
            color: await getSetting('live_feed_color') || '#F1C40F',
            footer: await getSetting('live_feed_footer') || 'GalaMC Store System',
            botStatus: await getSetting('bot_status') || 'idle',
            botActivityType: await getSetting('bot_activity_type') || 'Custom',
            botActivityText: await getSetting('bot_activity_text') || 'Ketik /buyrank | GalaMC Store 🛒',
            paymentExpiry: parseInt(await getSetting('payment_expiry_minutes') || '15'),
            catalogTitle: await getSetting('catalog_embed_title') || '🛒 GALAMC OFFICIAL RANK STORE',
            catalogDesc: await getSetting('catalog_embed_desc') || 'Selamat datang di GalaMC Rank Store! Pilih tombol di bawah untuk membeli rank.',
            catalogColor: await getSetting('catalog_embed_color') || '#5865F2',
            isMaintenance: (await getSetting('maintenance_mode')) === '1',
            maintenanceText: await getSetting('maintenance_text') || '⚠️ Store sedang dalam pemeliharaan (Maintenance).'
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
            paymentExpiry, catalogTitle, catalogDesc, catalogColor,
            isMaintenance, maintenanceText
        } = req.body;
        
        await saveSetting('live_feed_channel', channelId || '');
        await saveSetting('live_feed_status', isEnabled ? '1' : '0');
        await saveSetting('live_feed_title', title || '');
        await saveSetting('live_feed_desc', desc || '');
        await saveSetting('live_feed_color', color || '#F1C40F');
        await saveSetting('live_feed_footer', footer || '');
        await saveSetting('bot_status', botStatus || 'idle');
        await saveSetting('bot_activity_type', botActivityType || 'Custom');
        await saveSetting('bot_activity_text', botActivityText || '');
        await saveSetting('payment_expiry_minutes', (paymentExpiry || 15).toString());
        await saveSetting('catalog_embed_title', catalogTitle || '');
        await saveSetting('catalog_embed_desc', catalogDesc || '');
        await saveSetting('catalog_embed_color', catalogColor || '#5865F2');
        await saveSetting('maintenance_mode', isMaintenance ? '1' : '0');
        await saveSetting('maintenance_text', maintenanceText || '');

        await updateBotPresence(client);
        res.json({ success: true, message: 'Semua Pengaturan Bot berhasil disimpan!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- RCON / CONSOLE EXECUTE API ---
app.post('/api/admin/console/exec', requireAdminAuth, async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) return res.status(400).json({ success: false, message: 'Command tidak boleh kosong' });

        const cleanCmd = command.startsWith('/') ? command.substring(1) : command;
        let outputMessage = '';

        const mcHost = process.env.MC_HOST;
        const mcRconPort = process.env.MC_RCON_PORT;
        const mcRconPassword = process.env.MC_RCON_PASSWORD;

        if (mcHost && mcRconPassword) {
            try {
                const { Rcon } = require('rcon-client');
                const rcon = await Rcon.connect({
                    host: mcHost,
                    port: parseInt(mcRconPort || '20996'),
                    password: mcRconPassword
                });
                outputMessage = await rcon.send(cleanCmd);
                await rcon.end();
            } catch (rconErr) {
                outputMessage = `[RCON ERROR (${mcHost}:${mcRconPort})]: ${rconErr.message}`;
            }
        } else {
            if (cleanCmd.toLowerCase() === 'ping') {
                outputMessage = `[PONG] Gateway Ping: ${client.ws ? client.ws.ping : 0}ms`;
            } else if (cleanCmd.toLowerCase() === 'status') {
                outputMessage = `[STATUS] Bot: ${client.user ? client.user.tag : 'Offline'} | Uptime: ${getUptimeFormatted()}`;
            } else {
                outputMessage = `[EXECUTED] Command '/${cleanCmd}' berhasil diproses.`;
            }
        }

        res.json({ success: true, output: outputMessage });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// --- MIDTRANS WEBHOOK ---
app.post('/webhook/midtrans', (req, res) => handleWebhook(req, res, client));

// --- DISCORD CLIENT READY ---
client.once('ready', async () => {
    await deployCommands();
    const customPassword = await getSetting('admin_password_override');
    if (customPassword) process.env.ADMIN_PASSWORD = customPassword;

    await updateBotPresence(client);
    console.log(`🤖 Bot Discord Online: ${client.user.tag}`);
    console.log(`✨ GalaStore Admin Panel: http://localhost:${process.env.PORT || 6330}/admin.html`);
});

client.on('interactionCreate', (interaction) => handleInteraction(interaction));

const PORT = process.env.PORT || 6330;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

client.login(process.env.DISCORD_TOKEN);