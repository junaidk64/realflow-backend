/**
 * Seeds default system email templates (3 per business type).
 * Run once: npx ts-node src/scripts/seedSystemTemplates.ts
 *
 * Safe to re-run — skips templates whose name already exists as a system template.
 */

import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import { connectDatabase } from '../config/database'
import { Template } from '../models/Template'
import logger from '../utils/logger'

interface TemplateDefinition {
  name: string
  description: string
  businessType: string
  htmlContent: string
}

const gradientBase = `background:linear-gradient(135deg,#0f0c29 0%,#302b63 50%,#24243e 100%)`

function makeTemplate(
  businessType: string,
  variant: 'standard' | 'premium' | 'minimal',
  headline: string,
  intro: string,
  body: string,
): string {
  const accentMap: Record<typeof variant, string> = {
    standard: 'linear-gradient(135deg,#667eea,#764ba2)',
    premium: 'linear-gradient(135deg,#f093fb,#f5576c)',
    minimal: 'linear-gradient(135deg,#4facfe,#00f2fe)',
  }
  const accent = accentMap[variant]

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${headline}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;${gradientBase};min-height:100vh;">
<table width="100%" cellpadding="0" cellspacing="0" style="min-height:100vh;${gradientBase};">
<tr><td align="center" style="padding:40px 20px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<tr><td align="center" style="padding-bottom:28px;">
<div style="display:inline-block;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:14px;padding:14px 28px;">
<span style="font-size:22px;font-weight:700;background:${accent};-webkit-background-clip:text;-webkit-text-fill-color:transparent;color:#667eea;">{{businessName}}</span>
</div>
</td></tr>

<tr><td style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:40px;">
<table width="100%" cellpadding="0" cellspacing="0">

<tr><td align="center" style="padding-bottom:28px;">
<div style="width:64px;height:64px;background:${accent};border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:28px;">✅</div>
</td></tr>

<tr><td align="center" style="padding-bottom:10px;">
<h1 style="margin:0;font-size:26px;font-weight:700;color:#fff;">${headline}</h1>
</td></tr>

<tr><td align="center" style="padding-bottom:32px;">
<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.65);line-height:1.6;">
Hi <strong style="color:#a78bfa;">{{customerName}}</strong>, ${intro}
</p>
</td></tr>

<tr><td style="padding-bottom:28px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);"></div>
</td></tr>

<tr><td style="padding-bottom:28px;">
<div style="background:rgba(102,126,234,0.08);border:1px solid rgba(102,126,234,0.2);border-radius:12px;padding:20px;">
<p style="margin:0;font-size:15px;color:rgba(255,255,255,0.8);line-height:1.7;">${body}</p>
</div>
</td></tr>

<tr><td style="padding-bottom:20px;">
<div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.15),transparent);"></div>
</td></tr>

<tr><td>
<p style="margin:0;font-size:13px;color:rgba(255,255,255,0.45);white-space:pre-line;">{{emailSignature}}</p>
</td></tr>

</table>
</td></tr>

<tr><td align="center" style="padding-top:24px;">
<p style="margin:0;font-size:11px;color:rgba(255,255,255,0.25);">Automated response from {{businessName}}. Our team will follow up personally.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

const SYSTEM_TEMPLATES: TemplateDefinition[] = [
  // ─── Moving ───────────────────────────────────────────────────────────────
  {
    name: 'Moving — Standard',
    description: 'Professional auto-reply for moving enquiries with 2-hour quote promise.',
    businessType: 'moving',
    htmlContent: makeTemplate(
      'moving',
      'standard',
      "We've Received Your Moving Request!",
      'our team is reviewing your details and will provide a competitive quote within 2 hours.',
      "We understand that moving can be stressful, so we've made our process as smooth as possible. Our trained specialists will assess your requirements and send a transparent, itemised quote by email. No hidden fees — ever.",
    ),
  },
  {
    name: 'Moving — Premium White Glove',
    description: 'Upscale tone for premium moving services, emphasising care and expertise.',
    businessType: 'moving',
    htmlContent: makeTemplate(
      'moving',
      'premium',
      'Your Premium Move Starts Here',
      'your dedicated move coordinator will be in touch within the hour to discuss your requirements.',
      'From packing fragile antiques to transporting your entire office, our white-glove service handles every detail with precision and care. Expect a personalised call from your coordinator who will walk you through every step of your relocation journey.',
    ),
  },
  {
    name: 'Moving — Quick Quote',
    description: 'Short and direct — ideal for high-volume enquiries where speed is key.',
    businessType: 'moving',
    htmlContent: makeTemplate(
      'moving',
      'minimal',
      'Got It — Quote Coming Shortly',
      'we have your request and are preparing your free, no-obligation quote right now.',
      "You'll receive your personalised moving quote within 2 hours. In the meantime, feel free to reply to this email with any questions — we respond within 30 minutes during business hours.",
    ),
  },

  // ─── Real Estate ──────────────────────────────────────────────────────────
  {
    name: 'Real Estate — Standard',
    description: 'Warm response for property enquiries, highlighting personalised agent contact.',
    businessType: 'real_estate',
    htmlContent: makeTemplate(
      'real_estate',
      'standard',
      "We've Received Your Property Enquiry!",
      'our agent will be in touch shortly to discuss your requirements and arrange a viewing.',
      'Whether you are buying, selling, or renting, our experienced agents are here to guide you every step of the way. We will match you with properties that fit your criteria and arrange viewings at times that suit you.',
    ),
  },
  {
    name: 'Real Estate — Luxury',
    description: 'Exclusive tone for high-value property enquiries.',
    businessType: 'real_estate',
    htmlContent: makeTemplate(
      'real_estate',
      'premium',
      'Welcome to Exclusive Property Search',
      'your personal property consultant will contact you within 24 hours.',
      'Access to our curated portfolio of exclusive properties is reserved for discerning clients. Your consultant will conduct a thorough needs assessment and present a handpicked selection of properties that meet your exact specifications — including off-market opportunities.',
    ),
  },
  {
    name: 'Real Estate — Quick Response',
    description: 'Fast and friendly — sets clear next-step expectations.',
    businessType: 'real_estate',
    htmlContent: makeTemplate(
      'real_estate',
      'minimal',
      "Enquiry Received — We'll Be In Touch",
      "we have your property enquiry and will call you within 1 business day.",
      "To speed up the process, have the following ready: your preferred areas, budget range, and ideal move-in date. Our agents will use this to pre-filter listings and save you time.",
    ),
  },

  // ─── Insurance ────────────────────────────────────────────────────────────
  {
    name: 'Insurance — Standard',
    description: 'Trust-building response for insurance enquiries, emphasising expert advice.',
    businessType: 'insurance',
    htmlContent: makeTemplate(
      'insurance',
      'standard',
      "We've Received Your Insurance Request!",
      'our advisor will compare policies and find the best coverage for your specific needs.',
      'Insurance decisions are important. Our fully qualified advisors will take the time to understand your situation, compare policies across multiple providers, and present the best options clearly — with no jargon and no pressure.',
    ),
  },
  {
    name: 'Insurance — Competitive Quote',
    description: 'Value-focused response highlighting savings and speed.',
    businessType: 'insurance',
    htmlContent: makeTemplate(
      'insurance',
      'premium',
      "Let's Find You the Best Rate",
      'our comparison tool is already searching 50+ insurers for your best deal.',
      'Our advisors search across a wide panel of insurers to find you competitive rates without compromising on coverage. You could save significantly on your current premium. Expect a personalised quote summary within 24 hours.',
    ),
  },
  {
    name: 'Insurance — Simple & Direct',
    description: 'No-frills response that sets clear timeline expectations.',
    businessType: 'insurance',
    htmlContent: makeTemplate(
      'insurance',
      'minimal',
      'Insurance Enquiry Received',
      "we'll review your requirements and send options within 24 hours.",
      'Our team will compare relevant policies and send you a clear breakdown of your best options by email. You are under no obligation to proceed — just information, clearly presented.',
    ),
  },

  // ─── Cleaning ─────────────────────────────────────────────────────────────
  {
    name: 'Cleaning — Standard',
    description: 'Friendly and professional response for cleaning service bookings.',
    businessType: 'cleaning',
    htmlContent: makeTemplate(
      'cleaning',
      'standard',
      "We've Received Your Cleaning Request!",
      'our team will confirm availability and send a tailored quote for your property.',
      'We take pride in delivering spotless results on every job. Our experienced cleaners use eco-friendly products and professional-grade equipment. Expect a confirmed booking and full pricing within 2 hours.',
    ),
  },
  {
    name: 'Cleaning — Premium Deep Clean',
    description: 'Upscale tone for premium or deep cleaning services.',
    businessType: 'cleaning',
    htmlContent: makeTemplate(
      'cleaning',
      'premium',
      'Your Premium Clean is Booked In',
      'your dedicated cleaning coordinator will confirm all details within the hour.',
      'Our premium deep-clean service covers every surface, corner, and fixture to an exacting standard. All products are non-toxic, pet-safe, and environmentally responsible. Your coordinator will confirm your preferred date and any specific requirements.',
    ),
  },
  {
    name: 'Cleaning — Quick Booking',
    description: 'Speed-focused response for same-day or urgent cleaning requests.',
    businessType: 'cleaning',
    htmlContent: makeTemplate(
      'cleaning',
      'minimal',
      'Cleaning Request Received',
      "we'll confirm your slot and price within 2 hours.",
      'Need it fast? Let us know if you require a same-day or next-day clean and we will do our best to accommodate. Reply to this email or call us directly to confirm your booking faster.',
    ),
  },

  // ─── Legal ────────────────────────────────────────────────────────────────
  {
    name: 'Legal — Standard',
    description: 'Professional and reassuring response for legal enquiries.',
    businessType: 'legal',
    htmlContent: makeTemplate(
      'legal',
      'standard',
      "We've Received Your Legal Enquiry!",
      'our attorney will review your case details and contact you within 24 hours.',
      'We understand that legal matters can be stressful. Our experienced attorneys will review your enquiry in full confidence and contact you to discuss the best course of action. Your initial consultation is always free.',
    ),
  },
  {
    name: 'Legal — Urgent Case',
    description: 'Time-sensitive response for urgent legal matters.',
    businessType: 'legal',
    htmlContent: makeTemplate(
      'legal',
      'premium',
      'Urgent Legal Matter — We Are On It',
      'a senior attorney will review your case and contact you within 2 hours.',
      'Urgent legal situations require immediate attention. A senior member of our team has been notified and will contact you promptly to assess your situation and advise on immediate next steps. All communications are strictly confidential.',
    ),
  },
  {
    name: 'Legal — Free Consultation Offer',
    description: 'Conversion-focused response offering a free consultation call.',
    businessType: 'legal',
    htmlContent: makeTemplate(
      'legal',
      'minimal',
      'Legal Enquiry Received',
      "we'll review your case and schedule a free consultation call.",
      'Every client is entitled to a free 30-minute consultation. We will review the details you have provided and contact you to schedule this call at your convenience. There is no commitment required — just clear, honest legal advice.',
    ),
  },

  // ─── General ──────────────────────────────────────────────────────────────
  {
    name: 'General — Standard',
    description: 'All-purpose professional auto-reply for general business enquiries.',
    businessType: 'general',
    htmlContent: makeTemplate(
      'general',
      'standard',
      "We've Received Your Enquiry!",
      'our team will review your requirements and get back to you shortly.',
      'We take every enquiry seriously. Our team will review your message and respond with a tailored proposal within 1 business day. In the meantime, feel free to reply to this email with any additional details.',
    ),
  },
  {
    name: 'General — Premium Service',
    description: 'Elevated tone for businesses offering premium products or services.',
    businessType: 'general',
    htmlContent: makeTemplate(
      'general',
      'premium',
      'Thank You for Reaching Out',
      'a dedicated account manager will be in contact with you shortly.',
      'At {{businessName}}, we believe every client deserves a personalised experience. Your dedicated account manager will review your requirements and prepare a bespoke proposal tailored specifically to your needs.',
    ),
  },
  {
    name: 'General — Simple & Fast',
    description: 'Minimal, direct response for high-volume general enquiries.',
    businessType: 'general',
    htmlContent: makeTemplate(
      'general',
      'minimal',
      'Enquiry Received',
      "we'll be in touch within 1 business day.",
      "We have your message and will respond within 1 business day. For urgent matters, please include 'URGENT' in your reply and we'll prioritise accordingly.",
    ),
  },
]

async function seed(): Promise<void> {
  await connectDatabase()

  let created = 0
  let skipped = 0

  for (const def of SYSTEM_TEMPLATES) {
    const existing = await Template.findOne({
      name: def.name,
      isSystemTemplate: true,
    })

    if (existing) {
      skipped++
      continue
    }

    await Template.create({
      userId: null,
      organizationId: null,
      name: def.name,
      description: def.description,
      htmlContent: def.htmlContent,
      businessType: def.businessType,
      tags: [],
      status: 'approved',
      publishedAt: new Date(),
      isSystemTemplate: true,
      systemTemplateId: null,
    })
    created++
    logger.info(`Created: ${def.name}`)
  }

  logger.info(`Seed complete — ${created} created, ${skipped} skipped`)
  await mongoose.disconnect()
}

seed().catch((err) => {
  logger.error('Seed failed:', err)
  process.exit(1)
})
