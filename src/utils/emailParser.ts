import { simpleParser, ParsedMail, AddressObject } from 'mailparser';
import * as cheerio from 'cheerio';
import logger from './logger';

export interface ParsedEmailData {
  subject: string;
  from: string;
  fromName: string;
  to: string;
  date: Date | null;
  textBody: string;
  htmlBody: string;
  attachments: Array<{ filename: string; contentType: string; size: number }>;
}

export interface ExtractedLeadData {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  movingDate: string;
  fromAddress: string;
  toAddress: string;
  services: string[];
  notes: string;
  confidence: number;
  rawText: string;
}

export const parseEmailBuffer = async (buffer: Buffer): Promise<ParsedEmailData> => {
  try {
    const parsed: ParsedMail = await simpleParser(buffer);
    const fromAddr = parsed.from?.value?.[0];
    return {
      subject: parsed.subject || '',
      from: fromAddr?.address || '',
      fromName: fromAddr?.name || '',
      to: (parsed.to as AddressObject)?.value?.[0]?.address || '',
      date: parsed.date || null,
      textBody: parsed.text || '',
      htmlBody: parsed.html || '',
      attachments: (parsed.attachments || []).map(att => ({
        filename: att.filename || 'unknown',
        contentType: att.contentType,
        size: att.size,
      })),
    };
  } catch (error) {
    logger.error('Failed to parse email buffer:', error);
    throw error;
  }
};

export const extractTextFromHtml = (html: string): string => {
  try {
    const $ = cheerio.load(html);
    $('script, style, head').remove();
    return $.text().replace(/\s+/g, ' ').trim();
  } catch {
    return html;
  }
};

export const extractLeadDataFromEmail = (
  subject: string,
  textBody: string,
  htmlBody: string,
  fromEmail: string
): ExtractedLeadData => {
  const rawText = textBody || extractTextFromHtml(htmlBody);
  const fullText = `${subject}\n${rawText}`;
  const fullTextLower = fullText.toLowerCase();

  let confidence = 0;
  const result: ExtractedLeadData = {
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    movingDate: '',
    fromAddress: '',
    toAddress: '',
    services: [],
    notes: '',
    confidence: 0,
    rawText,
  };

  // Confidence boost for known lead aggregator / platform sources
  const knownLeadSources = [
    'comparemymove', 'anyvan', 'reallymoving', 'movingiq', 'shiply', 'bark.com',
    'rightmove', 'zoopla', 'onthemarket', 'purplebricks', 'openrent',
    'confused.com', 'gocompare', 'comparethemarket', 'moneysupermarket',
    'checkatrade', 'rated people', 'trustatrader', 'mybuilder',
  ];
  if (knownLeadSources.some(src => fullTextLower.includes(src))) {
    confidence += 25;
  }

  // ── CMM section-header extraction ─────────────────────────────────────────
  // CMM emails use "Section Header\n\nvalue" (value on next line, no colon)
  if (fullTextLower.includes('comparemymove')) {
    // Name: first non-empty line after "Contact Details"
    const cmmName = rawText.match(/Contact Details[\r\n]+([\w][^\r\n]+)/i);
    if (cmmName?.[1]) {
      result.customerName = cmmName[1].trim();
      confidence += 20;
    }

    // Moving date: first non-empty line after "Moving Date"
    const cmmDate = rawText.match(/Moving Date[\r\n]+([\w][^\r\n]+)/i);
    if (cmmDate?.[1]) {
      result.movingDate = cmmDate[1].trim();
      confidence += 15;
    }

    // Current address (from): multi-line block until Bedrooms/Home Type/New Address
    const cmmFrom = rawText.match(/Current Address\s*[\r\n]+([\s\S]+?)(?=Bedrooms:|Home Type:|New Address)/i);
    if (cmmFrom?.[1]) {
      result.fromAddress = cmmFrom[1].replace(/[\r\n]+/g, ', ').trim().replace(/,\s*$/, '');
      confidence += 10;
    }

    // New address (to): multi-line block until Additional Services/information
    const cmmTo = rawText.match(/New Address\s*[\r\n]+([\s\S]+?)(?=Additional(?:\s+Services|\s+information))/i);
    if (cmmTo?.[1]) {
      result.toAddress = cmmTo[1].replace(/[\r\n]+/g, ', ').trim().replace(/,\s*$/, '');
      confidence += 10;
    }

    // Services: first non-empty line after "Additional Services"
    const cmmServices = rawText.match(/Additional Services[\r\n]+([\w][^\r\n]+)/i);
    if (cmmServices?.[1]) {
      result.services = cmmServices[1].split(/[,\/\|&]/).map(s => s.trim()).filter(Boolean);
      confidence += 10;
    }
  }

  // ── Real Estate / State Agent extraction ──────────────────────────────────
  if (fullTextLower.includes('rightmove') || fullTextLower.includes('zoopla') ||
      fullTextLower.includes('estate agent') || fullTextLower.includes('real estate') ||
      fullTextLower.includes('property enquiry') || fullTextLower.includes('viewing request')) {

    if (!result.fromAddress) {
      const propPatterns = [
        /(?:property\s+address|property\s+of\s+interest|interested\s+in)\s*[:\-]\s*([^\n\r]+)/i,
        /(?:viewing\s+for|enquiring\s+about)\s*[:\-]?\s*([^\n\r]+)/i,
        /^Property:\s*(.+)$/im,
      ];
      for (const pattern of propPatterns) {
        const match = fullText.match(pattern);
        if (match?.[1]) {
          result.fromAddress = match[1].trim();
          confidence += 15;
          break;
        }
      }
    }

    if (!result.toAddress) {
      const areaPatterns = [
        /(?:preferred\s+area|desired\s+location|search\s+area|looking\s+in)\s*[:\-]\s*([^\n\r]+)/i,
        /(?:area\s+of\s+interest|target\s+area)\s*[:\-]\s*([^\n\r]+)/i,
      ];
      for (const pattern of areaPatterns) {
        const match = fullText.match(pattern);
        if (match?.[1]) {
          result.toAddress = match[1].trim();
          confidence += 10;
          break;
        }
      }
    }

    if (!result.movingDate) {
      const viewingPatterns = [
        /(?:preferred\s+viewing|viewing\s+date|viewing\s+time|available\s+for\s+viewing)\s*[:\-]\s*([^\n\r]+)/i,
        /(?:appointment|available\s+from)\s*[:\-]\s*([^\n\r]+)/i,
      ];
      for (const pattern of viewingPatterns) {
        const match = fullText.match(pattern);
        if (match?.[1]) {
          result.movingDate = match[1].trim();
          confidence += 10;
          break;
        }
      }
    }

    const bedroomMatch = fullText.match(/(\d+)\s*(?:bed(?:room)?s?|br)\b/i);
    if (bedroomMatch && result.services.length === 0) {
      result.services.push(`${bedroomMatch[1]} bedroom`);
    }

    const budgetMatch = fullText.match(/(?:budget|price\s+range|max(?:imum)?(?:\s+price)?)\s*[:\-]?\s*[£$]?([\d,]+(?:\s*-\s*[£$]?[\d,]+)?)/i);
    if (budgetMatch && !result.notes) {
      result.notes = `Budget: ${budgetMatch[1]}`;
      confidence += 5;
    }
  }

  // ── Cleaning Service extraction ────────────────────────────────────────────
  if (fullTextLower.includes('cleaning') || fullTextLower.includes('deep clean') || fullTextLower.includes('end of tenancy')) {
    if (!result.fromAddress) {
      const cleanAddrPatterns = [
        /(?:property\s+address|address\s+to\s+clean|service\s+address)\s*[:\-]\s*([^\n\r]+)/i,
        /(?:your\s+address|location)\s*[:\-]\s*([^\n\r]+)/i,
      ];
      for (const pattern of cleanAddrPatterns) {
        const match = fullText.match(pattern);
        if (match?.[1]) { result.fromAddress = match[1].trim(); confidence += 10; break; }
      }
    }
    if (!result.movingDate) {
      const cleanDatePatterns = [
        /(?:service\s+date|clean(?:ing)?\s+date|preferred\s+date|required\s+by)\s*[:\-]\s*([^\n\r]+)/i,
      ];
      for (const pattern of cleanDatePatterns) {
        const match = fullText.match(pattern);
        if (match?.[1]) { result.movingDate = match[1].trim(); confidence += 10; break; }
      }
    }
    const cleanTypes = ['end of tenancy', 'deep clean', 'carpet cleaning', 'window cleaning', 'office cleaning', 'domestic cleaning', 'oven cleaning'];
    cleanTypes.forEach(ct => {
      if (fullTextLower.includes(ct) && !result.services.map(s => s.toLowerCase()).includes(ct)) {
        result.services.push(ct);
      }
    });
  }

  // ── Insurance extraction ───────────────────────────────────────────────────
  if (fullTextLower.includes('insurance') || fullTextLower.includes('policy') || fullTextLower.includes('coverage')) {
    if (!result.movingDate) {
      const insDatePatterns = [
        /(?:start\s+date|policy\s+start|cover(?:age)?\s+from|inception\s+date)\s*[:\-]\s*([^\n\r]+)/i,
      ];
      for (const pattern of insDatePatterns) {
        const match = fullText.match(pattern);
        if (match?.[1]) { result.movingDate = match[1].trim(); confidence += 10; break; }
      }
    }
    const insTypes = ['home insurance', 'buildings insurance', 'contents insurance', 'life insurance', 'car insurance', 'health insurance', 'landlord insurance', 'business insurance'];
    insTypes.forEach(it => {
      if (fullTextLower.includes(it) && !result.services.map(s => s.toLowerCase()).includes(it)) {
        result.services.push(it);
      }
    });
  }

  // ── Generic patterns (only fill fields not already populated) ──────────────

  // Name
  if (!result.customerName) {
    const namePatterns = [
      /(?:customer\s+name|full\s+name)\s*[:\-]\s*([^\n\r]+)/i,
      /(?:contact\s+name)\s*[:\-]\s*([^\n\r]+)/i,
      /^Name:\s*(.+)$/im,
      /(?:lead|enquiry|quote|request)\s+from\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i,
    ];
    for (const pattern of namePatterns) {
      const match = fullText.match(pattern);
      if (match?.[1]) {
        result.customerName = match[1].trim().replace(/[<>]/g, '');
        confidence += 20;
        break;
      }
    }
  }

  // Email — filter out platform addresses, keep customer email
  const emailPattern = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  const emailMatches = fullText.match(emailPattern) || [];
  const filteredEmails = emailMatches.filter(e =>
    !e.includes('noreply') &&
    !e.includes('no-reply') &&
    !e.includes('comparemymove.com') &&
    !e.includes('pstmrk.it') &&
    e !== fromEmail,
  );
  if (filteredEmails.length > 0) {
    result.customerEmail = filteredEmails[0];
    confidence += 20;
  } else if (fromEmail) {
    result.customerEmail = fromEmail;
    confidence += 10;
  }

  // Phone
  const phonePatterns = [
    /(?:phone|telephone|mobile|tel|contact\s+number)\s*[:\-]?\s*([\+\d][\d\s\-\(\)]{7,20})/i,
    /(?:call|ring)\s+(?:me|us|them)\s+(?:on|at)?\s*([\+\d][\d\s\-\(\)]{7,20})/i,
    /\b((?:\+44|0044|0)(?:\s?\d){9,12})\b/i,
    /\b(\d{5}\s?\d{6})\b/,
    /\b(\d{4}\s?\d{3}\s?\d{4})\b/,
  ];
  for (const pattern of phonePatterns) {
    const match = fullText.match(pattern);
    if (match?.[1]) {
      result.customerPhone = match[1].trim().replace(/\s+/g, ' ');
      confidence += 15;
      break;
    }
  }

  // Moving date (if not found by CMM block)
  if (!result.movingDate) {
    const datePatterns = [
      /(?:moving\s+date|move\s+date|removal\s+date|date\s+of\s+move|preferred\s+date)\s*[:\-]\s*([^\n\r]+)/i,
      /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4})\b/i,
      /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/,
    ];
    for (const pattern of datePatterns) {
      const match = fullText.match(pattern);
      if (match?.[1]) {
        result.movingDate = match[1].trim();
        confidence += 15;
        break;
      }
    }
  }

  // From address (if not found by CMM block)
  if (!result.fromAddress) {
    const fromPatterns = [
      /(?:moving\s+from|from\s+address|collection\s+address|pickup\s+address)\s*[:\-]\s*([^\n\r]+)/i,
      /(?:current\s+address|current\s+property)\s*[:\-]\s*([^\n\r]+)/i,
    ];
    for (const pattern of fromPatterns) {
      const match = fullText.match(pattern);
      if (match?.[1]) {
        const addr = match[1].trim();
        if (addr.length > 3 && addr.length < 200) {
          result.fromAddress = addr;
          confidence += 10;
          break;
        }
      }
    }
  }

  // To address (if not found by CMM block)
  if (!result.toAddress) {
    const toPatterns = [
      /(?:moving\s+to|to\s+address|delivery\s+address|destination\s+address)\s*[:\-]\s*([^\n\r]+)/i,
      /(?:new\s+address|new\s+property)\s*[:\-]\s*([^\n\r]+)/i,
    ];
    for (const pattern of toPatterns) {
      const match = fullText.match(pattern);
      if (match?.[1]) {
        const addr = match[1].trim();
        if (addr.length > 3 && addr.length < 200) {
          result.toAddress = addr;
          confidence += 10;
          break;
        }
      }
    }
  }

  // Services (if not found by CMM block)
  if (result.services.length === 0) {
    const servicesMatch = fullText.match(/(?:services?\s+required|services?\s+needed|removal\s+type)\s*[:\-]\s*([^\n\r]+)/i);
    if (servicesMatch?.[1]) {
      result.services = servicesMatch[1].split(/[,\/\|&]/).map(s => s.trim()).filter(Boolean);
      confidence += 10;
    }
  }

  // Keyword services supplement
  const serviceKeywords = ['packing', 'storage', 'dismantling', 'assembly', 'piano removal', 'specialist item', 'full packing', 'part packing', 'unpacking'];
  serviceKeywords.forEach(kw => {
    if (fullTextLower.includes(kw) && !result.services.map(s => s.toLowerCase()).includes(kw)) {
      result.services.push(kw);
    }
  });

  // Notes
  const notesPatterns = [
    /(?:additional\s+info(?:rmation)?|special\s+requirements?|notes?|comments?)\s*[:\-]\s*([^\n\r]{10,})/i,
    /(?:please\s+note|please\s+be\s+aware|important)\s*[:\-]?\s*([^\n\r]{10,})/i,
  ];
  for (const pattern of notesPatterns) {
    const match = fullText.match(pattern);
    if (match?.[1] && match[1].trim() !== 'N/A') {
      result.notes = match[1].trim();
      break;
    }
  }

  // Handle forwarded emails
  const forwardIndicators = ['---------- Forwarded message', '-------- Original Message'];
  const isForwarded = forwardIndicators.some(ind => fullText.includes(ind));
  if (isForwarded && result.customerEmail === fromEmail) {
    const forwardedEmailMatch = fullText.match(/(?:From|Sender):\s*(?:[^<\n]+<)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?/i);
    if (forwardedEmailMatch?.[1] && forwardedEmailMatch[1] !== fromEmail) {
      result.customerEmail = forwardedEmailMatch[1];
    }
  }

  result.confidence = Math.min(confidence, 100);
  return result;
};

export const isLeadEmail = (subject: string, textBody: string, fromEmail: string): boolean => {
  const text = `${subject} ${textBody}`.toLowerCase();

  const leadKeywords = [
    // Moving & Removals
    'moving', 'removal', 'removals', 'relocation', 'house move', 'flat move',
    'compare my move', 'comparemymove', 'anyvan', 'reallymoving',
    'from address', 'to address', 'moving date',
    'packing', 'storage', 'boxes',

    // Real Estate / State Agents
    'property', 'estate agent', 'real estate', 'house for sale', 'flat for sale',
    'valuation', 'viewing', 'offer', 'listing', 'bedroom', 'freehold', 'leasehold',
    'buy property', 'sell property', 'rental', 'tenancy', 'landlord', 'tenant',
    'asking price', 'stamp duty', 'conveyancing', 'chain free',

    // Insurance
    'insurance quote', 'policy', 'coverage', 'premium', 'claim',
    'life insurance', 'home insurance', 'health insurance', 'buildings insurance',
    'compare insurance', 'insurance enquiry',

    // Cleaning Services
    'cleaning service', 'end of tenancy clean', 'deep clean', 'carpet cleaning',
    'window cleaning', 'office cleaning', 'domestic cleaning', 'house cleaning',

    // Legal Services
    'legal advice', 'solicitor', 'legal consultation', 'conveyancing quote',
    'will writing', 'power of attorney', 'legal services',

    // General business lead signals
    'quote', 'quotation', 'enquiry', 'inquiry', 'estimate', 'get a quote',
    'contact form', 'service request', 'appointment', 'booking request',
    'free consultation', 'call back request', 'get in touch',
  ];

  const spamKeywords = [
    'unsubscribe', 'newsletter', 'no-reply', 'noreply',
    'marketing', 'promo', 'promotion', 'discount', 'sale ends',
    'weekly digest', 'daily digest', 'automated message',
  ];

  const fromEmailLower = fromEmail.toLowerCase();
  if (spamKeywords.some(kw => fromEmailLower.includes(kw))) return false;
  if (spamKeywords.some(kw => text.includes(kw) && !text.includes('enquiry') && !text.includes('quote'))) {
    const leadSignals = leadKeywords.filter(kw => text.includes(kw)).length;
    if (leadSignals < 3) return false;
  }

  const matchCount = leadKeywords.filter(kw => text.includes(kw)).length;
  return matchCount >= 2;
};

export default {
  parseEmailBuffer,
  extractTextFromHtml,
  extractLeadDataFromEmail,
  isLeadEmail,
};
