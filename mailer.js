const nodemailer = require('nodemailer');

const FROM_NAME = 'InvestAA';
const FROM_EMAIL = process.env.GMAIL_USER;
const APP_NAME = 'InvestAA';
const SUPPORT_EMAIL = process.env.GMAIL_USER || 'investaa.pro@gmail.com';
const APP_URL = process.env.APP_URL || 'https://investaa.site';

let transporter = null;

function getTransporter() {
    if (transporter) return transporter;
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        console.warn('[MAILER] Email disabled — GMAIL_USER and GMAIL_APP_PASSWORD not set.');
        return null;
    }
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
        },
    });
    return transporter;
}

function wrap(title, bodyHtml, ctaText, ctaUrl) {
    const cta = ctaText && ctaUrl
        ? `<p style="margin:32px 0 0;text-align:center;"><a href="${ctaUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:14px 28px;border-radius:10px;font-weight:700;text-decoration:none;font-family:Inter,Arial,sans-serif;">${ctaText}</a></p>`
        : '';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0b10;font-family:Inter,Arial,sans-serif;color:#f8fafc;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0b10;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#12141d;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;text-align:center;">
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#3b82f6;letter-spacing:0.5px;">${APP_NAME}</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <h2 style="margin:0 0 16px;font-size:20px;color:#f8fafc;">${title}</h2>
          <div style="font-size:15px;line-height:1.65;color:#cbd5e1;">${bodyHtml}</div>
          ${cta}
        </td></tr>
        <tr><td style="padding:32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;color:#64748b;font-size:12px;line-height:1.6;">
          You are receiving this email because you have an account with ${APP_NAME}.<br>
          Need help? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a>.<br>
          &copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendMail(to, subject, html) {
    const t = getTransporter();
    if (!t || !to) return;
    try {
        await t.sendMail({
            from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
            to,
            subject,
            html,
        });
        console.log(`[MAILER] Sent "${subject}" → ${to}`);
    } catch (err) {
        console.error(`[MAILER] Failed to send "${subject}" to ${to}:`, err.message);
    }
}

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function inlineStyleBroadcast(html) {
    return html
        .replace(/<h1(\s[^>]*)?>/gi, '<h1$1 style="font-size:22px;font-weight:800;color:#f8fafc;margin:18px 0 8px;line-height:1.3;">')
        .replace(/<h2(\s[^>]*)?>/gi, '<h2$1 style="font-size:18px;font-weight:700;color:#f8fafc;margin:16px 0 6px;line-height:1.35;">')
        .replace(/<h3(\s[^>]*)?>/gi, '<h3$1 style="font-size:15px;font-weight:700;color:#f8fafc;margin:14px 0 5px;line-height:1.4;">')
        .replace(/<p(\s[^>]*)?>/gi, '<p$1 style="margin:8px 0;font-size:15px;line-height:1.7;color:#cbd5e1;">')
        .replace(/<ul(\s[^>]*)?>/gi, '<ul$1 style="padding-left:22px;margin:8px 0;color:#cbd5e1;">')
        .replace(/<ol(\s[^>]*)?>/gi, '<ol$1 style="padding-left:22px;margin:8px 0;color:#cbd5e1;">')
        .replace(/<li(\s[^>]*)?>/gi, '<li$1 style="margin:4px 0;font-size:15px;line-height:1.65;color:#cbd5e1;">')
        .replace(/<blockquote(\s[^>]*)?>/gi, '<blockquote$1 style="border-left:3px solid #3b82f6;margin:12px 0;padding:10px 16px;background:rgba(59,130,246,0.07);border-radius:0 8px 8px 0;color:#93c5fd;font-style:italic;font-size:15px;">')
        .replace(/<hr(\s[^>]*)?>/gi, '<hr$1 style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:16px 0;">')
        .replace(/<a(\s[^>]*)?>/gi, '<a$1 style="color:#3b82f6;text-decoration:underline;">')
        .replace(/<div(\s[^>]*)?>/gi, '<div$1 style="margin:4px 0;font-size:15px;line-height:1.7;color:#cbd5e1;">');
}

const Emails = {
    verificationCode(to, username, code) {
        return sendMail(to, `Your ${APP_NAME} verification code is ${code}`,
            wrap('Verify your email address',
                `<p>Hi ${username}, thanks for signing up to <strong>${APP_NAME}</strong>! To finish creating your account, please enter the following 6-digit code on the verification page:</p>
                 <p style="text-align:center;font-size:36px;font-weight:800;letter-spacing:10px;color:#3b82f6;background:rgba(59,130,246,0.08);padding:20px;border-radius:12px;margin:24px 0;">${code}</p>
                 <p style="color:#94a3b8;font-size:13px;">This code will expire in 30 minutes. If you didn't sign up for ${APP_NAME}, you can safely ignore this email.</p>`,
                'Verify My Email', `${APP_URL}/verify.html?u=${encodeURIComponent(username)}`));
    },
    welcome(to, username) {
        return sendMail(to, `Welcome to ${APP_NAME}, ${username}!`,
            wrap(`Welcome aboard, ${username}!`,
                `<p>Thanks for joining <strong>${APP_NAME}</strong>. Your account is ready and you can start growing your portfolio today.</p>
                 <p>Here are a few quick things you can do next:</p>
                 <ul style="padding-left:20px;margin:8px 0;color:#cbd5e1;">
                   <li>Make your first deposit to unlock VIP earning tiers</li>
                   <li>Explore our Bronze through Diamond ranks for daily compounding returns</li>
                   <li>Set up your security PIN if you haven't already</li>
                 </ul>
                 <p>If you ever have a question, our team is one email away.</p>`,
                'Open My Dashboard', `${APP_URL}/index.html`
            ));
    },
    depositSubmitted(to, username, amount, network) {
        return sendMail(to, `Deposit of $${fmt(amount)} received for review`,
            wrap('Your deposit is being verified',
                `<p>Hi ${username}, we've received your deposit request.</p>
                 <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                   <tr><td style="padding:8px 0;color:#94a3b8;">Amount</td><td style="text-align:right;font-weight:700;color:#3b82f6;">$${fmt(amount)} USDT</td></tr>
                   <tr><td style="padding:8px 0;color:#94a3b8;">Network</td><td style="text-align:right;color:#f8fafc;">${network}</td></tr>
                   <tr><td style="padding:8px 0;color:#94a3b8;">Status</td><td style="text-align:right;color:#f59e0b;">Under review</td></tr>
                 </table>
                 <p>Our team usually verifies deposits within 10–30 minutes. We'll email you the moment it's approved.</p>`));
    },
    depositApproved(to, username, amount) {
        return sendMail(to, `Deposit of $${fmt(amount)} approved`,
            wrap('Your deposit has been credited',
                `<p>Good news ${username} — your deposit of <strong>$${fmt(amount)} USDT</strong> has been approved and added to your wallet balance.</p>
                 <p>It now counts toward your VIP eligibility and starts earning if you're on a paid tier.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`));
    },
    depositRejected(to, username) {
        return sendMail(to, 'Your deposit attempt was rejected',
            wrap('Deposit not approved',
                `<p>Hi ${username}, unfortunately we were unable to verify your most recent deposit and it has been marked as rejected.</p>
                 <p>This typically happens when the transaction ID can't be found on the blockchain or the amount doesn't match. Please double-check your records and try again, or contact support if you believe this is in error.</p>`,
                'Contact Support', `mailto:${SUPPORT_EMAIL}`));
    },
    withdrawalSubmitted(to, username, amount) {
        return sendMail(to, `Withdrawal request of $${fmt(amount)} received`,
            wrap('Withdrawal request received',
                `<p>Hi ${username}, your withdrawal request for <strong>$${fmt(amount)} USDT</strong> has been submitted and is now in our processing queue.</p>
                 <p>You'll receive another email once the payout is sent to your wallet address.</p>`));
    },
    withdrawalApproved(to, username, amount) {
        return sendMail(to, `Withdrawal of $${fmt(amount)} approved`,
            wrap('Withdrawal sent',
                `<p>Hi ${username}, your withdrawal of <strong>$${fmt(amount)} USDT</strong> has been approved and broadcast to your wallet address.</p>
                 <p>Depending on the network, it should land in your wallet within a few minutes.</p>`));
    },
    withdrawalRejected(to, username, amount) {
        return sendMail(to, 'Your withdrawal was rejected',
            wrap('Withdrawal not approved',
                `<p>Hi ${username}, your withdrawal request for <strong>$${fmt(amount)} USDT</strong> was rejected and the amount has been refunded back to your account balance in full.</p>
                 <p>If you believe this was an error, please contact support.</p>`,
                'Contact Support', `mailto:${SUPPORT_EMAIL}`));
    },
    transferReceived(to, username, amount, fromUser) {
        return sendMail(to, `You received $${fmt(amount)} from ${fromUser}`,
            wrap('Funds received',
                `<p>Hi ${username}, you just received an internal transfer of <strong>$${fmt(amount)} USDT</strong> from <strong>${fromUser}</strong>.</p>
                 <p>The funds are already available in your wallet.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`));
    },
    transferSent(to, username, amount, toUser) {
        return sendMail(to, `Transfer of $${fmt(amount)} sent`,
            wrap('Transfer sent successfully',
                `<p>Hi ${username}, your internal transfer of <strong>$${fmt(amount)} USDT</strong> to <strong>${toUser}</strong> was completed.</p>
                 <p>A $1 transfer fee was applied.</p>`));
    },
    vipUpgrade(to, username, rank) {
        return sendMail(to, `Welcome to ${rank} VIP`,
            wrap(`You're now a ${rank} member!`,
                `<p>Congratulations ${username}! Your account has been upgraded to <strong>${rank} VIP</strong> status.</p>
                 <p>You'll now earn daily compounding returns on your wallet balance, plus all the other perks of your tier. Your first earning will land in your wallet within 24 hours.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`));
    },
    passwordReset(to, username) {
        return sendMail(to, 'Your password was reset',
            wrap('Password changed',
                `<p>Hi ${username}, this is a confirmation that your account password was just reset.</p>
                 <p><strong>If this was you</strong>, no further action is needed.</p>
                 <p><strong>If this was NOT you</strong>, please contact support immediately — your account may be compromised.</p>`,
                'Contact Support', `mailto:${SUPPORT_EMAIL}`));
    },
    passwordResetByAdmin(to, username) {
        return sendMail(to, 'Your password was reset by support',
            wrap('Password reset by support',
                `<p>Hi ${username}, your account password was reset by our support team at your request.</p>
                 <p>Please sign in with the new temporary password you were given. We recommend changing it immediately afterwards from your wallet's Security Center.</p>`,
                'Sign In', `${APP_URL}/login.html`));
    },
    accountFunded(to, username, amount) {
        return sendMail(to, `$${fmt(amount)} credited to your account`,
            wrap('Your account was credited',
                `<p>Hi ${username}, $${fmt(amount)} USDT has been credited to your account by our team.</p>
                 <p>The funds are immediately available in your wallet.</p>`,
                'View My Wallet', `${APP_URL}/wallet.html`));
    },
    securityAlert(to, username, eventDescription) {
        return sendMail(to, 'Security alert on your account',
            wrap('Security notice',
                `<p>Hi ${username}, we noticed the following activity on your account:</p>
                 <p style="background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b;padding:12px 16px;border-radius:6px;color:#f8fafc;">${eventDescription}</p>
                 <p>If this was you, no action is needed. If you don't recognize this activity, please change your password right away and contact support.</p>`));
    },

    kycApproved(to, username) {
        return sendMail(to, 'Your identity has been verified ✓',
            wrap('KYC Verification Approved!',
                `<p>Hi ${username}, great news — your identity verification (KYC) has been reviewed and <strong style="color:#22c55e;">approved</strong>.</p>
                 <p>You can now make withdrawals from your account without restriction.</p>
                 <p style="color:#94a3b8;font-size:13px;">If you have any questions, our support team is always here to help.</p>`,
                'Go to My Wallet', `${APP_URL}/wallet.html`));
    },
    kycRejected(to, username, reason) {
        return sendMail(to, 'KYC verification was not approved',
            wrap('Identity Verification Unsuccessful',
                `<p>Hi ${username}, unfortunately your KYC submission could not be approved.</p>
                 <p style="background:rgba(239,68,68,0.08);border-left:3px solid #ef4444;padding:12px 16px;border-radius:6px;color:#f8fafc;"><strong>Reason:</strong> ${reason}</p>
                 <p>Please resubmit with the correct documents. Make sure your ID is valid, clearly visible, and all details match your account information.</p>`,
                'Resubmit KYC', `${APP_URL}/kyc.html`));
    },
    dormantReminder(to, username) {
        return sendMail(to, `Important notice regarding your ${APP_NAME} account`,
            wrap(`Account Activity Notice`, `
                 <p>Dear ${username},</p>
                 <p>We hope this message finds you well.</p>
                 <p>We noticed that there has been no transaction activity on your <strong>${APP_NAME}</strong> account since registration. To ensure your account remains active and fully functional, we kindly advise you to perform at least one of the following actions as soon as possible:</p>
                 <ul style="padding-left:20px;line-height:2;color:#f8fafc;">
                   <li>Make a deposit</li>
                   <li>Upgrade your account to a VIP tier</li>
                   <li>Log in and review your account dashboard</li>
                 </ul>
                 <p>Maintaining regular activity helps prevent your account from becoming dormant and ensures uninterrupted access to all our services.</p>
                 <p>Here is a summary of the earning tiers available to active members:</p>
                 <table style="width:100%;border-collapse:collapse;margin:16px 0;background:rgba(59,130,246,0.05);border-radius:10px;overflow:hidden;">
                   <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                     <td style="padding:10px 14px;color:#94a3b8;">🥉 Bronze VIP</td>
                     <td style="padding:10px 14px;text-align:right;color:#f8fafc;font-weight:600;">0.5% daily compounding returns</td>
                   </tr>
                   <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                     <td style="padding:10px 14px;color:#94a3b8;">🥈 Silver VIP</td>
                     <td style="padding:10px 14px;text-align:right;color:#f8fafc;font-weight:600;">0.75% daily compounding returns</td>
                   </tr>
                   <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                     <td style="padding:10px 14px;color:#94a3b8;">🥇 Gold VIP</td>
                     <td style="padding:10px 14px;text-align:right;color:#f8fafc;font-weight:600;">1% daily compounding returns</td>
                   </tr>
                   <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
                     <td style="padding:10px 14px;color:#94a3b8;">💎 Platinum VIP</td>
                     <td style="padding:10px 14px;text-align:right;color:#f8fafc;font-weight:600;">1.5% daily compounding returns</td>
                   </tr>
                   <tr>
                     <td style="padding:10px 14px;color:#94a3b8;">👑 Diamond VIP</td>
                     <td style="padding:10px 14px;text-align:right;color:#3b82f6;font-weight:700;">2% daily compounding returns</td>
                   </tr>
                 </table>
                 <p>If you have any questions or require assistance, please do not hesitate to contact our support team.</p>
                 <p>Thank you for your prompt attention to this matter.</p>
                 <p style="color:#94a3b8;font-size:13px;">Kind regards,<br><strong>The ${APP_NAME} Team</strong></p>`,
                'Activate My Account', `${APP_URL}/deposit.html`));
    },

    kycReminder(to, username) {
        return sendMail(to, `Action required: Complete your identity verification on ${APP_NAME}`,
            wrap('Complete Your KYC Verification',
                `<p>Dear ${username},</p>
                 <p>We hope this message finds you well.</p>
                 <p>Our records indicate that your <strong>${APP_NAME}</strong> account identity verification (KYC) has not yet been completed. To ensure continued and unrestricted access to all platform features — including withdrawals — we kindly ask that you complete your verification at your earliest convenience.</p>
                 <p>Completing your KYC takes only a few minutes and requires the following:</p>
                 <ul style="padding-left:20px;line-height:2;color:#f8fafc;">
                   <li>A valid government-issued photo ID (front and back)</li>
                   <li>A recent selfie (optional but recommended)</li>
                   <li>Basic personal information matching your ID</li>
                 </ul>
                 <p style="background:rgba(59,130,246,0.08);border-left:3px solid #3b82f6;padding:12px 16px;border-radius:6px;color:#f8fafc;">
                   <strong>Please note:</strong> Unverified accounts may experience limitations on withdrawals and other platform services. Completing your KYC removes all restrictions.
                 </p>
                 <p>If you have any questions or encounter any difficulties during the process, please do not hesitate to contact our support team — we are happy to assist you.</p>
                 <p>Thank you for your prompt attention to this matter.</p>
                 <p style="color:#94a3b8;font-size:13px;">Kind regards,<br><strong>The ${APP_NAME} Team</strong></p>`,
                'Complete My KYC Now', `${APP_URL}/kyc.html`));
    },

    dailyEarning(to, username, earning, balance, ratePercent, rank, newBalance) {
        const fmt = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const NEXT = { BRONZE: 'SILVER', SILVER: 'GOLD', GOLD: 'PLATINUM', PLATINUM: 'DIAMOND', DIAMOND: null };
        const RATES = { BRONZE: '0.5', SILVER: '0.75', GOLD: '1', PLATINUM: '1.5', DIAMOND: '2' };
        const TIER_EMOJI = { BRONZE: '🥉', SILVER: '🥈', GOLD: '🥇', PLATINUM: '💎', DIAMOND: '👑' };

        const nextRank = NEXT[rank];
        const upgradeSection = nextRank ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.2);border-radius:12px;overflow:hidden;">
              <tr><td style="padding:22px 24px;text-align:center;">
                <p style="margin:0 0 8px;font-size:18px;font-weight:800;color:#f8fafc;">Want to earn even more tomorrow?</p>
                <p style="margin:0 0 16px;font-size:14px;color:#94a3b8;line-height:1.6;">Upgrading to <strong style="color:#93c5fd;">${TIER_EMOJI[nextRank]} ${nextRank.charAt(0) + nextRank.slice(1).toLowerCase()} VIP</strong> raises your daily rate from <strong style="color:#f8fafc;">${RATES[rank]}%</strong> to <strong style="color:#22c55e;">${RATES[nextRank]}%</strong> — meaning your balance of <strong style="color:#f8fafc;">$${fmt(newBalance)}</strong> would earn you <strong style="color:#22c55e;">$${fmt(newBalance * (parseFloat(RATES[nextRank]) / 100))}</strong> per day instead of <strong style="color:#f8fafc;">$${fmt(newBalance * (parseFloat(RATES[rank]) / 100))}</strong>. Every day you wait is money left on the table.</p>
                <a href="${APP_URL}/vip.html" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#ffffff;padding:13px 32px;border-radius:10px;font-weight:700;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:15px;">Upgrade to ${nextRank.charAt(0) + nextRank.slice(1).toLowerCase()} VIP Now →</a>
              </td></tr>
            </table>` :
            `<p style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:12px;padding:16px 20px;color:#a5b4fc;font-size:14px;margin:24px 0;">
                👑 You are on our highest <strong>Diamond VIP</strong> tier — earning the maximum <strong>2% daily return</strong> with a <strong>$1,000,000</strong> daily withdrawal limit. Keep compounding and growing!
             </p>`;

        return sendMail(to, `💰 You earned $${fmt(earning)} today — ${APP_NAME}`,
            wrap('Your Daily Investment Return',
                `<p>Hi ${username},</p>
                 <p>Great news — your daily compounding return has just been credited to your account.</p>

                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-radius:12px;overflow:hidden;background:rgba(34,197,94,0.07);border:1px solid rgba(34,197,94,0.2);">
                   <tr><td style="padding:22px 24px;text-align:center;">
                     <div style="font-size:13px;color:#86efac;text-transform:uppercase;letter-spacing:0.6px;font-weight:600;margin-bottom:6px;">${TIER_EMOJI[rank]} ${rank.charAt(0) + rank.slice(1).toLowerCase()} VIP · ${ratePercent}% Daily Return</div>
                     <div style="font-size:38px;font-weight:800;color:#22c55e;letter-spacing:-1px;">+$${fmt(earning)}</div>
                     <div style="font-size:13px;color:#94a3b8;margin-top:6px;">credited to your account</div>
                   </td></tr>
                 </table>

                 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
                   <tr>
                     <td style="padding:8px 0;font-size:14px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">Balance before earning</td>
                     <td style="padding:8px 0;font-size:14px;color:#f8fafc;font-weight:600;text-align:right;border-bottom:1px solid rgba(255,255,255,0.06);">$${fmt(balance)}</td>
                   </tr>
                   <tr>
                     <td style="padding:8px 0;font-size:14px;color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.06);">Today's earning</td>
                     <td style="padding:8px 0;font-size:14px;color:#22c55e;font-weight:700;text-align:right;border-bottom:1px solid rgba(255,255,255,0.06);">+$${fmt(earning)}</td>
                   </tr>
                   <tr>
                     <td style="padding:10px 0 4px;font-size:15px;color:#f8fafc;font-weight:700;">New balance</td>
                     <td style="padding:10px 0 4px;font-size:15px;color:#3b82f6;font-weight:800;text-align:right;">$${fmt(newBalance)}</td>
                   </tr>
                 </table>

                 ${upgradeSection}

                 <p style="color:#94a3b8;font-size:13px;">This return compounds automatically every 24 hours. The larger your balance, the more you earn — keep investing to maximise your returns.</p>`,
                'View My Dashboard', `${APP_URL}/dashboard.html`
            ));
    },

    broadcastEmail(to, username, subject, bodyHtml) {
        const personalised = bodyHtml.replace(/\{username\}/gi, username);
        const styled = inlineStyleBroadcast(personalised);
        return sendMail(to, subject, wrap(subject,
            `<p style="margin:.3em 0;">Dear ${username},</p>
             ${styled}
             <p style="color:#94a3b8;font-size:13px;margin-top:24px;">Kind regards,<br><strong>The ${APP_NAME} Team</strong></p>`
        ));
    },

    outreachEmail(to, subject, bodyHtml) {
        const styled = inlineStyleBroadcast(bodyHtml);
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0b10;font-family:Inter,Arial,sans-serif;color:#f8fafc;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0b10;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#12141d;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;text-align:center;">
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#3b82f6;letter-spacing:0.5px;">${APP_NAME}</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <h2 style="margin:0 0 16px;font-size:20px;color:#f8fafc;">${subject}</h2>
          <div style="font-size:15px;line-height:1.65;color:#cbd5e1;">${styled}</div>
          <p style="margin:32px 0 0;text-align:center;">
            <a href="${APP_URL}/register.html" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:14px 32px;border-radius:10px;font-weight:700;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:15px;">Create Free Account →</a>
          </p>
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;color:#64748b;font-size:12px;line-height:1.7;">
          You received this email as part of a promotional outreach from <strong>${APP_NAME}</strong>.<br>
          To opt out of future messages, reply to this email with <em>Unsubscribe</em> in the subject line.<br>
          &copy; ${new Date().getFullYear()} ${APP_NAME} &middot; <a href="mailto:${SUPPORT_EMAIL}" style="color:#3b82f6;text-decoration:none;">${SUPPORT_EMAIL}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
        return sendMail(to, subject, html);
    },

    reEngagementReminder(to, username, vipRank, daysSince) {
        const isVip = vipRank && vipRank !== 'REGULAR';
        const nextTiers = { REGULAR: 'Bronze', BRONZE: 'Silver', SILVER: 'Gold', GOLD: 'Platinum', PLATINUM: 'Diamond', DIAMOND: null };
        const nextTier = nextTiers[(vipRank || 'REGULAR').toUpperCase()];
        const upgradeSection = nextTier
            ? `<p>Your account is currently on the <strong>${vipRank || 'Regular'}</strong> tier. Upgrading to <strong>${nextTier} VIP</strong> will increase your daily earnings rate. The sooner you act, the more your balance compounds.</p>`
            : `<p>Your account is on our highest <strong>Diamond VIP</strong> tier and continues to earn daily compounding returns. We encourage you to log in and review your latest balance.</p>`;

        return sendMail(to, `Important notice regarding your ${APP_NAME} account`,
            wrap(`Account Activity Notice`, `
                 <p>Dear ${username},</p>
                 <p>We hope this message finds you well.</p>
                 <p>We noticed that there has been no recent transaction activity on your <strong>${APP_NAME}</strong> account for <strong>${daysSince} days</strong>. To ensure your account remains active and fully functional, we kindly advise you to perform at least one of the following actions as soon as possible:</p>
                 <ul style="padding-left:20px;line-height:2;color:#f8fafc;">
                   <li>Make a deposit</li>
                   <li>Initiate a withdrawal</li>
                   <li>Upgrade your account</li>
                 </ul>
                 ${isVip
                    ? `<p style="background:rgba(59,130,246,0.08);border-left:3px solid #3b82f6;padding:12px 16px;border-radius:6px;color:#f8fafc;">Please note that your <strong>${vipRank} VIP</strong> account has continued to accrue daily returns during your absence. Log in to review your current balance.</p>`
                    : `<p style="background:rgba(245,158,11,0.08);border-left:3px solid #f59e0b;padding:12px 16px;border-radius:6px;color:#f8fafc;">Your account is funded and ready. Upgrading to a VIP tier will activate daily compounding returns on your balance automatically.</p>`
                 }
                 ${upgradeSection}
                 <p>Maintaining regular activity helps prevent your account from becoming dormant and ensures uninterrupted access to all our services.</p>
                 <p>If you have any questions or require assistance, please do not hesitate to contact our support team.</p>
                 <p>Thank you for your prompt attention to this matter.</p>
                 <p style="color:#94a3b8;font-size:13px;">Kind regards,<br><strong>The ${APP_NAME} Team</strong></p>`,
                'Log In to My Account', `${APP_URL}/index.html`));
    },
};

module.exports = Emails;
