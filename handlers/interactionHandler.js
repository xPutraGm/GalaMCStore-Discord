const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder 
} = require('discord.js');
const { coreApi } = require('../config/midtrans');
const { getRanksData, saveRanksData, PAYMENT_EXPIRY_MINUTES, activeTransactions } = require('../store/transactions');
const { sendRconCommand } = require('../utils/rcon');

async function handleInteraction(interaction) {
    if (!interaction) return;

    const ranksData = getRanksData();

    // HELPER BUILD EMBED KATALOG
    function buildCatalogEmbed(client) {
        const catalogEmbed = new EmbedBuilder()
            .setTitle('🛒 MC SERVER OFFICIAL STORE')
            .setDescription('Selamat datang di Official Store! Pilih tombol di bawah untuk membeli rank diri sendiri atau mengirim hadiah ke teman.')
            .setColor('#5865F2')
            .setThumbnail(client.user.displayAvatarURL())
            .setTimestamp();

        for (const [rankName, rankInfo] of Object.entries(ranksData)) {
            if (rankName === 'promos' || rankName === 'salesHistory') continue;
            catalogEmbed.addFields({
                name: `✨ Rank ${rankName} - Rp ${rankInfo.price.toLocaleString('id-ID')}`,
                value: (rankInfo.benefits && rankInfo.benefits.length > 0 ? rankInfo.benefits.join('\n') : '• Benefit belum diisi') + '\n\u200B',
                inline: false
            });
        }
        return catalogEmbed;
    }

    // === 1. COMMAND /setup-store & /buyrank ===
    if (interaction.isChatInputCommand() && (interaction.commandName === 'setup-store' || interaction.commandName === 'buyrank')) {
        await interaction.deferReply({ ephemeral: true });

        const catalogEmbed = buildCatalogEmbed(interaction.client);
        
        // 2 TOMBOL TERPISAH: BUY & GIFT
        const buySelfBtn = new ButtonBuilder()
            .setCustomId('btn_open_modal_self')
            .setLabel('🛒 Buy Rank (Self)')
            .setStyle(ButtonStyle.Success);

        const buyGiftBtn = new ButtonBuilder()
            .setCustomId('btn_open_modal_gift')
            .setLabel('🎁 Gift Rank to Friend')
            .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(buySelfBtn, buyGiftBtn);

        if (interaction.commandName === 'setup-store') {
            await interaction.channel.send({ embeds: [catalogEmbed], components: [row] });
            await interaction.editReply({ content: '✅ Embed Toko Permanen dipasang!' });
        } else {
            await interaction.editReply({ embeds: [catalogEmbed], components: [row] });
        }
    }

    // === 2A. MODAL FORM: BUY FOR SELF ===
    if (interaction.isButton() && interaction.customId === 'btn_open_modal_self') {
        const modal = new ModalBuilder()
            .setCustomId('modal_buy_self')
            .setTitle('Checkout Rank Minecraft');

        const usernameInput = new TextInputBuilder()
            .setCustomId('input_mc_username')
            .setLabel('Username Minecraft Kamu')
            .setPlaceholder('Contoh: Stev3_ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const promoInput = new TextInputBuilder()
            .setCustomId('input_promo_code')
            .setLabel('Kode Promo / Diskon (Opsional)')
            .setPlaceholder('Kosongkan jika tidak ada')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(usernameInput),
            new ActionRowBuilder().addComponents(promoInput)
        );

        await interaction.showModal(modal);
    }

    // === 2B. MODAL FORM: GIFT TO FRIEND ===
    if (interaction.isButton() && interaction.customId === 'btn_open_modal_gift') {
        const modal = new ModalBuilder()
            .setCustomId('modal_buy_gift')
            .setTitle('Gift Rank to Friend');

        const usernameInput = new TextInputBuilder()
            .setCustomId('input_mc_username')
            .setLabel('Username MC Penerima Hadiah')
            .setPlaceholder('Contoh: Budi_Gamer99')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        const giftDiscordInput = new TextInputBuilder()
            .setCustomId('input_gift_discord_id')
            .setLabel('Discord ID Penerima (Opsional)')
            .setPlaceholder('Contoh: 800653335479975996')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        const promoInput = new TextInputBuilder()
            .setCustomId('input_promo_code')
            .setLabel('Kode Promo / Diskon (Opsional)')
            .setPlaceholder('Kosongkan jika tidak ada')
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

        modal.addComponents(
            new ActionRowBuilder().addComponents(usernameInput),
            new ActionRowBuilder().addComponents(giftDiscordInput),
            new ActionRowBuilder().addComponents(promoInput)
        );

        await interaction.showModal(modal);
    }

    // === 3. SUBMIT MODAL (SELF / GIFT) -> CHECK PROMO & SELECT RANK ===
    if (interaction.isModalSubmit() && (interaction.customId === 'modal_buy_self' || interaction.customId === 'modal_buy_gift')) {
        const isGift = interaction.customId === 'modal_buy_gift';
        
        const mcUsername = interaction.fields.getTextInputValue('input_mc_username').trim();
        const giftDiscordId = isGift ? interaction.fields.getTextInputValue('input_gift_discord_id').trim() : '';
        const promoCode = interaction.fields.getTextInputValue('input_promo_code').trim().toUpperCase();

        // Tentukan Discord ID Penerima Role (Jika Gift diisi ID teman, kalau Self / Kosong pake ID pembeli)
        const targetDiscordId = giftDiscordId ? giftDiscordId : interaction.user.id;
        const isTrueGift = isGift && giftDiscordId && giftDiscordId !== interaction.user.id;

        let appliedDiscount = 0;
        let promoSuccessText = '';

        // VALIDASI KODE PROMO
        if (promoCode) {
            const promos = ranksData.promos || {};
            const promo = promos[promoCode];

            if (promo && promo.usedCount < promo.maxUses) {
                appliedDiscount = promo.discountPercent;
                promoSuccessText = `\n🎉 **Kode Promo Diskon ${appliedDiscount}% Diterapkan!** (\`${promoCode}\`)`;
            } else {
                promoSuccessText = `\n⚠️ *Kode promo "${promoCode}" tidak valid atau sudah habis.*`;
            }
        }

        const rankSelect = new StringSelectMenuBuilder()
            .setCustomId(`select_rank_only_${mcUsername}_${targetDiscordId}_${appliedDiscount}`)
            .setPlaceholder('👑 Pilih Rank Yang Ingin Dibeli...');

        for (const [rankName, rankInfo] of Object.entries(ranksData)) {
            if (rankName === 'promos' || rankName === 'salesHistory') continue;

            let finalPrice = rankInfo.price;
            if (appliedDiscount > 0) {
                finalPrice = Math.round(finalPrice * (1 - appliedDiscount / 100));
            }

            rankSelect.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Rank ${rankName} (Rp ${finalPrice.toLocaleString('id-ID')})`)
                    .setValue(rankName)
                    .setDescription(`${isTrueGift ? 'Gift ke' : 'Beli untuk'} ${mcUsername}`)
                    .setEmoji('⭐')
            );
        }

        const row = new ActionRowBuilder().addComponents(rankSelect);
        const rankEmbed = new EmbedBuilder()
            .setTitle(`📌 Langkah 1: Pilih Rank (${isTrueGift ? '🎁 Gift' : '🛒 Personal'})`)
            .setDescription(`**Target Player MC:** \`${mcUsername}\`\n**Target Discord Role:** <@${targetDiscordId}>${promoSuccessText}\n\nSilakan pilih **Rank** yang ingin kamu beli di bawah ini:`)
            .setColor('#00AAFF');

        await interaction.reply({ embeds: [rankEmbed], components: [row], ephemeral: true });
    }

    // === 4. SELECT RANK -> SMART RANK VERIFICATION & PAYMENT METHOD ===
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_rank_only_')) {
        await interaction.deferUpdate();

        const parts = interaction.customId.split('_');
        const appliedDiscount = parseInt(parts.pop()) || 0;
        const targetDiscordId = parts.pop();
        const selectedPackage = interaction.values[0];
        const mcUsername = parts.slice(3).join('_');

        const targetRankConfig = ranksData[selectedPackage];

        // SMART VERIFICATION: Cek Role Discord (Bisa Cek ke Diri Sendiri atau Teman)
        try {
            const guild = interaction.guild;
            if (guild && targetRankConfig?.discordRoleId) {
                const targetMember = await guild.members.fetch(targetDiscordId).catch(() => null);
                if (targetMember && targetMember.roles.cache.has(targetRankConfig.discordRoleId)) {
                    const isSelf = targetDiscordId === interaction.user.id;
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('⚠️ Pembelian Dibatalkan!')
                        .setDescription(`${isSelf ? 'Kamu' : `<@${targetDiscordId}>`} **sudah memiliki Rank ${selectedPackage}**!\n\nPilih rank lain atau pastikan akun penerima belum memiliki rank tersebut.`)
                        .setColor('#ED4245');

                    return await interaction.editReply({ embeds: [errorEmbed], components: [] });
                }
            }
        } catch (e) {
            // Ignore error jika member tidak ada di guild
        }

        // Kalkulasi Harga Diskon
        let finalPrice = targetRankConfig.price;
        if (appliedDiscount > 0) {
            finalPrice = Math.round(finalPrice * (1 - appliedDiscount / 100));
        }

        const paymentSelect = new StringSelectMenuBuilder()
            .setCustomId(`select_pay_only_${mcUsername}_${targetDiscordId}_${selectedPackage}_${finalPrice}`)
            .setPlaceholder('💳 Pilih Metode Pembayaran...')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('QRIS (GoPay, DANA, OVO, ShopeePay)').setValue('qris').setDescription('Scan QRIS').setEmoji('📱'),
                new StringSelectMenuOptionBuilder().setLabel('BCA Virtual Account').setValue('bca_va').setDescription('Transfer BCA').setEmoji('🏦'),
                new StringSelectMenuOptionBuilder().setLabel('Mandiri Virtual Account').setValue('mandiri_va').setDescription('Transfer Mandiri').setEmoji('🏦'),
                new StringSelectMenuOptionBuilder().setLabel('BRI Virtual Account').setValue('bri_va').setDescription('Transfer BRI').setEmoji('🏦')
            );

        const row = new ActionRowBuilder().addComponents(paymentSelect);
        const payEmbed = new EmbedBuilder()
            .setTitle('📌 Langkah 2: Pilih Metode Pembayaran')
            .setDescription(`**Target Username MC:** \`${mcUsername}\`\n**Penerima Role:** <@${targetDiscordId}>\n**Rank Terpilih:** \`Rank ${selectedPackage}\`\n**Total Bayar:** Rp ${finalPrice.toLocaleString('id-ID')}${appliedDiscount > 0 ? ` *(Diskon ${appliedDiscount}%)*` : ''}\n\nPilih **Metode Pembayaran** di bawah ini:`)
            .setColor('#00AAFF');

        await interaction.editReply({ embeds: [payEmbed], components: [row] });
    }

    // === 5. SELECT PAYMENT -> CHARGE MIDTRANS ===
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_pay_only_')) {
        await interaction.deferUpdate();

        const parts = interaction.customId.split('_');
        const price = parseInt(parts.pop());
        const packageType = parts.pop();
        const targetDiscordId = parts.pop();
        const mcUsername = parts.slice(3).join('_');
        const paymentMethod = interaction.values[0];

        const orderId = `MC-${Date.now()}`;
        const expiryMinutes = PAYMENT_EXPIRY_MINUTES || 15;
        const expiryTime = Math.floor(Date.now() / 1000) + (expiryMinutes * 60);

        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: price },
            item_details: [{ id: packageType.toLowerCase(), price: price, quantity: 1, name: `Rank ${packageType} (Minecraft)` }],
            customer_details: { first_name: mcUsername, last_name: `(MC)`, email: `${interaction.user.id}@discord.com` },
            custom_field1: mcUsername,
            custom_field2: targetDiscordId,
            custom_expiry: { expiry_duration: expiryMinutes, unit: 'minute' }
        };

        if (paymentMethod === 'qris') parameter.payment_type = 'gopay';
        else if (paymentMethod === 'bca_va') { parameter.payment_type = 'bank_transfer'; parameter.bank_transfer = { bank: 'bca' }; }
        else if (paymentMethod === 'mandiri_va') { parameter.payment_type = 'echannel'; parameter.echannel = { bill_info1: 'Pembayaran:', bill_info2: `Rank ${packageType}` }; }
        else if (paymentMethod === 'bri_va') { parameter.payment_type = 'bank_transfer'; parameter.bank_transfer = { bank: 'bri' }; }

        try {
            console.log(`\n[CHARGE INITIATED] OrderID: ${orderId} | MC: ${mcUsername} | TargetDiscord: ${targetDiscordId} | Price: Rp${price}`);
            const chargeResponse = await coreApi.charge(parameter);
            const embed = new EmbedBuilder().setColor('#F1C40F');

            const isGift = targetDiscordId !== interaction.user.id;
            const giftText = isGift ? `\n🎁 **Gift Untuk:** <@${targetDiscordId}>` : '';

            if (paymentMethod === 'qris') {
                const qrAction = chargeResponse.actions?.find(action => action.name === 'generate-qr-code');
                embed.setTitle(`📱 Tagihan QRIS: Rank ${packageType}`)
                     .setDescription(`**Status:** ⏳ \`WAITING FOR PAYMENT\`\n\n**Target Player MC:** \`${mcUsername}\`${giftText}\n**Total Bayar:** Rp${price.toLocaleString('id-ID')}\n**Order ID:** \`${orderId}\`\n\n⏰ **Batas Waktu:** <t:${expiryTime}:R>\n\nScan QRIS di bawah ini:`)
                     .setImage(qrAction ? qrAction.url : null);
            } else {
                let vaNumber = chargeResponse.va_numbers?.[0]?.va_number || chargeResponse.bill_key || 'Lihat Kode';
                embed.setTitle(`🏦 Virtual Account: Rank ${packageType}`)
                     .setDescription(`**Status:** ⏳ \`WAITING FOR PAYMENT\`\n\n**Target Player MC:** \`${mcUsername}\`${giftText}\n**Total Bayar:** Rp${price.toLocaleString('id-ID')}\n**Order ID:** \`${orderId}\`\n\n📌 **Kode Bayar / VA:**\n\`\`\`text\n${vaNumber}\n\`\`\`\n⏰ **Batas Waktu:** <t:${expiryTime}:R>`);
            }

            await interaction.editReply({ embeds: [embed], components: [] });

            activeTransactions.set(orderId, {
                interaction: interaction,
                mcUsername: mcUsername,
                packageType: packageType,
                price: price,
                targetDiscordId: targetDiscordId
            });

        } catch (err) {
            console.error('❌ Midtrans Charge Error:', err.message);
            await interaction.editReply({ content: '❌ Gagal membuat tagihan pembayaran.', components: [] });
        }
    }

    // === 6. COMMAND ADMIN PROMO MANAGEMENT ===
    if (interaction.isChatInputCommand() && interaction.commandName === 'admin-promo') {
        const sub = interaction.options.getSubcommand();
        if (!ranksData.promos) ranksData.promos = {};

        if (sub === 'add') {
            const code = interaction.options.getString('code').toUpperCase().trim();
            const percent = interaction.options.getInteger('percent');
            const maxUse = interaction.options.getInteger('max_use');

            ranksData.promos[code] = { discountPercent: percent, maxUses: maxUse, usedCount: 0 };
            saveRanksData(ranksData);

            await interaction.reply({ content: `✅ Kode Promo **${code}** (Diskon ${percent}%, Max ${maxUse}x pakai) berhasil dibuat!`, ephemeral: true });
        } else if (sub === 'list') {
            let text = '🎟️ **DAFTAR KODE PROMO AKTIF:**\n';
            for (const [code, info] of Object.entries(ranksData.promos)) {
                text += `• **${code}**: Diskon ${info.discountPercent}% (${info.usedCount}/${info.maxUses}x digunakan)\n`;
            }
            await interaction.reply({ content: text || 'Belum ada promo aktif.', ephemeral: true });
        }
    }

    // === 7. COMMAND ADMIN STATS ===
    if (interaction.isChatInputCommand() && interaction.commandName === 'admin-stats') {
        const history = ranksData.salesHistory || [];
        const totalRevenue = history.reduce((acc, curr) => acc + curr.amount, 0);

        const embed = new EmbedBuilder()
            .setTitle('📊 LAPORAN OMSET & PENJUALAN TOKO')
            .setDescription(`**Total Pemasukan Clean:** Rp ${totalRevenue.toLocaleString('id-ID')}\n**Total Transaksi Lunas:** ${history.length} Transaksi`)
            .setColor('#57F287')
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // === 8. COMMAND TEST RCON ===
    if (interaction.isChatInputCommand() && interaction.commandName === 'testrcon') {
        await interaction.deferReply({ ephemeral: true });
        const customCommand = interaction.options.getString('command') || 'list';
        const res = await sendRconCommand(customCommand);

        if (res.success) {
            const successEmbed = new EmbedBuilder().setTitle('🟢 RCON Connected!').setDescription(`\`\`\`text\n${res.response || 'No Output'}\n\`\`\``).setColor('#57F287');
            await interaction.editReply({ embeds: [successEmbed] });
        } else {
            await interaction.editReply({ content: `🔴 RCON Failed: ${res.error}` });
        }
    }
}

module.exports = { handleInteraction };