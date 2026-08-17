const https = require('https');
const PDFDocument = require('pdfkit');

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
        const mimeType = filename.endsWith('.pdf') ? 'application/pdf' : 'text/plain';
        const captionPart =
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
            (caption ? `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` : '') +
            `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;

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

function sendPhotoBuffer(imageBuffer, caption, mimeType = 'image/jpeg') {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !CHAT_ID || !imageBuffer) return resolve(null);

        const boundary = '----TGBoundary' + Date.now();
        const ext = (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');

        const captionPart =
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption || ''}\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="kyc_doc.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`;

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
        req.on('error', (e) => { console.error('[TELEGRAM] sendPhotoBuffer error:', e.message); resolve(null); });
        req.write(body);
        req.end();
    });
}

async function notifyKycSubmittedWithFiles(user, country, idType, idNumber, extraName, extraValue, kycId, files) {
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
            `🔢 <b>ID Number:</b> <code>${idNumber || 'N/A'}</code>`,
            (extraName && extraValue) ? `📋 <b>${extraName}:</b> <code>${extraValue}</code>` : null,
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

        // 1. Send header details message with inline action buttons
        await sendTelegram(text, replyMarkup);

        // 2. Upload each photo document individually to Telegram with labeled captions
        const fileIds = {};
        if (Array.isArray(files)) {
            for (const fileObj of files) {
                if (!fileObj || !fileObj.buffer) continue;
                try {
                    const docLabel = fileObj.label || fileObj.name || 'Document';
                    const caption = `🪪 <b>${docLabel}</b> — <code>${user.username}</code>${idNumber ? ` (ID: ${idNumber})` : ''}`;
                    const resData = await sendPhotoBuffer(fileObj.buffer, caption, fileObj.mimeType || 'image/jpeg');
                    if (resData) {
                        const parsed = typeof resData === 'string' ? JSON.parse(resData) : resData;
                        if (parsed && parsed.ok && parsed.result && parsed.result.photo) {
                            const photos = parsed.result.photo;
                            const fileId = photos[photos.length - 1].file_id;
                            if (fileObj.key) {
                                fileIds[fileObj.key] = fileId;
                            }
                        }
                    }
                } catch (fileErr) {
                    console.error(`[KYC-TG-UPLOAD] Error sending ${fileObj.key || 'doc'}:`, fileErr.message);
                }
            }
        }

        return fileIds;
    } catch(e) {
        console.error('[TELEGRAM] notifyKycSubmittedWithFiles error:', e.message);
        return {};
    }
}

function downloadTelegramFile(fileId) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !fileId) return resolve(null);

        const path = `/bot${BOT_TOKEN}/getFile?file_id=${fileId}`;
        https.get(`https://api.telegram.org${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok && parsed.result.file_path) {
                        const filePath = parsed.result.file_path;
                        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
                        
                        https.get(fileUrl, (fileRes) => {
                            const chunks = [];
                            fileRes.on('data', chunk => chunks.push(chunk));
                            fileRes.on('end', () => {
                                resolve(Buffer.concat(chunks));
                            });
                            fileRes.on('error', (err) => {
                                console.error('[TELEGRAM] downloadTelegramFile buffer read error:', err.message);
                                resolve(null);
                            });
                        }).on('error', (err) => {
                            console.error('[TELEGRAM] downloadTelegramFile download trigger error:', err.message);
                            resolve(null);
                        });
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', (err) => {
            console.error('[TELEGRAM] downloadTelegramFile getFile error:', err.message);
            resolve(null);
        });
    });
}

function generateKycPdf(sub, user, imageBuffers) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 40 });
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', err => reject(err));

            // 1. Draw Title Card
            doc.fillColor('#1e293b').fontSize(22).font('Helvetica-Bold').text('INVESTAA - KYC VERIFICATION REPORT', { align: 'center' });
            doc.moveDown(1);

            doc.moveTo(40, doc.y).lineTo(570, doc.y).strokeColor('#cbd5e1').lineWidth(1).stroke();
            doc.moveDown(1.5);

            // 2. Add text fields
            doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('User Information:');
            doc.fillColor('#334155').font('Helvetica').fontSize(10);
            doc.text(`Username:      ${user.username}`);
            doc.text(`Email:         ${user.email}`);
            doc.text(`Phone:         ${user.phone || 'N/A'}`);
            doc.moveDown(1.2);

            doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13).text('Verification Details:');
            doc.fillColor('#334155').font('Helvetica').fontSize(10);
            doc.text(`Submission ID: ${sub.id}`);
            doc.text(`Country:       ${sub.country}`);
            doc.text(`ID Type:       ${sub.id_type}`);
            doc.text(`ID Number:     ${sub.id_number}`);
            if (sub.extra_field_name && sub.extra_field_value) {
                doc.text(`${sub.extra_field_name}: ${sub.extra_field_value}`);
            }
            doc.text(`Submitted At:  ${sub.submitted_at || new Date().toLocaleString()}`);
            doc.text(`Approved At:   ${new Date().toLocaleString()}`);
            doc.moveDown(2);

            // Stamp/Notice on page 1
            doc.fillColor('#22c55e').fontSize(14).font('Helvetica-Bold').text('VERIFIED & APPROVED ✅', { align: 'center' });

            // 3. Append Document Pages
            for (const img of imageBuffers) {
                if (img.buffer) {
                    try {
                        doc.addPage();
                        doc.fillColor('#1e293b').fontSize(14).font('Helvetica-Bold').text(img.label, { align: 'center' });
                        doc.moveDown(0.5);

                        doc.image(img.buffer, {
                            fit: [500, 600],
                            align: 'center',
                            valign: 'center'
                        });
                    } catch (imgErr) {
                        doc.fillColor('#ef4444').fontSize(10).font('Helvetica').text(`Error embedding document image: ${imgErr.message}`, { align: 'center' });
                    }
                }
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

async function archiveKyc(archiveChatId, sub, user, detailsText) {
    try {
        if (!BOT_TOKEN || !archiveChatId) return;

        console.log(`[KYC-ARCHIVE] Starting PDF compilation for user: ${user.username}...`);

        // 1. Download files from Telegram into memory
        const imageBuffers = [];
        if (sub.id_document && !sub.id_document.startsWith('data:') && sub.id_document !== 'Sent to Telegram') {
            const buf = await downloadTelegramFile(sub.id_document);
            if (buf) imageBuffers.push({ label: 'ID Document — Front', buffer: buf });
        }
        if (sub.id_document_back && !sub.id_document_back.startsWith('data:') && sub.id_document_back !== 'Sent to Telegram') {
            const buf = await downloadTelegramFile(sub.id_document_back);
            if (buf) imageBuffers.push({ label: 'ID Document — Back', buffer: buf });
        }
        if (sub.selfie && !sub.selfie.startsWith('data:') && sub.selfie !== 'Sent to Telegram') {
            const buf = await downloadTelegramFile(sub.selfie);
            if (buf) imageBuffers.push({ label: 'Selfie holding ID', buffer: buf });
        }
        if (sub.extra_document && !sub.extra_document.startsWith('data:') && sub.extra_document !== 'Sent to Telegram') {
            const buf = await downloadTelegramFile(sub.extra_document);
            const label = sub.extra_field_name || 'Supporting Document';
            if (buf) imageBuffers.push({ label: label + ' Document', buffer: buf });
        }

        console.log(`[KYC-ARCHIVE] Downloaded ${imageBuffers.length} images from Telegram.`);

        // 2. Generate PDF Report
        const pdfBuffer = await generateKycPdf(sub, user, imageBuffers).catch((err) => {
            console.error('[KYC-ARCHIVE] PDF Generation Error:', err.message);
            return null;
        });

        if (!pdfBuffer) {
            console.warn('[KYC-ARCHIVE] PDF generation failed, falling back to text file...');
            const detailsBuffer = Buffer.from(detailsText, 'utf8');
            const filename = `kyc_approved_${sub.id}_${user.username}.txt`;
            await sendTelegramDocumentBuffer(archiveChatId, filename, detailsBuffer, `🗄️ Approved KYC Record - User: ${user.username}`);
            return;
        }

        // 3. Send consolidated PDF to Archive Chat
        console.log('[KYC-ARCHIVE] Sending consolidated PDF report to archive group...');
        const filename = `kyc_approved_${sub.id}_${user.username}.pdf`;
        await sendTelegramDocumentBuffer(archiveChatId, filename, pdfBuffer, `🗄️ Approved KYC Report (PDF) - User: ${user.username}`);
        console.log('[KYC-ARCHIVE] PDF archived successfully.');
    } catch (e) {
        console.error('[TELEGRAM] archiveKyc error:', e.message);
    }
}

async function notifyLoanSubmitted(loan, loanId) {
    try {
        const text = [
            `🏦 <b>NEW CREDIT & LOAN APPLICATION RECEIVED</b>`,
            `━━━━━━━━━━━━━━━━━━━━━━`,
            `🆔 <b>Application Code:</b> <code>${loan.app_code || ('#LOAN-' + loanId)}</code>`,
            `👤 <b>Applicant Name:</b> ${loan.full_name}`,
            `📧 <b>Email:</b> ${loan.email}`,
            `📞 <b>Phone:</b> ${loan.phone || 'N/A'}`,
            `💵 <b>Requested Amount:</b> <b>$${parseFloat(loan.loan_amount).toLocaleString()} USD</b>`,
            `🎯 <b>Purpose:</b> ${loan.loan_purpose}`,
            `⏱️ <b>Term:</b> ${loan.loan_term} Months`,
            ``,
            `🏢 <b>Employment:</b> ${loan.employment_status} (${loan.employer_name || 'N/A'})`,
            `💰 <b>Monthly Income:</b> $${parseFloat(loan.monthly_income || 0).toLocaleString()} USD`,
            ``,
            `🏦 <b>Banking Details for Disbursement:</b>`,
            `• Bank: ${loan.bank_name}`,
            `• Account Holder: ${loan.account_name}`,
            `• Routing Number: <code>${loan.routing_number}</code>`,
            `• Account Number: <code>${loan.account_number}</code> (${loan.account_type})`,
            loan.business_txid ? `• Business TxID: <code>${loan.business_txid}</code>` : null,
            `━━━━━━━━━━━━━━━━━━━━━━`,
            `📅 <b>Submitted At:</b> ${new Date().toLocaleString()}`,
            `⏳ <i>Awaiting underwriting review</i>`
        ].filter(Boolean).join('\n');

        const replyMarkup = {
            inline_keyboard: [
                [
                    { text: 'Approve Loan ✅', callback_data: `loan_approve:${loanId}` },
                    { text: 'Reject Loan ❌', callback_data: `loan_reject:${loanId}` }
                ]
            ]
        };

        await sendTelegram(text, replyMarkup);
    } catch (e) {
        console.error('[TELEGRAM] notifyLoanSubmitted error:', e.message);
    }
}

async function notifyLoanApproved(loan, amount) {
    try {
        await sendTelegram([
            `🎉 <b>LOAN APPLICATION APPROVED</b>`,
            ``,
            `👤 <b>Applicant:</b> ${loan.full_name}`,
            `📧 <b>Email:</b> ${loan.email}`,
            `💵 <b>Approved Credit Line:</b> $${parseFloat(amount).toLocaleString()} USD`,
            `🆔 <b>Code:</b> <code>${loan.app_code}</code>`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`,
            `💡 <i>Reserved for instant disbursement upon activation deposit / VIP upgrade.</i>`
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyLoanApproved error:', e.message); }
}

async function notifyLoanRejected(loan, reason) {
    try {
        await sendTelegram([
            `❌ <b>LOAN APPLICATION REJECTED</b>`,
            ``,
            `👤 <b>Applicant:</b> ${loan.full_name}`,
            `📧 <b>Email:</b> ${loan.email}`,
            `💵 <b>Requested:</b> $${parseFloat(loan.loan_amount).toLocaleString()} USD`,
            `📋 <b>Reason:</b> ${reason || 'Underwriting criteria not met'}`,
            `📅 <b>Time:</b> ${new Date().toLocaleString()}`
        ].join('\n'));
    } catch(e) { console.error('[TELEGRAM] notifyLoanRejected error:', e.message); }
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
    notifyLoanSubmitted,
    notifyLoanApproved,
    notifyLoanRejected,
    archiveKyc,
    sendPhoto
};
