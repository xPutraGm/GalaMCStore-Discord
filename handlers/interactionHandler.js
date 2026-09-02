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
const { getRanksData, getPromosData, savePromo, getSalesStats, getSetting } = require('../utils/db');
const { activeTransactions } = require('../store/transactions');
const { sendRconCommand } = require('../utils/rcon');

async function handleInteraction(interaction) {
    if (!interaction) return;

    // CEK MAINTENANCE MODE
    const isMaintenance = (await getSetting('maintenance_mode')) === '1';
    if (isMaintenance && !interaction.memberPermissions?.has('Administrator')) {
        const maintText = await getSetting('maintenance_text') || '⚠️ Store sedang dalam pemeliharaan (Maintenance). Silakan coba lagi nanti!';
        const maintEmbed = new EmbedBuilder().setTitle('🛠️ STORE MAINTENANCE').setDescription(maintText).setColor('#ED4245');
        
        if (interaction.isRepliable()) {
            return await interaction.reply({ embeds: [maintEmbed], ephemeral: true });
        }
    }

    const ranksData = await getRanksData();

    // HELPER BUILD EMBED KATALOG DINAMIS (HANYA TAMPILKAN RANK AKTIF & KETERANGAN HARGA PERMANENT/TEMPORARY)
    async function buildCatalogEmbed(client) {
        const title = await getSetting('catalog_embed_title') || '🛒 MC SERVER OFFICIAL STORE';
        const desc = await getSetting('catalog_embed_desc') || 'Selamat datang di Official Store! Pilih tombol di bawah untuk membeli rank diri sendiri atau mengirim hadiah ke teman.';
        const color = await getSetting('catalog_embed_color') || '#5865F2';

        const catalogEmbed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc)
            .setColor(color)
            .setThumbnail(client.user.displayAvatarURL())
            .setTimestamp();

        for (const [rankName, rankInfo] of Object.entries(ranksData)) {
            // FILTER: SISIHKAN RANK JIKA STATUS ISACTIVE === FALSE
            if (rankInfo.isActive === false) continue;

            let priceDisplay = '';
            if (rankInfo.allowPermanent !== false && rankInfo.allowTemporary === true) {
                priceDisplay = `Rp ${(rankInfo.price || 0).toLocaleString('id-ID')} (Perm) / Rp ${(rankInfo.tempPrice || 0).toLocaleString('id-ID')} (${rankInfo.durationDays || 30}d)`;
            } else if (rankInfo.allowTemporary === true) {
                priceDisplay = `Rp ${(rankInfo.tempPrice || 0).toLocaleString('id-ID')} (${rankInfo.durationDays || 30} Days)`;
            } else {
                priceDisplay = `Rp ${(rankInfo.price || 0).toLocaleString('id-ID')} (Permanent)`;
            }

            catalogEmbed.addFields({
                name: `✨ Rank ${rankName} - ${priceDisplay}`,
                value: (rankInfo.benefits && rankInfo.benefits.length > 0 ? rankInfo.benefits.join('\n') : '• Benefit belum diisi') + '\n\u200B',
                inline: false
            });
        }
        return catalogEmbed;
    }

    // === 1. COMMAND /setup-store & /buyrank ===
    if (interaction.isChatInputCommand() && (interaction.commandName === 'setup-store' || interaction.commandName === 'buyrank')) {
        await interaction.deferReply({ ephemeral: true });

        const catalogEmbed = await buildCatalogEmbed(interaction.client);
        
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

    // === 3. SUBMIT MODAL (SELF / GIFT) ===
    if (interaction.isModalSubmit() && (interaction.customId === 'modal_buy_self' || interaction.customId === 'modal_buy_gift')) {
        const isGift = interaction.customId === 'modal_buy_gift';
        
        const mcUsername = interaction.fields.getTextInputValue('input_mc_username').trim();
        const giftDiscordId = isGift ? interaction.fields.getTextInputValue('input_gift_discord_id').trim() : '';
        const promoCode = interaction.fields.getTextInputValue('input_promo_code').trim().toUpperCase();

        const targetDiscordId = giftDiscordId ? giftDiscordId : interaction.user.id;
        const isTrueGift = isGift && giftDiscordId && giftDiscordId !== interaction.user.id;

        let appliedDiscount = 0;
        let promoSuccessText = '';

        if (promoCode) {
            const promos = await getPromosData();
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

        let hasActiveRank = false;
        for (const [rankName, rankInfo] of Object.entries(ranksData)) {
            // SISIHKAN JIKA RANK NON-AKTIF (DISABLED)
            if (rankInfo.isActive === false) continue;
            hasActiveRank = true;

            let priceLabel = '';
            if (rankInfo.allowPermanent !== false && rankInfo.allowTemporary === true) {
                priceLabel = `Opsi Perm & Temp (${rankInfo.durationDays || 30}d)`;
            } else if (rankInfo.allowTemporary === true) {
                let p = rankInfo.tempPrice;
                if (appliedDiscount > 0) p = Math.round(p * (1 - appliedDiscount / 100));
                priceLabel = `Rp ${p.toLocaleString('id-ID')} (Temp ${rankInfo.durationDays || 30}d)`;
            } else {
                let p = rankInfo.price;
                if (appliedDiscount > 0) p = Math.round(p * (1 - appliedDiscount / 100));
                priceLabel = `Rp ${p.toLocaleString('id-ID')} (Permanent)`;
            }

            rankSelect.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(`Rank ${rankName} - ${priceLabel}`)
                    .setValue(rankName)
                    .setDescription(`${isTrueGift ? 'Gift ke' : 'Beli untuk'} ${mcUsername}`)
                    .setEmoji('⭐')
            );
        }

        if (!hasActiveRank) {
            return await interaction.reply({ content: '⚠️ Maaf, saat ini tidak ada rank yang sedang aktif di toko.', ephemeral: true });
        }

        const row = new ActionRowBuilder().addComponents(rankSelect);
        const rankEmbed = new EmbedBuilder()
            .setTitle(`📌 Langkah 1: Pilih Rank (${isTrueGift ? '🎁 Gift' : '🛒 Personal'})`)
            .setDescription(`**Target Player MC:** \`${mcUsername}\`\n**Target Discord Role:** <@${targetDiscordId}>${promoSuccessText}\n\nSilakan pilih **Rank** yang ingin kamu beli di bawah ini:`)
            .setColor('#00AAFF');

        await interaction.reply({ embeds: [rankEmbed], components: [row], ephemeral: true });
    }

    // === 4. SELECT RANK (DENGAN DYNAMIC TYPE & DURATION CHECK) ===
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_rank_only_')) {
        await interaction.deferUpdate();

        const parts = interaction.customId.split('_');
        const appliedDiscount = parseInt(parts.pop()) || 0;
        const targetDiscordId = parts.pop();
        const selectedPackage = interaction.values[0];
        const mcUsername = parts.slice(3).join('_');

        const targetRankConfig = ranksData[selectedPackage];

        if (!targetRankConfig || targetRankConfig.isActive === false) {
            const errEmb = new EmbedBuilder()
                .setTitle('⚠️ Rank Tidak Tersedia')
                .setDescription('Maaf, rank ini telah dinonaktifkan atau dihapus oleh Admin.')
                .setColor('#ED4245');
            return await interaction.editReply({ embeds: [errEmb], components: [] });
        }

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
            // Member tidak ada di guild
        }

        // JIKA BOTH ACTIVE (PERMANENT & TEMPORARY SAMA-SAMA AKTIF), PROMPT PILIH TYPE DAHULU!
        if (targetRankConfig.allowPermanent !== false && targetRankConfig.allowTemporary === true) {
            let permPrice = targetRankConfig.price;
            let tempPrice = targetRankConfig.tempPrice;
            if (appliedDiscount > 0) {
                permPrice = Math.round(permPrice * (1 - appliedDiscount / 100));
                tempPrice = Math.round(tempPrice * (1 - appliedDiscount / 100));
            }

            const typeSelect = new StringSelectMenuBuilder()
                .setCustomId(`select_duration_type_${mcUsername}_${targetDiscordId}_${selectedPackage}_${appliedDiscount}`)
                .setPlaceholder('⏳ Pilih Varian Durasi Rank...')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`Permanent - Rp ${permPrice.toLocaleString('id-ID')}`)
                        .setValue('permanent')
                        .setDescription('Akses rank selamanya tanpa batas waktu')
                        .setEmoji('💎'),
                    new StringSelectMenuOptionBuilder()
                        .setLabel(`Temporary (${targetRankConfig.durationDays || 30} Hari) - Rp ${tempPrice.toLocaleString('id-ID')}`)
                        .setValue('temporary')
                        .setDescription(`Akses rank terbatas selama ${targetRankConfig.durationDays || 30} hari`)
                        .setEmoji('⏳')
                );

            const row = new ActionRowBuilder().addComponents(typeSelect);
            const typeEmbed = new EmbedBuilder()
                .setTitle(`📌 Langkah 1B: Pilih Durasi Paket (Rank ${selectedPackage})`)
                .setDescription(`Rank **${selectedPackage}** memiliki 2 pilihan paket durasi.\n\nSilakan tentukan paket durasi yang ingin kamu beli:`)
                .setColor('#00AAFF');

            return await interaction.editReply({ embeds: [typeEmbed], components: [row] });
        }

        // JIKA HANYA PERMANENT ATAU HANYA TEMPORARY, LANGSUNG MASUK KE PILIH METODE PEMBAYARAN!
        let buyType = targetRankConfig.allowTemporary === true ? 'temporary' : 'permanent';
        let basePrice = buyType === 'temporary' ? targetRankConfig.tempPrice : targetRankConfig.price;
        let finalPrice = basePrice;

        if (appliedDiscount > 0) {
            finalPrice = Math.round(finalPrice * (1 - appliedDiscount / 100));
        }

        await renderPaymentSelection(interaction, mcUsername, targetDiscordId, selectedPackage, buyType, finalPrice, appliedDiscount, targetRankConfig.durationDays || 30);
    }

    // === 4B. SUBMIT DURASI TYPE SELECT (JIKA KEDUA OPSI AKTIF) ===
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_duration_type_')) {
        await interaction.deferUpdate();

        const parts = interaction.customId.split('_');
        const appliedDiscount = parseInt(parts.pop()) || 0;
        const selectedPackage = parts.pop();
        const targetDiscordId = parts.pop();
        const mcUsername = parts.slice(3).join('_');
        const buyType = interaction.values[0]; // 'permanent' atau 'temporary'

        const targetRankConfig = ranksData[selectedPackage];
        let basePrice = buyType === 'temporary' ? targetRankConfig.tempPrice : targetRankConfig.price;
        let finalPrice = basePrice;

        if (appliedDiscount > 0) {
            finalPrice = Math.round(finalPrice * (1 - appliedDiscount / 100));
        }

        await renderPaymentSelection(interaction, mcUsername, targetDiscordId, selectedPackage, buyType, finalPrice, appliedDiscount, targetRankConfig.durationDays || 30);
    }

    // HELPER: UTILITY UNTUK RENDERING MENU METODE PEMBAYARAN
    async function renderPaymentSelection(interaction, mcUsername, targetDiscordId, selectedPackage, buyType, finalPrice, appliedDiscount, durationDays) {
        const durationText = buyType === 'temporary' ? `Temporary (${durationDays}d)` : 'Permanent';

        const paymentSelect = new StringSelectMenuBuilder()
            .setCustomId(`select_pay_only_${mcUsername}_${targetDiscordId}_${selectedPackage}_${buyType}_${finalPrice}`)
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
            .setDescription(`**Target Username MC:** \`${mcUsername}\`\n**Penerima Role:** <@${targetDiscordId}>\n**Rank Terpilih:** \`Rank ${selectedPackage}\` (\`${durationText}\`)\n**Total Bayar:** Rp ${finalPrice.toLocaleString('id-ID')}${appliedDiscount > 0 ? ` *(Diskon ${appliedDiscount}%)*` : ''}\n\nPilih **Metode Pembayaran** di bawah ini:`)
            .setColor('#00AAFF');

        await interaction.editReply({ embeds: [payEmbed], components: [row] });
    }

    // === 5. SELECT PAYMENT -> CHARGE MIDTRANS (DENGAN EXPIRED DINAMIS & METADATA DURATION) ===
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_pay_only_')) {
        await interaction.deferUpdate();

        const parts = interaction.customId.split('_');
        const price = parseInt(parts.pop());
        const buyType = parts.pop(); // 'permanent' atau 'temporary'
        const packageType = parts.pop();
        const targetDiscordId = parts.pop();
        const mcUsername = parts.slice(3).join('_');
        const paymentMethod = interaction.values[0];

        const orderId = `MC-${Date.now()}`;
        
        // TIMEOUT DINAMIS DARI DATABASE
        const expiryMinutes = parseInt(await getSetting('payment_expiry_minutes') || '15');
        const expiryTime = Math.floor(Date.now() / 1000) + (expiryMinutes * 60);

        const targetRankConfig = ranksData[packageType];
        const durationDays = targetRankConfig?.durationDays || 30;
        const durationLabel = buyType === 'temporary' ? `Temp (${durationDays}d)` : 'Permanent';

        let parameter = {
            transaction_details: { order_id: orderId, gross_amount: price },
            item_details: [{ id: `${packageType.toLowerCase()}_${buyType}`, price: price, quantity: 1, name: `Rank ${packageType} (${durationLabel})` }],
            customer_details: { first_name: mcUsername, last_name: `(MC)`, email: `${interaction.user.id}@discord.com` },
            custom_field1: mcUsername,
            custom_field2: targetDiscordId,
            custom_field3: JSON.stringify({ buyType, durationDays }),
            custom_expiry: { expiry_duration: expiryMinutes, unit: 'minute' }
        };

        if (paymentMethod === 'qris') parameter.payment_type = 'gopay';
        else if (paymentMethod === 'bca_va') { parameter.payment_type = 'bank_transfer'; parameter.bank_transfer = { bank: 'bca' }; }
        else if (paymentMethod === 'mandiri_va') { parameter.payment_type = 'echannel'; parameter.echannel = { bill_info1: 'Pembayaran:', bill_info2: `Rank ${packageType}` }; }
        else if (paymentMethod === 'bri_va') { parameter.payment_type = 'bank_transfer'; parameter.bank_transfer = { bank: 'bri' }; }

        try {
            console.log(`\n[CHARGE INITIATED] OrderID: ${orderId} | MC: ${mcUsername} | TargetDiscord: ${targetDiscordId} | Type: ${buyType} | Price: Rp${price}`);
            const chargeResponse = await coreApi.charge(parameter);
            const embed = new EmbedBuilder().setColor('#F1C40F');

            const isGift = targetDiscordId !== interaction.user.id;
            const giftText = isGift ? `\n🎁 **Gift Untuk:** <@${targetDiscordId}>` : '';

            if (paymentMethod === 'qris') {
                const qrAction = chargeResponse.actions?.find(action => action.name === 'generate-qr-code');
                embed.setTitle(`📱 Tagihan QRIS: Rank ${packageType} (${durationLabel})`)
                     .setDescription(`**Status:** ⏳ \`WAITING FOR PAYMENT\`\n\n**Target Player MC:** \`${mcUsername}\`${giftText}\n**Durasi Rank:** \`${durationLabel}\`\n**Total Bayar:** Rp${price.toLocaleString('id-ID')}\n**Order ID:** \`${orderId}\`\n\n⏰ **Batas Waktu:** <t:${expiryTime}:R>\n\nScan QRIS di bawah ini:`)
                     .setImage(qrAction ? qrAction.url : null);
            } else {
                let vaNumber = chargeResponse.va_numbers?.[0]?.va_number || chargeResponse.bill_key || 'Lihat Kode';
                embed.setTitle(`🏦 Virtual Account: Rank ${packageType} (${durationLabel})`)
                     .setDescription(`**Status:** ⏳ \`WAITING FOR PAYMENT\`\n\n**Target Player MC:** \`${mcUsername}\`${giftText}\n**Durasi Rank:** \`${durationLabel}\`\n**Total Bayar:** Rp${price.toLocaleString('id-ID')}\n**Order ID:** \`${orderId}\`\n\n📌 **Kode Bayar / VA:**\n\`\`\`text\n${vaNumber}\n\`\`\`\n⏰ **Batas Waktu:** <t:${expiryTime}:R>`);
            }

            await interaction.editReply({ embeds: [embed], components: [] });

            activeTransactions.set(orderId, {
                interaction: interaction,
                mcUsername: mcUsername,
                packageType: packageType,
                buyType: buyType,
                durationDays: durationDays,
                price: price,
                targetDiscordId: targetDiscordId
            });

        } catch (err) {
            console.error('❌ Midtrans Charge Error:', err.message);
            await interaction.editReply({ content: '❌ Gagal membuat tagihan pembayaran.', components: [] });
        }
    }

    // === 6. COMMAND ADMIN PROMO ===
    if (interaction.isChatInputCommand() && interaction.commandName === 'admin-promo') {
        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            const code = interaction.options.getString('code').toUpperCase().trim();
            const percent = interaction.options.getInteger('percent');
            const maxUse = interaction.options.getInteger('max_use');

            await savePromo(code, percent, maxUse);

            await interaction.reply({ content: `✅ Kode Promo **${code}** (Diskon ${percent}%, Max ${maxUse}x pakai) berhasil dibuat ke MySQL!`, ephemeral: true });
        } else if (sub === 'list') {
            const promos = await getPromosData();
            let text = '🎟️ **DAFTAR KODE PROMO AKTIF:**\n';
            for (const [code, info] of Object.entries(promos)) {
                text += `• **${code}**: Diskon ${info.discountPercent}% (${info.usedCount}/${info.maxUses}x digunakan)\n`;
            }
            await interaction.reply({ content: text || 'Belum ada promo aktif.', ephemeral: true });
        }
    }

    // === 7. COMMAND ADMIN STATS ===
    if (interaction.isChatInputCommand() && interaction.commandName === 'admin-stats') {
        const stats = await getSalesStats();

        const embed = new EmbedBuilder()
            .setTitle('📊 LAPORAN OMSET & PENJUALAN TOKO')
            .setDescription(`**Total Pemasukan Clean:** Rp ${stats.totalRevenue.toLocaleString('id-ID')}\n**Total Transaksi Lunas:** ${stats.totalTransactions} Transaksi`)
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