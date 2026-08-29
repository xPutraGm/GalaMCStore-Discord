require('dotenv').config();
const midtransClient = require('midtrans-client');

const isProd = process.env.IS_PRODUCTION === 'true';

const coreApi = new midtransClient.CoreApi({
    isProduction: isProd,
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

module.exports = { coreApi, isProd };