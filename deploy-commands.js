require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

async function deployCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('buyrank')
            .setDescription('Melihat katalog rank dan melakukan pembelian'),

        new SlashCommandBuilder()
            .setName('setup-store')
            .setDescription('Mengirimkan embed toko dan tombol pembelian permanen ke channel ini')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('admin-panel')
            .setDescription('Buka Dashboard Admin Store')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        // === COMMAND PROMO MANAGEMENT ===
        new SlashCommandBuilder()
            .setName('admin-promo')
            .setDescription('Mengelola Kode Promo Diskon (Dev/Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addSubcommand(sub =>
                sub.setName('add')
                   .setDescription('Buat kode promo baru')
                   .addStringOption(opt => opt.setName('code').setDescription('Kode Promo (Misal: DISKON10)').setRequired(true))
                   .addIntegerOption(opt => opt.setName('percent').setDescription('Persentase Diskon (Misal: 10 untuk 10%)').setRequired(true))
                   .addIntegerOption(opt => opt.setName('max_use').setDescription('Maksimal Penggunaan').setRequired(true))
            )
            .addSubcommand(sub =>
                sub.setName('list')
                   .setDescription('Lihat daftar kode promo aktif')
            ),

        // === COMMAND STATISTIK OMSET ===
        new SlashCommandBuilder()
            .setName('admin-stats')
            .setDescription('Lihat Laporan Penjualan & Total Omset Store (Dev/Admin Only)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('testrcon')
            .setDescription('Tes koneksi RCON ke Server Minecraft')
            .addStringOption(option => option.setName('command').setDescription('Command MC').setRequired(false))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('⏳ Deploying Slash Commands...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Slash Commands Updated!');
    } catch (error) {
        console.error('❌ Gagal deploy commands:', error);
    }
}

module.exports = deployCommands;