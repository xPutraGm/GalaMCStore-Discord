const mysql = require('mysql2/promise');
const { ActivityType } = require('discord.js');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gala_mcstore',
    port: parseInt(process.env.DB_PORT || '3306'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS galadc_ranks (
                id VARCHAR(50) PRIMARY KEY,
                price INT NOT NULL,
                color VARCHAR(20) DEFAULT '#00AAFF',
                discord_role_id VARCHAR(50),
                benefits TEXT,
                commands TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS galadc_promos (
                code VARCHAR(50) PRIMARY KEY,
                discount_percent INT NOT NULL,
                max_uses INT NOT NULL,
                used_count INT DEFAULT 0
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS galadc_sales_history (
                order_id VARCHAR(100) PRIMARY KEY,
                mc_username VARCHAR(50),
                discord_id VARCHAR(50),
                package VARCHAR(50),
                amount INT,
                timestamp BIGINT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS galadc_settings (
                setting_key VARCHAR(50) PRIMARY KEY,
                setting_value TEXT
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        const [rows] = await pool.query('SELECT COUNT(*) as total FROM galadc_ranks');
        if (rows[0].total === 0) {
            console.log('🌱 Seeding Data Awal Rank ke MySQL Database (galadc_ranks)...');
            const insertQuery = 'INSERT INTO galadc_ranks (id, price, color, discord_role_id, benefits, commands) VALUES (?, ?, ?, ?, ?, ?)';
            
            await pool.query(insertQuery, [
                'VIP', 25000, '#F1C40F', '', JSON.stringify([
                    '• Prefix Tag [VIP] di In-Game & Discord',
                    '• Akses Command /fly di Survival World',
                    '• 3x Set Home (/sethome)',
                    '• Claim Land hingga 10 Chunk'
                ]), JSON.stringify([
                    'luckperms user {player} parent set vip',
                    'eco give {player} 25000',
                    'broadcast &a&l[GalaStore] &e{player} &fbaru saja membeli &bRank VIP!'
                ])
            ]);

            await pool.query(insertQuery, [
                'MVP', 50000, '#9B59B6', '', JSON.stringify([
                    '• Semua Benefit VIP',
                    '• Prefix Tag [MVP] Berwarna Purple Glow',
                    '• Akses Command /heal & /feed',
                    '• Unlimited Set Home (/sethome)'
                ]), JSON.stringify([
                    'luckperms user {player} parent set mvp',
                    'eco give {player} 50000',
                    'crate give {player} mvp_key 2',
                    'broadcast &a&l[GalaStore] &e{player} &fbaru saja membeli &bRank MVP!'
                ])
            ]);
        }
        console.log('✅ Database MySQL Terhubung & Terinisialisasi dengan Prefix galadc_!');
    } catch (err) {
        console.error('❌ Database MySQL Init Error:', err.message);
    }
}

async function getRanksData() {
    const [rows] = await pool.query('SELECT * FROM galadc_ranks');
    const result = {};
    for (const row of rows) {
        result[row.id] = {
            price: row.price,
            color: row.color,
            discordRoleId: row.discord_role_id,
            benefits: typeof row.benefits === 'string' ? JSON.parse(row.benefits || '[]') : (row.benefits || []),
            commands: typeof row.commands === 'string' ? JSON.parse(row.commands || '[]') : (row.commands || [])
        };
    }
    return result;
}

async function saveRank(id, price, color, discordRoleId, benefits, commands) {
    const query = `
        INSERT INTO galadc_ranks (id, price, color, discord_role_id, benefits, commands)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            price = VALUES(price),
            color = VALUES(color),
            discord_role_id = VALUES(discord_role_id),
            benefits = VALUES(benefits),
            commands = VALUES(commands)
    `;
    await pool.query(query, [
        id, 
        price, 
        color || '#00AAFF', 
        discordRoleId || '', 
        JSON.stringify(benefits || []),
        JSON.stringify(commands || [])
    ]);
}

async function deleteRank(id) {
    await pool.query('DELETE FROM galadc_ranks WHERE id = ?', [id]);
}

async function getPromosData() {
    const [rows] = await pool.query('SELECT * FROM galadc_promos');
    const result = {};
    for (const row of rows) {
        result[row.code] = {
            discountPercent: row.discount_percent,
            maxUses: row.max_uses,
            usedCount: row.used_count
        };
    }
    return result;
}

async function savePromo(code, discountPercent, maxUses) {
    const query = `
        INSERT INTO galadc_promos (code, discount_percent, max_uses, used_count)
        VALUES (?, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
            discount_percent = VALUES(discount_percent),
            max_uses = VALUES(max_uses)
    `;
    await pool.query(query, [code.toUpperCase(), discountPercent, maxUses]);
}

async function incrementPromoUse(code) {
    await pool.query('UPDATE galadc_promos SET used_count = used_count + 1 WHERE code = ?', [code.toUpperCase()]);
}

async function deletePromo(code) {
    await pool.query('DELETE FROM galadc_promos WHERE code = ?', [code]);
}

async function recordSale(orderId, mcUsername, discordId, packageName, amount) {
    const query = `
        INSERT IGNORE INTO galadc_sales_history (order_id, mc_username, discord_id, package, amount, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    await pool.query(query, [orderId, mcUsername, discordId || '', packageName, amount, Date.now()]);
}

async function getSalesStats() {
    const [rows] = await pool.query('SELECT * FROM galadc_sales_history');
    const totalRevenue = rows.reduce((acc, curr) => acc + curr.amount, 0);
    return {
        totalRevenue,
        totalTransactions: rows.length,
        history: rows
    };
}

async function getSetting(key) {
    const [rows] = await pool.query('SELECT setting_value FROM galadc_settings WHERE setting_key = ?', [key]);
    return rows.length > 0 ? rows[0].setting_value : null;
}

async function saveSetting(key, value) {
    await pool.query(`
        INSERT INTO galadc_settings (setting_key, setting_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
    `, [key, value]);
}

// HELPER UPDATE REALTIME PRESENCE DISCORD
async function updateBotPresence(client) {
    if (!client || !client.user) return;
    try {
        const status = await getSetting('bot_status') || 'idle';
        const typeStr = await getSetting('bot_activity_type') || 'Custom';
        const text = await getSetting('bot_activity_text') || 'Ketik /buyrank | GalaMC Store 🛒';

        let actType = ActivityType.Custom;
        if (typeStr === 'Playing') actType = ActivityType.Playing;
        else if (typeStr === 'Streaming') actType = ActivityType.Streaming;
        else if (typeStr === 'Listening') actType = ActivityType.Listening;
        else if (typeStr === 'Watching') actType = ActivityType.Watching;

        client.user.setPresence({
            activities: [{ name: text, type: actType }],
            status: status
        });
        console.log(`🤖 [PRESENCE UPDATED] Status: ${status} | Type: ${typeStr} | Text: "${text}"`);
    } catch (e) {
        console.error('⚠️ Gagal update presence bot:', e.message);
    }
}

module.exports = {
    initDatabase,
    getRanksData,
    saveRank,
    deleteRank,
    getPromosData,
    savePromo,
    incrementPromoUse,
    deletePromo,
    recordSale,
    getSalesStats,
    getSetting,
    saveSetting,
    updateBotPresence
};