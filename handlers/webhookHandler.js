const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { coreApi } = require('../config/midtrans');
const { getRanksData, recordSale, getSetting } = require('../utils/db');
const { sendRconCommand } = require('../utils/rcon');
const { activeTransactions } = require('../store/transactions');

async function handleWebhook(req, res, client) {
    console.log('\n========================================');
    console.log('📩 [WEBHOOK MASUK] Notifikasi Diterima Dari Midtrans!');

    try {
        const statusResponse = await coreApi.transaction.notification(req.body);
        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        const mcUsername = statusResponse.custom_field1 || 'Player';
        const discordId = statusResponse.custom_field2;

        const packageType = statusResponse.item_details?.[0]?.id?.toUpperCase() || 'VIP';
        const pdfReceiptUrl = statusResponse.pdf_url || `https://app.sandbox.midtrans.com/snap/v1/transactions/${statusResponse.transaction_id}/pdf`;
        
        const ranksData = await getRanksData();
        const targetRankConfig = ranksData[packageType];
        const amountPaid = parseFloat(statusResponse.gross_amount) || 0;

        const isPaid = transactionStatus === 'settlement' || 
                       (transactionStatus === 'capture' && fraudStatus === 'accept');

        if (isPaid) {
            console.log(`\n✅ [PEMBAYARAN LUNAS] Memulai Eksekusi Multi-System...`);

            await recordSale(orderId, mcUsername, discordId, packageType, amountPaid);

            // 1. DYNAMIC MULTI-COMMAND RCON EXECUTION
            let commandsToRun = targetRankConfig?.commands || [];
            
            if (!Array.isArray(commandsToRun) || commandsToRun.length === 0) {
                commandsToRun = [`luckperms user ${mcUsername} parent set ${packageType.toLowerCase()}`];
            }

            console.log(`🚀 Mengirim ${commandsToRun.length} RCON Command(s) ke Server MC...`);
            
            for (let rawCmd of commandsToRun) {
                const parsedCmd = rawCmd
                    .replace(/{player}/g, mcUsername)
                    .replace(/{rank}/g, packageType)
                    .replace(/{price}/g, amountPaid.toString());

                await sendRconCommand(parsedCmd);
            }

            // 2. AUTO ASSIGN DISCORD ROLE
            if (discordId) {
                try {
                    const guild = client.guilds.cache.first();
                    if (guild) {
                        const member = await guild.members.fetch(discordId);

                        if (member && targetRankConfig?.discordRoleId) {
                            await member.roles.add(targetRankConfig.discordRoleId);
                            if (packageType === 'MVP' && ranksData['VIP']?.discordRoleId) {
                                await member.roles.remove(ranksData['VIP'].discordRoleId);
                            }
                        }
                    }
                } catch (roleErr) {
                    console.error('⚠️ [DISCORD ROLE FAILED]:', roleErr.message);
                }
            }

            // 3. PRIVATE AUDIT LOG KE CHANNEL ADMIN (#store-logs)
            const auditChannelId = process.env.STORE_LOG_CHANNEL_ID;
            if (auditChannelId) {
                try {
                    const logChannel = await client.channels.fetch(auditChannelId);
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🟢 [NEW TRANSACTION PAID]')
                            .addFields(
                                { name: 'Order ID', value: `\`${orderId}\``, inline: true },
                                { name: 'Pembeli (Discord)', value: discordId ? `<@${discordId}>` : '`Unknown`', inline: true },
                                { name: 'Penerima (Minecraft)', value: `\`${mcUsername}\``, inline: true },
                                { name: 'Paket Rank', value: `Rank ${packageType}`, inline: true },
                                { name: 'Nominal Bayar', value: `Rp ${amountPaid.toLocaleString('id-ID')}`, inline: true },
                                { name: 'Metode Pembayaran', value: `${statusResponse.payment_type?.toUpperCase() || 'ONLINE'}`, inline: true }
                            )
                            .setColor('#57F287')
                            .setTimestamp();

                        await logChannel.send({ embeds: [logEmbed] });
                    }
                } catch (logErr) {
                    console.error('⚠️ Gagal kirim Audit Log:', logErr.message);
                }
            }

            // 4. UPDATE EMBED DISCORD LIVE REAL-TIME
            if (activeTransactions && activeTransactions.has(orderId)) {
                const savedTx = activeTransactions.get(orderId);
                if (savedTx && savedTx.interaction) {
                    try {
                        const successEmbed = new EmbedBuilder()
                            .setTitle('🎉 PEMBAYARAN BERHASIL & TERVERIFIKASI!')
                            .setDescription(`**Status:** ✅ \`SUCCESS / PAID\`\n\n**Rincian Transaksi:**\n• **Order ID:** \`${orderId}\`\n• **Target MC:** \`${mcUsername}\`\n• **Paket:** Rank ${packageType}\n• **Total Bayar:** Rp${amountPaid.toLocaleString('id-ID')}\n\n✨ Rank In-Game & Role Discord telah diaktifkan!`)
                            .setColor('#57F287');

                        await savedTx.interaction.editReply({ embeds: [successEmbed], components: [] });
                        activeTransactions.delete(orderId);
                    } catch (updateErr) {
                        console.error('⚠️ Gagal Update Live Embed:', updateErr.message);
                    }
                }
            }

            // 5. DM FULL RECEIPT KE USER DISCORD
            if (discordId) {
                try {
                    const discordUser = await client.users.fetch(discordId, { force: true });
                    if (discordUser) {
                        const dmChannel = await discordUser.createDM();
                        const fullReceiptEmbed = new EmbedBuilder()
                            .setTitle('🧾 OFFICIAL PAYMENT RECEIPT')
                            .setDescription(`Terima kasih telah melakukan pembelian di Official Store! Berikut adalah rincian lengkap bukti transaksi kamu:`)
                            .addFields(
                                { name: '📌 Order ID', value: `\`${orderId}\``, inline: true },
                                { name: '👤 Username MC', value: `\`${mcUsername}\``, inline: true },
                                { name: '📦 Item Purchased', value: `Rank ${packageType}`, inline: true },
                                { name: '💳 Payment Method', value: `${statusResponse.payment_type?.toUpperCase() || 'QRIS / VA'}`, inline: true },
                                { name: '💰 Total Paid', value: `Rp ${amountPaid.toLocaleString('id-ID')}`, inline: true },
                                { name: '📅 Date & Time', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
                            )
                            .setColor('#57F287')
                            .setFooter({ text: 'Simpan struk ini sebagai bukti resmi transaksi kamu.' })
                            .setTimestamp();

                        const components = [];
                        if (pdfReceiptUrl) {
                            const pdfButton = new ButtonBuilder()
                                .setLabel('📄 Download Struk PDF (Midtrans)')
                                .setStyle(ButtonStyle.Link)
                                .setURL(pdfReceiptUrl);
                            components.push(new ActionRowBuilder().addComponents(pdfButton));
                        }

                        await dmChannel.send({ embeds: [fullReceiptEmbed], components: components });
                        console.log(`📩 [DM SUCCESS] Full Receipt Detail Terkirim ke User ID: ${discordId}`);
                    }
                } catch (dmErr) {
                    console.error(`⚠️ [DM FAILED] Gagal Kirim DM ke User ID (${discordId}):`, dmErr.message);
                }
            }

            // 6. PUBLIC LIVE FEED BROADCAST (FULL CUSTOMIZABLE FROM ADMIN)
            try {
                const feedStatus = await getSetting('live_feed_status');
                const feedChannelId = await getSetting('live_feed_channel');

                if (feedStatus === '1' && feedChannelId) {
                    const feedChannel = await client.channels.fetch(feedChannelId).catch(() => null);
                    if (feedChannel) {
                        const rawTitle = await getSetting('live_feed_title') || '🎉 ADA YANG BARU BELANJA NIH!';
                        const rawDesc = await getSetting('live_feed_desc') || 'Terima kasih kepada **{player}** {discord} yang baru saja membeli **Rank {rank}**!';
                        const rawColor = await getSetting('live_feed_color') || '#F1C40F';
                        const rawFooter = await getSetting('live_feed_footer') || 'GalaMC Store System';

                        const discordMention = discordId ? `(<@${discordId}>)` : '';
                        const formattedPrice = `Rp ${amountPaid.toLocaleString('id-ID')}`;

                        // REPLACE PLACEHOLDERS
                        const parsedTitle = rawTitle.replace(/{player}/g, mcUsername).replace(/{rank}/g, packageType).replace(/{price}/g, formattedPrice);
                        const parsedDesc = rawDesc.replace(/{player}/g, mcUsername).replace(/{rank}/g, packageType).replace(/{discord}/g, discordMention).replace(/{price}/g, formattedPrice);
                        const parsedFooter = rawFooter.replace(/{player}/g, mcUsername).replace(/{rank}/g, packageType);

                        const feedEmbed = new EmbedBuilder()
                            .setTitle(parsedTitle)
                            .setDescription(parsedDesc)
                            .setColor(rawColor)
                            .setThumbnail(`https://mc-heads.net/avatar/${mcUsername}/100`)
                            .setFooter({ text: parsedFooter })
                            .setTimestamp();
                        
                        await feedChannel.send({ embeds: [feedEmbed] });
                        console.log('📢 [LIVE FEED] Pengumuman publik berhasil dikirim ke channel!');
                    }
                }
            } catch (feedErr) {
                console.error('⚠️ Gagal memproses Public Live Feed:', feedErr.message);
            }
        }

        return res.status(200).send('OK');

    } catch (err) {
        console.error('❌ Error Webhook Processing:', err.message);
        return res.status(500).send('Internal Server Error');
    }
}

module.exports = { handleWebhook };