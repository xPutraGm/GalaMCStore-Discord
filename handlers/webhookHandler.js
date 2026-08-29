const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { coreApi, isProd } = require('../config/midtrans');
const { getRanksData } = require('../utils/db');
const { sendRconCommand } = require('../utils/rcon');

// Import activeTransactions jika ada file store/transactions.js, 
// atau fallback menggunakan Global Map jika belum di-export.
let activeTransactions;
try {
    const storeTx = require('../store/transactions');
    activeTransactions = storeTx.activeTransactions || storeTx;
} catch (e) {
    if (!global.activeTransactions) global.activeTransactions = new Map();
    activeTransactions = global.activeTransactions;
}

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
        
        const ranksData = getRanksData();
        const targetRankConfig = ranksData[packageType];
        const amountPaid = parseFloat(statusResponse.gross_amount) || 0;

        const isPaid = transactionStatus === 'settlement' || 
                       (transactionStatus === 'capture' && fraudStatus === 'accept');

        if (isPaid) {
            console.log(`\n✅ [PEMBAYARAN LUNAS] Memulai Eksekusi Multi-System...`);

            // 1. DYNAMIC MULTI-COMMAND RCON EXECUTION (WITH PLACEHOLDERS)
            let commandsToRun = targetRankConfig?.commands || [];
            
            // Fallback jika belum ada custom command di database
            if (!Array.isArray(commandsToRun) || commandsToRun.length === 0) {
                commandsToRun = [`luckperms user ${mcUsername} parent set ${packageType.toLowerCase()}`];
            }

            console.log(`🚀 Mengirim ${commandsToRun.length} RCON Command(s) ke Server MC...`);
            
            for (let rawCmd of commandsToRun) {
                // Parse Placeholders: {player}, {rank}, {price}
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
                            // Jika upgrade dari VIP ke MVP, lepas Role VIP lama jika dikonfigurasi
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

            // 4. UPDATE EMBED DISCORD LIVE REAL-TIME (SAFE CHECK & FIX)
            if (activeTransactions && typeof activeTransactions.has === 'function' && activeTransactions.has(orderId)) {
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
        }

        return res.status(200).send('OK');

    } catch (err) {
        console.error('❌ Error Webhook Processing:', err.message);
        return res.status(500).send('Internal Server Error');
    }
}

module.exports = { handleWebhook };