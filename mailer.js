const nodemailer = require('nodemailer');

const FROM_NAME = 'InvestAA';
const FROM_EMAIL = process.env.GMAIL_USER;
const APP_NAME = 'InvestAA';
const SUPPORT_EMAIL = process.env.GMAIL_USER || 'investaa.pro@gmail.com';

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

const Emails = {
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
                'Open My Dashboard', `https://${process.env.REPLIT_DEV_DOMAIN || 'investaa.com'}/index.html`
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
                'View My Wallet', `https://${process.env.REPLIT_DEV_DOMAIN || 'investaa.com'}/wallet.html`));
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
                'View My Wallet', `https://${process.env.REPLIT_DEV_DOMAIN || 'investaa.com'}/wallet.html`));
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
                'View My Wallet', `https://${process.env.REPLIT_DEV_DOMAIN || 'investaa.com'}/wallet.html`));
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
                'Sign In', `https://${process.env.REPLIT_DEV_DOMAIN || 'investaa.com'}/login.html`));
    },
    accountFunded(to, username, amount) {
        return sendMail(to, `$${fmt(amount)} credited to your account`,
            wrap('Your account was credited',
                `<p>Hi ${username}, $${fmt(amount)} USDT has been credited to your account by our team.</p>
                 <p>The funds are immediately available in your wallet.</p>`,
                'View My Wallet', `https://${process.env.REPLIT_DEV_DOMAIN || 'investaa.com'}/wallet.html`));
    },
    securityAlert(to, username, eventDescription) {
        return sendMail(to, 'Security alert on your account',
            wrap('Security notice',
                `<p>Hi ${username}, we noticed the following activity on your account:</p>
                 <p style="background:rgba(245,158,11,0.1);border-left:3px solid #f59e0b;padding:12px 16px;border-radius:6px;color:#f8fafc;">${eventDescription}</p>
                 <p>If this was you, no action is needed. If you don't recognize this activity, please change your password right away and contact support.</p>`));
    },
};

module.exports = Emails;
