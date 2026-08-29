const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../database.db'));

function initDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS ranks (
            id TEXT PRIMARY KEY,
            price INTEGER NOT NULL,
            color TEXT DEFAULT '#00AAFF',
            discord_role_id TEXT,
            benefits TEXT,
            commands TEXT
        );

        CREATE TABLE IF NOT EXISTS promos (
            code TEXT PRIMARY KEY,
            discount_percent INTEGER NOT NULL,
            max_uses INTEGER NOT NULL,
            used_count INTEGER DEFAULT 0
        );
    `);

    // Migrasi otomatis jika kolom commands belum ada di database lama
    try {
        db.exec(`ALTER TABLE ranks ADD COLUMN commands TEXT;`);
    } catch (e) {
        // Kolom sudah ada, abaikan error
    }

    const count = db.prepare('SELECT COUNT(*) as total FROM ranks').get();
    if (count.total === 0) {
        console.log('🌱 Seeding Data Awal Rank ke SQLite Database...');
        const insertRank = db.prepare('INSERT INTO ranks (id, price, color, discord_role_id, benefits, commands) VALUES (?, ?, ?, ?, ?, ?)');
        
        insertRank.run('VIP', 25000, '#F1C40F', '', JSON.stringify([
            '• Prefix Tag [VIP] di In-Game & Discord',
            '• Akses Command /fly di Survival World',
            '• 3x Set Home (/sethome)',
            '• Claim Land hingga 10 Chunk'
        ]), JSON.stringify([
            'luckperms user {player} parent set vip',
            'eco give {player} 25000',
            'broadcast &a&l[GalaStore] &e{player} &fbaru saja membeli &bRank VIP!'
        ]));

        insertRank.run('MVP', 50000, '#9B59B6', '', JSON.stringify([
            '• Semua Benefit VIP',
            '• Prefix Tag [MVP] Berwarna Purple Glow',
            '• Akses Command /heal & /feed',
            '• Unlimited Set Home (/sethome)'
        ]), JSON.stringify([
            'luckperms user {player} parent set mvp',
            'eco give {player} 50000',
            'crate give {player} mvp_key 2',
            'broadcast &a&l[GalaStore] &e{player} &fbaru saja membeli &bRank MVP!'
        ]));
    }
}

function getRanksData() {
    const rows = db.prepare('SELECT * FROM ranks').all();
    const result = {};
    for (const row of rows) {
        result[row.id] = {
            price: row.price,
            color: row.color,
            discordRoleId: row.discord_role_id,
            benefits: JSON.parse(row.benefits || '[]'),
            commands: JSON.parse(row.commands || '[]')
        };
    }
    return result;
}

function saveRank(id, price, color, discordRoleId, benefits, commands) {
    const stmt = db.prepare(`
        INSERT INTO ranks (id, price, color, discord_role_id, benefits, commands)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            price=excluded.price,
            color=excluded.color,
            discord_role_id=excluded.discord_role_id,
            benefits=excluded.benefits,
            commands=excluded.commands
    `);
    stmt.run(
        id, 
        price, 
        color || '#00AAFF', 
        discordRoleId || '', 
        JSON.stringify(benefits || []),
        JSON.stringify(commands || [])
    );
}

function deleteRank(id) {
    db.prepare('DELETE FROM ranks WHERE id = ?').run(id);
}

function getPromosData() {
    return db.prepare('SELECT * FROM promos').all();
}

function savePromo(code, discountPercent, maxUses) {
    const stmt = db.prepare(`
        INSERT INTO promos (code, discount_percent, max_uses, used_count)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(code) DO UPDATE SET
            discount_percent=excluded.discount_percent,
            max_uses=excluded.max_uses
    `);
    stmt.run(code.toUpperCase(), discountPercent, maxUses);
}

function deletePromo(code) {
    db.prepare('DELETE FROM promos WHERE code = ?').run(code);
}

module.exports = {
    initDatabase,
    getRanksData,
    saveRank,
    deleteRank,
    getPromosData,
    savePromo,
    deletePromo
};