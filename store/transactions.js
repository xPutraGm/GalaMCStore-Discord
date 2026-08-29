const fs = require('fs');
const path = require('path');

const ranksFilePath = path.join(__dirname, '../ranks.json');
const activeTransactions = new Map();
const PAYMENT_EXPIRY_MINUTES = 15;

// Read Data Rank dari File JSON
function getRanksData() {
    try {
        const data = fs.readFileSync(ranksFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('❌ Gagal membaca ranks.json:', err.message);
        return {};
    }
}

// Update Data Rank ke File JSON
function saveRanksData(data) {
    try {
        fs.writeFileSync(ranksFilePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('❌ Gagal menyimpan ranks.json:', err.message);
        return false;
    }
}

module.exports = {
    activeTransactions,
    PAYMENT_EXPIRY_MINUTES,
    getRanksData,
    saveRanksData
};