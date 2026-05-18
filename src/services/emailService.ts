import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { ILead } from '../models/Lead';
import { IGmailConnection, GmailConnection } from '../models/GmailConnection';
import { SmtpConnection } from '../models/SmtpConnection';
import { ISettings } from '../models/Settings';
import { Template } from '../models/Template';
import { IWorkflowConfig } from '../models/Workflow';
import { getAuthenticatedClient } from './gmailService';
import { decrypt } from '../utils/encryption';
import logger from '../utils/logger';

export const generateAutoReplyHTML = (lead: Partial<ILead>, settings?: Partial<ISettings>): string => {
  const companyName = 'MovePro Solutions';
  const customerName = lead.customerName || 'there';
  const movingDate = lead.movingDate || 'your chosen date';
  const fromAddr = lead.fromAddress || 'your current address';
  const toAddr = lead.toAddress || 'your new home';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Moving Quote Enquiry</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%);min-height:100vh;">
<table width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%);">
<tr>
<td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- Header Logo -->
<tr>
<td align="center" style="padding-bottom:32px;">
<div style="display:inline-block;background:rgba(255,255,255,0.1);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.2);border-radius:16px;padding:16px 32px;">
<span style="font-size:24px;font-weight:700;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#667eea;letter-spacing:-0.5px;">
🚛 ${companyName}
</span>
</div>
</td>
</tr>

<!-- Main Card -->
<tr>
<td style="background:rgba(255,255,255,0.08);backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:48px;box-shadow:0 32px 64px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.05);">

<!-- Checkmark Icon -->
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="center" style="padding-bottom:32px;">
<div style="width:72px;height:72px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:32px;box-shadow:0 8px 32px rgba(102,126,234,0.4);">
✅
</div>
</td>
</tr>

<!-- Headline -->
<tr>
<td align="center" style="padding-bottom:12px;">
<h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">
We've Received Your Enquiry!
</h1>
</td>
</tr>

<!-- Subheadline -->
<tr>
<td align="center" style="padding-bottom:40px;">
<p style="margin:0;font-size:16px;color:rgba(255,255,255,0.65);line-height:1.6;">
Hi <strong style="color:#a78bfa;">${customerName}</strong>, thank you for reaching out. Our team is already reviewing your moving request and will provide a competitive quote shortly.
</p>
</td>
</tr>

<!-- Divider -->
<tr>
<td style="padding-bottom:32px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);"></div>
</td>
</tr>

<!-- Details Grid -->
<tr>
<td style="padding-bottom:32px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding-bottom:16px;">
<h3 style="margin:0 0 16px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.5px;">Your Moving Details</h3>
</td>
</tr>

${fromAddr ? `
<tr>
<td style="padding-bottom:12px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:0;">
<tr>
<td style="padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="width:32px;vertical-align:top;">
<span style="font-size:18px;">📍</span>
</td>
<td style="vertical-align:top;padding-left:8px;">
<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Moving From</div>
<div style="font-size:14px;color:#ffffff;font-weight:500;">${fromAddr}</div>
</td>
</tr>
</table>
</td>
</tr>
</table>
</td>
</tr>` : ''}

${toAddr ? `
<tr>
<td style="padding-bottom:12px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;">
<tr>
<td style="padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="width:32px;vertical-align:top;">
<span style="font-size:18px;">🏠</span>
</td>
<td style="vertical-align:top;padding-left:8px;">
<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Moving To</div>
<div style="font-size:14px;color:#ffffff;font-weight:500;">${toAddr}</div>
</td>
</tr>
</table>
</td>
</tr>
</table>
</td>
</tr>` : ''}

${movingDate ? `
<tr>
<td style="padding-bottom:12px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;">
<tr>
<td style="padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="width:32px;vertical-align:top;">
<span style="font-size:18px;">📅</span>
</td>
<td style="vertical-align:top;padding-left:8px;">
<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Moving Date</div>
<div style="font-size:14px;color:#ffffff;font-weight:500;">${movingDate}</div>
</td>
</tr>
</table>
</td>
</tr>
</table>
</td>
</tr>` : ''}

</table>
</td>
</tr>

<!-- Custom message -->
${settings?.autoReplyTemplate ? `
<tr>
<td style="padding-bottom:32px;">
<div style="background:rgba(102,126,234,0.1);border:1px solid rgba(102,126,234,0.2);border-radius:12px;padding:20px;">
<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.8);line-height:1.7;">${settings.autoReplyTemplate}</p>
</div>
</td>
</tr>` : ''}

<!-- Divider -->
<tr>
<td style="padding-bottom:32px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);"></div>
</td>
</tr>

<!-- What happens next -->
<tr>
<td style="padding-bottom:32px;">
<h3 style="margin:0 0 20px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.5px;">What Happens Next</h3>
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding-bottom:12px;">
<table cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align:top;width:28px;">
<div style="width:22px;height:22px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;">1</div>
</td>
<td style="vertical-align:top;padding-left:12px;">
<p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.5;"><strong style="color:white;">Review</strong> — Our team reviews your requirements</p>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style="padding-bottom:12px;">
<table cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align:top;width:28px;">
<div style="width:22px;height:22px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;">2</div>
</td>
<td style="vertical-align:top;padding-left:12px;">
<p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.5;"><strong style="color:white;">Quote</strong> — We prepare a competitive, transparent quote</p>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td>
<table cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align:top;width:28px;">
<div style="width:22px;height:22px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;">3</div>
</td>
<td style="vertical-align:top;padding-left:12px;">
<p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.5;"><strong style="color:white;">Contact</strong> — We'll reach out within 2 hours</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</td>
</tr>

<!-- CTA -->
<tr>
<td align="center" style="padding-bottom:8px;">
<a href="mailto:${lead.customerEmail || ''}" style="display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:16px 40px;border-radius:12px;box-shadow:0 8px 32px rgba(102,126,234,0.35);letter-spacing:0.3px;">
Reply to This Email →
</a>
</td>
</tr>

</table>
</td>
</tr>

<!-- Footer -->
<tr>
<td align="center" style="padding-top:32px;padding-bottom:8px;">
<p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);line-height:1.6;">
This is an automated response. Our team will follow up personally within 2 hours.<br>
${companyName} • Powered by MovePro Automation
</p>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;
};

export const sendAutoReply = async (
  lead: Partial<ILead>,
  gmailConnection: IGmailConnection,
  settings?: Partial<ISettings>,
  userId?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  const toEmail = lead.customerEmail;
  if (!toEmail) {
    return { success: false, error: 'No customer email address' };
  }

  const subject = settings?.autoReplySubject || `Thank you for your enquiry - We'll be in touch soon!`;
  const htmlContent = generateAutoReplyHTML(lead, settings);

  // Try SMTP first if user has an active SMTP connection
  if (userId) {
    const smtpConn = await SmtpConnection.findOne({ userId, isActive: true });
    if (smtpConn) {
      try {
        const password = decrypt(smtpConn.password);
        const transporter = nodemailer.createTransport({
          host: smtpConn.host,
          port: smtpConn.port,
          secure: smtpConn.secure,
          auth: { user: smtpConn.user, pass: password },
        });

        const from = smtpConn.fromName
          ? `"${smtpConn.fromName}" <${smtpConn.fromEmail}>`
          : smtpConn.fromEmail;

        const info = await transporter.sendMail({ from, to: toEmail, subject, html: htmlContent });
        logger.info(`Auto-reply sent via SMTP to ${toEmail}, messageId: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
      } catch (err) {
        logger.warn(`SMTP auto-reply failed for user ${userId}, falling back to Gmail: ${(err as Error).message}`);
      }
    }
  }

  // Fallback to Gmail OAuth
  try {
    const auth = await getAuthenticatedClient(gmailConnection);
    const gmail = google.gmail({ version: 'v1', auth });

    const message = [
      `From: ${gmailConnection.email}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      `Content-Type: text/html; charset=UTF-8`,
      `MIME-Version: 1.0`,
      ``,
      htmlContent,
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64url');
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });

    logger.info(`Auto-reply sent via Gmail to ${toEmail}, messageId: ${response.data.id}`);
    return { success: true, messageId: response.data.id || undefined };
  } catch (error) {
    logger.error('Failed to send auto-reply via Gmail:', error);
    return { success: false, error: (error as Error).message };
  }
};

export const buildAutoReplyPayload = async (
  lead: Partial<ILead>,
  workflowConfig: Partial<IWorkflowConfig> & { workflowId: string },
  settings: Partial<ISettings> | null,
  from: string,
): Promise<{
  html: string
  subject: string
  to: string
  from: string
  leadId: string
  workflowId: string
}> => {
  const subject =
    workflowConfig.subject ||
    settings?.autoReplySubject ||
    'Thank you for your enquiry'
  let html = ''

  if (workflowConfig.templateId) {
    const template = await Template.findOne({
      _id: workflowConfig.templateId,
      status: 'approved',
    })
    if (template) {
      const vars: Record<string, string> = {
        customerName: lead.customerName || '',
        customerEmail: lead.customerEmail || '',
        fromAddress: lead.fromAddress || '',
        toAddress: lead.toAddress || '',
        movingDate: lead.movingDate || '',
        services: (lead.services || []).join(', '),
        businessName: settings?.businessName || '',
        emailSignature: settings?.emailSignature || '',
        timestamp: new Date().toISOString(),
      }
      html = template.htmlContent.replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => String(vars[key] ?? ''),
      )
    }
  }

  if (!html && settings?.autoReplyTemplate) {
    html = settings.autoReplyTemplate
      .replace(/\{\{customerName\}\}/g, lead.customerName || '')
      .replace(/\{\{fromAddress\}\}/g, lead.fromAddress || '')
      .replace(/\{\{toAddress\}\}/g, lead.toAddress || '')
      .replace(/\{\{movingDate\}\}/g, lead.movingDate || '')
      .replace(/\{\{businessName\}\}/g, settings.businessName || '')
      .replace(/\{\{emailSignature\}\}/g, settings.emailSignature || '')
  }

  return {
    html,
    subject,
    to: lead.customerEmail || '',
    from,
    leadId: lead._id?.toString() ?? '',
    workflowId: workflowConfig.workflowId,
  }
}

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  replyTo?: string
}

export interface SendEmailResult {
  success: boolean
  messageId?: string
  provider: 'gmail' | 'smtp' | 'none'
  error?: string
}

export const sendEmailForUser = async (
  userId: string,
  options: SendEmailOptions,
): Promise<SendEmailResult> => {
  const { to, subject, html, replyTo } = options

  // Try SMTP first if connected
  const smtpConn = await SmtpConnection.findOne({ userId, isActive: true })
  if (smtpConn) {
    try {
      const password = decrypt(smtpConn.password)
      const transporter = nodemailer.createTransport({
        host: smtpConn.host,
        port: smtpConn.port,
        secure: smtpConn.secure,
        auth: { user: smtpConn.user, pass: password },
      })

      const from = smtpConn.fromName
        ? `"${smtpConn.fromName}" <${smtpConn.fromEmail}>`
        : smtpConn.fromEmail

      const info = await transporter.sendMail({
        from,
        to,
        subject,
        html,
        ...(replyTo ? { replyTo } : {}),
      })

      logger.info(`Email sent via SMTP for user ${userId} to ${to}`)
      return { success: true, messageId: info.messageId, provider: 'smtp' }
    } catch (err) {
      logger.warn(`SMTP send failed for user ${userId}, falling back to Gmail: ${(err as Error).message}`)
    }
  }

  // Fallback to Gmail OAuth
  const gmailConn = await GmailConnection.findOne({ userId, isActive: true })
  if (gmailConn) {
    try {
      const auth = await getAuthenticatedClient(gmailConn)
      const gmail = google.gmail({ version: 'v1', auth })

      const headers = [
        `From: ${gmailConn.email}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/html; charset=UTF-8`,
        `MIME-Version: 1.0`,
      ]
      if (replyTo) headers.push(`Reply-To: ${replyTo}`)
      headers.push('', html)

      const encoded = Buffer.from(headers.join('\n')).toString('base64url')
      const resp = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encoded },
      })

      logger.info(`Email sent via Gmail for user ${userId} to ${to}`)
      return { success: true, messageId: resp.data.id || undefined, provider: 'gmail' }
    } catch (err) {
      logger.error(`Gmail send failed for user ${userId}: ${(err as Error).message}`)
      return { success: false, error: (err as Error).message, provider: 'gmail' }
    }
  }

  return {
    success: false,
    error: 'No email provider configured. Connect SMTP or Gmail in your account settings.',
    provider: 'none',
  }
}

export default { generateAutoReplyHTML, sendAutoReply, buildAutoReplyPayload, sendEmailForUser };
