import { ILead } from '../models/Lead';
import { extractLeadDataFromEmail, isLeadEmail } from '../utils/emailParser';
import logger from '../utils/logger';

export interface LeadExtractionResult {
  isLead: boolean;
  leadData: Partial<ILead>;
  confidence: number;
  reason: string;
}

export const extractLeadFromEmail = (
  subject: string,
  textBody: string,
  htmlBody: string,
  fromEmail: string,
  userId: string,
  rawEmailId: string
): LeadExtractionResult => {
  try {
    const isLead = isLeadEmail(subject, textBody, fromEmail);

    if (!isLead) {
      return {
        isLead: false,
        leadData: {},
        confidence: 0,
        reason: 'Email does not match lead criteria',
      };
    }

    const extracted = extractLeadDataFromEmail(subject, textBody, htmlBody, fromEmail);

    if (extracted.confidence < 20) {
      return {
        isLead: false,
        leadData: {},
        confidence: extracted.confidence,
        reason: 'Confidence too low',
      };
    }

    const leadData: Partial<ILead> = {
      userId: userId as unknown as ILead['userId'],
      source: 'email',
      rawEmailId,
      customerName: extracted.customerName,
      customerEmail: extracted.customerEmail || fromEmail,
      customerPhone: extracted.customerPhone,
      movingDate: extracted.movingDate,
      fromAddress: extracted.fromAddress,
      toAddress: extracted.toAddress,
      services: extracted.services,
      notes: extracted.notes,
      status: 'new',
      confidence: extracted.confidence,
      rawEmailSubject: subject,
      rawEmailFrom: fromEmail,
    };

    return {
      isLead: true,
      leadData,
      confidence: extracted.confidence,
      reason: 'Lead extracted successfully',
    };
  } catch (error) {
    logger.error('Lead extraction error:', error);
    return {
      isLead: false,
      leadData: {},
      confidence: 0,
      reason: `Extraction error: ${(error as Error).message}`,
    };
  }
};

export default { extractLeadFromEmail };
