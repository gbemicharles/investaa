const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text, replyMarkup = null) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN || !CHAT_ID) {
            console.warn('[TELEGRAM] Bot token or chat ID not configured — skipping.');
            return resolve();
        }
        const bodyObj = { chat_id: CHAT_ID, text, parse_mode: 'HTML' };
        if (replyMarkup) {
            bodyObj.reply_markup = replyMarkup;
        }
        const body = JSON.stringify(bodyObj);
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', (e) => { console.error('[TELEGRAM] Send error:', e.message); resolve(); });
        req.write(body);
        req.end();
    }).then(raw => {
        try {
            const parsed = JSON.parse(raw);
            if (!parsed.ok) console.error('[TELEGRAM] API error:', parsed.description, '| chat_id:', CHAT_ID);
        } catch (_) {}
        return raw;
    });
}

function sendPhoto(photo, caption) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !CHAT_ID) return resolve();

        if (!photo.startsWith('data:')) {
            // It is a file_id! Send as simple JSON
            const body = JSON.stringify({ chat_id: CHAT_ID, photo, caption, parse_mode: 'HTML' });
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${BOT_TOKEN}/sendPhoto`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => resolve(data));
            });
            req.on('error', (e) => { console.error('[TELEGRAM] sendPhoto file_id error:', e.message); resolve(); });
            req.write(body);
            req.end();
            return;
        }

        const boundary = '----TGBoundary' + Date.now();
        const mimeMatch = photo.match(/^data:(image\/\w+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const ext  = mime.split('/')[1] || 'jpg';
        const base64Data = photo.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const captionPart =
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption || ''}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="doc.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`;

        const closing = `\r\n--${boundary}--\r\n`;
        const body = Buffer.concat([
            Buffer.from(captionPart, 'utf8'),
            imageBuffer,
            Buffer.from(closing, 'utf8')
        ]);

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendPhoto`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', (e) => { console.error('[TELEGRAM] Photo error:', e.message); resolve(); });
        req.write(body);
        req.end();
    });
}

async function notifyKycApproved(sub, user) {
    try {
        const lines = [
            `✅ <b>KYC APPROVED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            user.phone ? `📞 <b>Phone:</b> ${user.phone}` : null,
            ``,
            `🌍 <b>Country:</b> ${sub.country}`,
            `🪪 <b>ID Type:</b> ${sub.id_type}`,
            `🔢 <b>ID Number:</b> <code>${sub.id_number}</code>`,
            sub.extra_field_name ? `📋 <b>${sub.extra_field_name}:</b> <code>${sub.extra_field_value}</code>` : null,
            ``,
            `📅 <b>Submitted:</b> ${new Date(sub.submitted_at).toLocaleString()}`,
            `✔️ <b>Approved:</b> ${new Date().toLocaleString()}`,
        ].filter(l => l !== null).join('\n');

        await sendTelegram(lines);

        if (sub.id_document) {
            await sendPhoto(sub.id_document, `🪪 ID Front — ${user.username}`);
        }
        if (sub.id_document_back) {
            await sendPhoto(sub.id_document_back, `🪪 ID Back — ${user.username}`);
        }
        if (sub.selfie) {
            await sendPhoto(sub.selfie, `🤳 Selfie — ${user.username}`);
        }
        if (sub.extra_document) {
            const label = sub.extra_field_name ? `${sub.extra_field_name} Document` : 'Supporting Document';
            await sendPhoto(sub.extra_document, `📄 ${label} — ${user.username}`);
        }
    } catch(e) {
        console.error('[TELEGRAM] notifyKycApproved error:', e.message);
    }
}

async function notifyDepositSubmitted(user, amount, network, txid, depositId) {
    try {
        const text = [
            `💰 <b>NEW DEPOSIT</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            ``,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `🌐 <b>Network:</b> ${network}`,
            txid ? `🔗 <b>TxID:</b> <code>${txid}</code>` : null,
            ``,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting admin review</i>`,
        ].filter(l => l !== null).join('\n');

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve ✅', callback_data: `dep_approve:${depositId}` },
                    { text: 'Reject ❌', callback_data: `dep_reject:${depositId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
    } catch(e) { console.error('[TELEGRAM] notifyDepositSubmitted error:', e.message); }
}

async function notifyDepositApproved(user, amount) {
    try {
        await sendTelegram([
            `✅ <b>DEPOSIT APPROVED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyDepositApproved error:', e.message); }
}

async function notifyDepositRejected(user, amount) {
    try {
        await sendTelegram([
            `❌ <b>DEPOSIT REJECTED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyDepositRejected error:', e.message); }
}

async function notifyWithdrawalRequested(user, amount, details, withdrawalId) {
    try {
        const text = [
            `🏧 <b>WITHDRAWAL REQUEST</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            ``,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            details ? `📋 <b>Details:</b> ${details}` : null,
            ``,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting admin review</i>`,
        ].filter(l => l !== null).join('\n');

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve ✅', callback_data: `with_approve:${withdrawalId}` },
                    { text: 'Reject ❌', callback_data: `with_reject:${withdrawalId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
    } catch(e) { console.error('[TELEGRAM] notifyWithdrawalRequested error:', e.message); }
}

async function notifyWithdrawalApproved(user, amount) {
    try {
        await sendTelegram([
            `✅ <b>WITHDRAWAL APPROVED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Amount:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyWithdrawalApproved error:', e.message); }
}

async function notifyWithdrawalRejected(user, amount) {
    try {
        await sendTelegram([
            `❌ <b>WITHDRAWAL REJECTED</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            `💵 <b>Refunded:</b> $${parseFloat(amount).toFixed(2)} USDT`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyWithdrawalRejected error:', e.message); }
}

async function notifyKycSubmitted(user, country, idType, kycId) {
    try {
        const text = [
            `🪪 <b>NEW KYC SUBMISSION</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            user.phone ? `📞 <b>Phone:</b> ${user.phone}` : null,
            ``,
            `🌍 <b>Country:</b> ${country}`,
            `🪪 <b>ID Type:</b> ${idType}`,
            ``,
            `📅 <b>Submitted:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting admin review</i>`,
        ].filter(l => l !== null).join('\n');

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve ✅', callback_data: `kyc_approve:${kycId}` },
                    { text: 'Reject ❌', callback_data: `kyc_reject:${kycId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
    } catch(e) { console.error('[TELEGRAM] notifyKycSubmitted error:', e.message); }
}

async function sendTelegramMediaGroupBuffers(files, caption = null) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !CHAT_ID) return resolve(null);

        const boundary = '----TGBoundary' + Date.now();
        const parts = [];

        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n`, 'utf8'));

        const mediaArray = files.map((f, idx) => ({
            type: 'photo',
            media: `attach://${f.name}`,
            caption: idx === 0 ? caption : undefined,
            parse_mode: idx === 0 ? 'HTML' : undefined
        }));

        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"\r\n\r\n${JSON.stringify(mediaArray)}\r\n`, 'utf8'));

        for (const file of files) {
            parts.push(Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
                `Content-Type: ${file.mimeType}\r\n\r\n`
            ));
            parts.push(file.buffer);
            parts.push(Buffer.from('\r\n'));
        }

        parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
        const body = Buffer.concat(parts);

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendMediaGroup`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok) {
                        resolve(parsed.result);
                    } else {
                        console.error('[TELEGRAM] sendMediaGroup error:', parsed.description);
                        resolve(null);
                    }
                } catch (e) {
                    console.error('[TELEGRAM] sendMediaGroup json parse error:', e.message);
                    resolve(null);
                }
            });
        });

        req.on('error', (err) => {
            console.error('[TELEGRAM] sendMediaGroup request error:', err.message);
            resolve(null);
        });

        req.write(body);
        req.end();
    });
}

async function sendTelegramDocumentBuffer(chatId, filename, buffer, caption = null) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !chatId) return resolve(null);

        const boundary = '----TGBoundary' + Date.now();
        const captionPart =
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
            (caption ? `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` : '') +
            `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/plain\r\n\r\n`;

        const closing = `\r\n--${boundary}--\r\n`;
        const body = Buffer.concat([
            Buffer.from(captionPart, 'utf8'),
            buffer,
            Buffer.from(closing, 'utf8')
        ]);

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/sendDocument`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', (e) => { console.error('[TELEGRAM] sendDocument error:', e.message); resolve(null); });
        req.write(body);
        req.end();
    });
}

async function notifyKycSubmittedWithFiles(user, country, idType, kycId, files) {
    try {
        const text = [
            `🪪 <b>NEW KYC SUBMISSION</b>`,
            ``,
            `👤 <b>User:</b> ${user.username}`,
            `📧 <b>Email:</b> ${user.email}`,
            user.phone ? `📞 <b>Phone:</b> ${user.phone}` : null,
            ``,
            `🌍 <b>Country:</b> ${country}`,
            `🪪 <b>ID Type:</b> ${idType}`,
            ``,
            `📅 <b>Submitted:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting admin review</i>`,
        ].filter(l => l !== null).join('\n');

        const result = await sendTelegramMediaGroupBuffers(files, `🪪 KYC Docs: ${user.username} (${idType})`);

        const fileIds = {};
        if (result && Array.isArray(result)) {
            if (result[0]?.photo) {
                const photos = result[0].photo;
                fileIds.id_document = photos[photos.length - 1].file_id;
            }
            if (result[1]?.photo) {
                const photos = result[1].photo;
                fileIds.id_document_back = photos[photos.length - 1].file_id;
            }
            if (result[2]?.photo) {
                const photos = result[2].photo;
                fileIds.selfie = photos[photos.length - 1].file_id;
            }
            if (result[3]?.photo) {
                const photos = result[3].photo;
                fileIds.extra_document = photos[photos.length - 1].file_id;
            }
        }

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve ✅', callback_data: `kyc_approve:${kycId}` },
                    { text: 'Reject ❌', callback_data: `kyc_reject:${kycId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
        return fileIds;
    } catch(e) {
        console.error('[TELEGRAM] notifyKycSubmittedWithFiles error:', e.message);
        return {};
    }
}

async function archiveKyc(archiveChatId, sub, user, detailsText) {
    try {
        if (!BOT_TOKEN || !archiveChatId) return;

        const detailsBuffer = Buffer.from(detailsText, 'utf8');
        const filename = `kyc_approved_${sub.id}_${user.username}.txt`;
        await sendTelegramDocumentBuffer(archiveChatId, filename, detailsBuffer, `🗄️ Approved KYC Record - User: ${user.username}`);

        const media = [];
        if (sub.id_document && !sub.id_document.startsWith('data:') && sub.id_document !== 'Sent to Telegram') {
            media.push({ type: 'photo', media: sub.id_document, caption: `ID Front - ${user.username}` });
        }
        if (sub.id_document_back && !sub.id_document_back.startsWith('data:') && sub.id_document_back !== 'Sent to Telegram') {
            media.push({ type: 'photo', media: sub.id_document_back, caption: `ID Back - ${user.username}` });
        }
        if (sub.selfie && !sub.selfie.startsWith('data:') && sub.selfie !== 'Sent to Telegram') {
            media.push({ type: 'photo', media: sub.selfie, caption: `Selfie - ${user.username}` });
        }
        if (sub.extra_document && !sub.extra_document.startsWith('data:') && sub.extra_document !== 'Sent to Telegram') {
            const label = sub.extra_field_name || 'Supporting Document';
            media.push({ type: 'photo', media: sub.extra_document, caption: `${label} - ${user.username}` });
        }

        if (media.length > 0) {
            const body = JSON.stringify({ chat_id: archiveChatId, media });
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${BOT_TOKEN}/sendMediaGroup`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            };
            await new Promise((resolve) => {
                const req = https.request(options, (res) => {
                    let d = '';
                    res.on('data', chunk => d += chunk);
                    res.on('end', () => resolve(d));
                });
                req.on('error', () => resolve());
                req.write(body);
                req.end();
            });
        }
    } catch (e) {
        console.error('[TELEGRAM] archiveKyc error:', e.message);
    }
}

module.exports = {
    sendTelegram,
    notifyKycApproved,
    notifyDepositSubmitted,
    notifyDepositApproved,
    notifyDepositRejected,
    notifyWithdrawalRequested,
    notifyWithdrawalApproved,
    notifyWithdrawalRejected,
    notifyKycSubmitted,
    notifyKycSubmittedWithFiles,
    archiveKyc,
    sendPhoto
};
