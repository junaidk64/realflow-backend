import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import { ILead } from '../models/Lead';
import { IGmailConnection, GmailConnection } from '../models/GmailConnection';
import { SmtpConnection } from '../models/SmtpConnection';
import { ISettings, Settings } from '../models/Settings';
import { Template } from '../models/Template';
import { IWorkflowConfig } from '../models/Workflow';
import { getAuthenticatedClient } from './gmailService';
import { decrypt } from '../utils/encryption';
import logger from '../utils/logger';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExtraField(lead: Partial<ILead>, key: string): string {
  const ef = lead.extraFields
  if (!ef) return ''
  if (ef instanceof Map) return String(ef.get(key) || '')
  return String((ef as unknown as Record<string, unknown>)[key] || '')
}

interface DetailItem { icon: string; label: string; value: string }

function getBusinessDetails(lead: Partial<ILead>): DetailItem[] {
  const type = lead.businessType || 'general'
  const items: (DetailItem | null)[] = []

  switch (type) {
    case 'moving':
      items.push(
        lead.fromAddress ? { icon: '📍', label: 'Moving From', value: lead.fromAddress } : null,
        lead.toAddress ? { icon: '🏠', label: 'Moving To', value: lead.toAddress } : null,
        lead.movingDate ? { icon: '📅', label: 'Moving Date', value: lead.movingDate } : null,
        lead.services?.length ? { icon: '📦', label: 'Services', value: lead.services.join(', ') } : null,
      )
      break
    case 'real_estate': {
      const prop = getExtraField(lead, 'propertyAddress')
      const budget = getExtraField(lead, 'budget')
      const viewing = getExtraField(lead, 'viewingDate')
      const beds = getExtraField(lead, 'bedrooms')
      items.push(
        prop ? { icon: '🏡', label: 'Property', value: prop } : null,
        budget ? { icon: '💰', label: 'Budget', value: budget } : null,
        viewing ? { icon: '📅', label: 'Viewing Date', value: viewing } : null,
        beds ? { icon: '🛏️', label: 'Bedrooms', value: beds } : null,
      )
      break
    }
    case 'insurance': {
      const policy = getExtraField(lead, 'policyType')
      const coverage = getExtraField(lead, 'coverageAmount')
      const renewal = getExtraField(lead, 'renewalDate')
      const provider = getExtraField(lead, 'currentProvider')
      items.push(
        policy ? { icon: '🛡️', label: 'Policy Type', value: policy } : null,
        coverage ? { icon: '💰', label: 'Coverage Amount', value: coverage } : null,
        renewal ? { icon: '📅', label: 'Renewal Date', value: renewal } : null,
        provider ? { icon: '🏢', label: 'Current Provider', value: provider } : null,
      )
      break
    }
    case 'cleaning': {
      const date = getExtraField(lead, 'serviceDate')
      const propType = getExtraField(lead, 'propertyType')
      const freq = getExtraField(lead, 'frequency')
      const sqft = getExtraField(lead, 'squareFeet')
      items.push(
        date ? { icon: '📅', label: 'Service Date', value: date } : null,
        propType ? { icon: '🏠', label: 'Property Type', value: propType } : null,
        freq ? { icon: '🔄', label: 'Frequency', value: freq } : null,
        sqft ? { icon: '📐', label: 'Area Size', value: `${sqft} sq ft` } : null,
      )
      break
    }
    case 'legal': {
      const caseType = getExtraField(lead, 'caseType')
      const urgency = getExtraField(lead, 'urgency')
      const consult = getExtraField(lead, 'consultationDate')
      items.push(
        caseType ? { icon: '⚖️', label: 'Case Type', value: caseType } : null,
        urgency ? { icon: '⚡', label: 'Urgency', value: urgency } : null,
        consult ? { icon: '📅', label: 'Consultation Date', value: consult } : null,
      )
      break
    }
    default: {
      const service = getExtraField(lead, 'serviceRequired')
      const prefDate = getExtraField(lead, 'preferredDate')
      const budget = getExtraField(lead, 'budget')
      items.push(
        service ? { icon: '🔧', label: 'Service Required', value: service } : null,
        prefDate ? { icon: '📅', label: 'Preferred Date', value: prefDate } : null,
        budget ? { icon: '💰', label: 'Budget', value: budget } : null,
      )
    }
  }

  return items.filter((x): x is DetailItem => x !== null)
}

interface BusinessContent {
  headline: string
  subline: string
  sectionLabel: string
  steps: Array<{ title: string; desc: string }>
}

function getBusinessContent(businessType: string, companyName: string): BusinessContent {
  switch (businessType) {
    case 'moving':
      return {
        headline: "We've Received Your Moving Request!",
        subline: `our team is reviewing your details and will provide a competitive quote within 2 hours.`,
        sectionLabel: 'Your Moving Details',
        steps: [
          { title: 'Review', desc: 'We review your moving requirements in detail' },
          { title: 'Quote', desc: 'We prepare a competitive, transparent quote' },
          { title: 'Contact', desc: "We'll reach out within 2 hours to confirm" },
        ],
      }
    case 'real_estate':
      return {
        headline: "We've Received Your Property Enquiry!",
        subline: `our agent will be in touch shortly to discuss your requirements and arrange a viewing.`,
        sectionLabel: 'Your Property Interests',
        steps: [
          { title: 'Review', desc: 'We review your property preferences carefully' },
          { title: 'Match', desc: 'We identify properties that fit your needs' },
          { title: 'Contact', desc: 'Our agent will call to arrange viewings' },
        ],
      }
    case 'insurance':
      return {
        headline: "We've Received Your Insurance Request!",
        subline: `our advisor will compare policies and find the best coverage for your specific needs.`,
        sectionLabel: 'Your Coverage Details',
        steps: [
          { title: 'Review', desc: 'We review your insurance requirements' },
          { title: 'Compare', desc: 'We compare top policies from leading providers' },
          { title: 'Advise', desc: 'Our advisor will present the best options' },
        ],
      }
    case 'cleaning':
      return {
        headline: "We've Received Your Cleaning Request!",
        subline: `our team will confirm availability and send a tailored quote for your property.`,
        sectionLabel: 'Your Service Details',
        steps: [
          { title: 'Review', desc: 'We review your cleaning requirements' },
          { title: 'Schedule', desc: 'We check availability for your preferred date' },
          { title: 'Confirm', desc: "We'll confirm your booking with full details" },
        ],
      }
    case 'legal':
      return {
        headline: "We've Received Your Legal Enquiry!",
        subline: `our attorney will review your case details and contact you within 24 hours.`,
        sectionLabel: 'Your Case Details',
        steps: [
          { title: 'Review', desc: 'Our attorney reviews your case in detail' },
          { title: 'Consult', desc: 'We schedule a confidential consultation' },
          { title: 'Advise', desc: 'We provide expert legal guidance and next steps' },
        ],
      }
    default:
      return {
        headline: "We've Received Your Enquiry!",
        subline: `our team will review your requirements and get back to you shortly with our best offer.`,
        sectionLabel: 'Your Request Details',
        steps: [
          { title: 'Review', desc: 'We review your requirements carefully' },
          { title: 'Prepare', desc: 'We prepare a tailored response for you' },
          { title: 'Contact', desc: "We'll reach out with our best offer" },
        ],
      }
  }
}

function renderDetailRows(items: DetailItem[]): string {
  if (!items.length) return ''
  return items.map(item => `
<tr>
<td style="padding-bottom:12px;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:12px;">
<tr><td style="padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="width:32px;vertical-align:top;"><span style="font-size:18px;">${item.icon}</span></td>
<td style="vertical-align:top;padding-left:8px;">
<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">${item.label}</div>
<div style="font-size:14px;color:#ffffff;font-weight:500;">${item.value}</div>
</td>
</tr>
</table>
</td></tr>
</table>
</td>
</tr>`).join('')
}

function renderSteps(steps: Array<{ title: string; desc: string }>): string {
  return steps.map((step, i) => `
<tr>
<td style="padding-bottom:12px;">
<table cellpadding="0" cellspacing="0">
<tr>
<td style="vertical-align:top;width:28px;">
<div style="width:22px;height:22px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;text-align:center;line-height:22px;font-size:11px;font-weight:700;color:white;">${i + 1}</div>
</td>
<td style="vertical-align:top;padding-left:12px;">
<p style="margin:0;font-size:14px;color:rgba(255,255,255,0.75);line-height:1.5;"><strong style="color:white;">${step.title}</strong> — ${step.desc}</p>
</td>
</tr>
</table>
</td>
</tr>`).join('')
}

// ─── Main export ─────────────────────────────────────────────────────────────

export const generateAutoReplyHTML = (lead: Partial<ILead>, settings?: Partial<ISettings>): string => {
  const companyName = settings?.businessName || 'Our Team'
  const customerName = lead.customerName || 'there'
  const businessType = lead.businessType || 'general'
  const emailSignature = settings?.emailSignature || ''
  const content = getBusinessContent(businessType, companyName)
  const details = getBusinessDetails(lead)

  const detailsSection = details.length ? `
<!-- Details Grid -->
<tr>
<td style="padding-bottom:32px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:16px;">
<h3 style="margin:0 0 16px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.5px;">${content.sectionLabel}</h3>
</td></tr>
${renderDetailRows(details)}
</table>
</td>
</tr>` : ''

  const customMessageBlock = settings?.autoReplyTemplate ? `
<tr>
<td style="padding-bottom:32px;">
<div style="background:rgba(102,126,234,0.1);border:1px solid rgba(102,126,234,0.2);border-radius:12px;padding:20px;">
<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.8);line-height:1.7;">${settings.autoReplyTemplate}</p>
</div>
</td>
</tr>` : ''

  const signatureBlock = emailSignature ? `
<tr>
<td style="padding-top:8px;padding-bottom:16px;">
<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:24px;">
<p style="margin:0;font-size:14px;color:rgba(255,255,255,0.55);line-height:1.8;white-space:pre-line;">${emailSignature}</p>
</div>
</td>
</tr>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${content.headline}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%);min-height:100vh;">
<table width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%);">
<tr>
<td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- Company Header -->
<tr>
<td align="center" style="padding-bottom:32px;">
<div style="display:inline-block;background:rgba(255,255,255,0.1);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.2);border-radius:16px;padding:16px 32px;">
<span style="font-size:24px;font-weight:700;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#667eea;letter-spacing:-0.5px;">${companyName}</span>
</div>
</td>
</tr>

<!-- Main Card -->
<tr>
<td style="background:rgba(255,255,255,0.08);backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);border:1px solid rgba(255,255,255,0.12);border-radius:24px;padding:48px;box-shadow:0 32px 64px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.05);">
<table width="100%" cellpadding="0" cellspacing="0">

<!-- Icon -->
<tr>
<td align="center" style="padding-bottom:32px;">
<div style="width:72px;height:72px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:32px;box-shadow:0 8px 32px rgba(102,126,234,0.4);">✅</div>
</td>
</tr>

<!-- Headline -->
<tr>
<td align="center" style="padding-bottom:12px;">
<h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">${content.headline}</h1>
</td>
</tr>

<!-- Subheadline -->
<tr>
<td align="center" style="padding-bottom:40px;">
<p style="margin:0;font-size:16px;color:rgba(255,255,255,0.65);line-height:1.6;">
Hi <strong style="color:#a78bfa;">${customerName}</strong>, ${content.subline}
</p>
</td>
</tr>

<!-- Divider -->
<tr><td style="padding-bottom:32px;"><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);"></div></td></tr>

${detailsSection}

${customMessageBlock}

<!-- Divider -->
<tr><td style="padding-bottom:32px;"><div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);"></div></td></tr>

<!-- What Happens Next -->
<tr>
<td style="padding-bottom:32px;">
<h3 style="margin:0 0 20px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1.5px;">What Happens Next</h3>
<table width="100%" cellpadding="0" cellspacing="0">
${renderSteps(content.steps)}
</table>
</td>
</tr>

${signatureBlock}

</table>
</td>
</tr>

<!-- Footer -->
<tr>
<td align="center" style="padding-top:32px;padding-bottom:8px;">
<p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);line-height:1.6;">
This is an automated response from ${companyName}.<br>
Our team will follow up personally soon.
</p>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`
}

export const sendAutoReply = async (
  lead: Partial<ILead>,
  gmailConnection: IGmailConnection,
  settings?: Partial<ISettings>,
  userId?: string,
): Promise<{ success: boolean; messageId?: string; html?: string; error?: string }> => {
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
        return { success: true, messageId: info.messageId, html: htmlContent };
      } catch (err) {
        logger.warn(`SMTP auto-reply failed for user ${userId}, falling back to Gmail: ${(err as Error).message}`);
      }
    }
  }

  // Fallback to Gmail OAuth
  try {
    const auth = await getAuthenticatedClient(gmailConnection);
    const gmail = google.gmail({ version: 'v1', auth });

    const fromHeader = settings?.businessName
      ? `"${settings.businessName}" <${gmailConnection.email}>`
      : gmailConnection.email

    const message = [
      `From: ${fromHeader}`,
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
    return { success: true, messageId: response.data.id || undefined, html: htmlContent };
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
    // Allow user's own templates regardless of approval (approval gate is for a public marketplace, not personal use)
    const template = await Template.findOne({
      _id: workflowConfig.templateId,
      $or: [{ status: 'approved' }, { userId: lead.userId }],
    })
    if (template) {
      const extraFields = lead.extraFields instanceof Map
        ? Object.fromEntries(lead.extraFields)
        : ((lead.extraFields as unknown as Record<string, unknown>) || {})

      const vars: Record<string, string> = {
        customerName: lead.customerName || '',
        customerEmail: lead.customerEmail || '',
        customerPhone: lead.customerPhone || '',
        fromAddress: lead.fromAddress || '',
        toAddress: lead.toAddress || '',
        movingDate: lead.movingDate || '',
        services: (lead.services || []).join(', '),
        businessName: settings?.businessName || '',
        emailSignature: settings?.emailSignature || '',
        timestamp: new Date().toISOString(),
        ...Object.fromEntries(
          Object.entries(extraFields).map(([k, v]) => [k, String(v || '')])
        ),
      }
      html = template.htmlContent.replace(
        /\{\{(\w+)\}\}/g,
        (_, key) => String(vars[key] ?? ''),
      )
    }
  }

  if (!html) {
    html = generateAutoReplyHTML(lead, settings || undefined)
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

      const userSettings = await Settings.findOne({ userId }).lean()
      const gmailFrom = userSettings?.businessName
        ? `"${userSettings.businessName}" <${gmailConn.email}>`
        : gmailConn.email

      const headers = [
        `From: ${gmailFrom}`,
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
