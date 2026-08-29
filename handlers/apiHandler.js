const express = require('express');
const router = express.Router();
const { coreApi } = require('../config/midtrans');
const { getRanksData, saveRank, deleteRank, getSalesStats } = require('../utils/db');

// 1. GET ALL RANKS
router.get('/ranks', (req, res) => {
    try {
        const ranks = getRanksData();
        return res.status(200).json({ success: true, data: ranks });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 2. POST / PUT SAVE RANK (ADMIN DASHBOARD)
router.post('/admin/rank', (req, res) => {
    try {
        const { id, price, discordRoleId, benefits } = req.body;
        if (!id || !price) {
            return res.status(400).json({ success: false, message: 'ID dan Price wajib diisi!' });
        }
        saveRank(id, price, '#00AAFF', discordRoleId, benefits);
        return res.status(200).json({ success: true, message: 'Rank berhasil disimpan!' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 3. DELETE RANK (ADMIN DASHBOARD)
router.delete('/admin/rank/:id', (req, res) => {
    try {
        deleteRank(req.params.id);
        return res.status(200).json({ success: true, message: 'Rank berhasil dihapus!' });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 4. POST WEB CHECKOUT
router.post('/checkout', async (req, res) => {
    try {
        const { mcUsername, discordId, packageType, paymentMethod } = req.body;

        if (!mcUsername || !packageType) {
            return res.status(400).json({ success: false, message: 'Username MC & Package Type Wajib Diisi!' });
        }

        const ranks = getRanksData();
        const rankInfo = ranks[packageType.toUpperCase()];

        if (!rankInfo) {
            return res.status(404).json({ success: false, message: 'Rank tidak ditemukan!' });
        }

        const price = rankInfo.price;
        const orderId = `WEB-${Date.now()}`;

        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: price },
            item_details: [{ id: packageType.toLowerCase(), price: price, quantity: 1, name: `Rank ${packageType} (Minecraft)` }],
            customer_details: { first_name: mcUsername, email: `${discordId || 'guest'}@discord.com` },
            custom_field1: mcUsername,
            custom_field2: discordId || ''
        };

        if (paymentMethod === 'qris') parameter.payment_type = 'gopay';
        else if (paymentMethod === 'bca') { parameter.payment_type = 'bank_transfer'; parameter.bank_transfer = { bank: 'bca' }; }

        const chargeResponse = await coreApi.charge(parameter);

        return res.status(200).json({
            success: true,
            orderId: orderId,
            price: price,
            midtransData: chargeResponse
        });

    } catch (err) {
        console.error('❌ API Checkout Error:', err.message);
        return res.status(500).json({ success: false, message: err.message });
    }
});

// 5. GET ADMIN STATS
router.get('/admin/stats', (req, res) => {
    try {
        const stats = getSalesStats();
        return res.status(200).json({ success: true, data: stats });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;