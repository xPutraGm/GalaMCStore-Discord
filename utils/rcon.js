const { Rcon } = require('rcon-client');

async function sendRconCommand(command) {
    try {
        const rcon = await Rcon.connect({
            host: process.env.MC_HOST,
            port: parseInt(process.env.MC_RCON_PORT),
            password: process.env.MC_RCON_PASSWORD,
            timeout: 5000
        });

        console.log(`🚀 [RCON SEND]: "${command}"`);
        const response = await rcon.send(command);
        console.log(`📡 [RCON RESPONSE]: "${response}"`);
        await rcon.end();
        return { success: true, response };
    } catch (err) {
        console.error('❌ [RCON ERROR]:', err.message);
        return { success: false, error: err.message };
    }
}

// PASTIIN BARIS INI ADA DI PALING BAWAH!
module.exports = { sendRconCommand };