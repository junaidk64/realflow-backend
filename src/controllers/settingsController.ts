import { Request, Response, NextFunction } from 'express';
import { Settings } from '../models/Settings';
import { generateAutoReplyHTML } from '../services/emailService';
import logger from '../utils/logger';

export const getSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    let settings = await Settings.findOne({ userId: req.user!.userId });
    if (!settings) {
      settings = await Settings.create({ userId: req.user!.userId });
    }
    res.json({ success: true, data: { settings } });
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { autoReply, autoReplyTemplate, autoReplySubject, n8nWebhookUrl, emailSignature, notifications, minimumConfidence, businessType, businessName } = req.body;

    const updateData: Record<string, unknown> = {};
    if (autoReply !== undefined) updateData.autoReply = autoReply;
    if (autoReplyTemplate !== undefined) updateData.autoReplyTemplate = autoReplyTemplate;
    if (autoReplySubject !== undefined) updateData.autoReplySubject = autoReplySubject;
    if (n8nWebhookUrl !== undefined) updateData.n8nWebhookUrl = n8nWebhookUrl;
    if (emailSignature !== undefined) updateData.emailSignature = emailSignature;
    if (notifications !== undefined) updateData.notifications = notifications;
    if (minimumConfidence !== undefined) updateData.minimumConfidence = minimumConfidence;
    if (businessType !== undefined) updateData.businessType = businessType;
    if (businessName !== undefined) updateData.businessName = businessName;

    const settings = await Settings.findOneAndUpdate(
      { userId: req.user!.userId },
      { $set: updateData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, data: { settings } });
  } catch (error) {
    next(error);
  }
};

const SAMPLE_LEADS: Record<string, Record<string, unknown>> = {
  moving: {
    customerName: 'John Smith', customerEmail: 'john@example.com', customerPhone: '07700 900123',
    fromAddress: '123 High Street, London, SW1A 1AA', toAddress: '456 Oak Avenue, Manchester, M1 1AE',
    movingDate: '15 June 2026', services: ['Full Packing', 'Storage'],
    businessType: 'moving',
  },
  real_estate: {
    customerName: 'Sarah Johnson', customerEmail: 'sarah@example.com', customerPhone: '07700 900456',
    businessType: 'real_estate',
    extraFields: { propertyAddress: '14 Oak Lane, Bristol, BS1 2AB', budget: '£350,000–£400,000', viewingDate: 'Saturday 22 June', bedrooms: '3' },
  },
  insurance: {
    customerName: 'Mike Davies', customerEmail: 'mike@example.com', customerPhone: '07700 900789',
    businessType: 'insurance',
    extraFields: { policyType: 'Car Insurance', coverageAmount: '£30,000', renewalDate: 'August 2026', currentProvider: 'Admiral' },
  },
  cleaning: {
    customerName: 'Emma Wilson', customerEmail: 'emma@example.com', customerPhone: '07700 900321',
    businessType: 'cleaning',
    extraFields: { serviceDate: '25 June 2026', propertyType: 'End of tenancy', rooms: '4', frequency: 'One-off' },
  },
  legal: {
    customerName: 'Robert Chen', customerEmail: 'robert@example.com', customerPhone: '07700 900654',
    businessType: 'legal',
    extraFields: { caseType: 'Conveyancing', urgency: 'Medium', consultationDate: 'Next week' },
  },
  general: {
    customerName: 'Alex Turner', customerEmail: 'alex@example.com', customerPhone: '07700 900987',
    businessType: 'general',
    extraFields: { serviceRequired: 'General enquiry', preferredDate: 'This week', budget: '£500' },
  },
};

export const testEmailTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { templateOverride } = req.body;

    const settings = await Settings.findOne({ userId: req.user!.userId });
    const businessType = settings?.businessType || 'general';
    const sampleLead = SAMPLE_LEADS[businessType] || SAMPLE_LEADS.general;

    const previewSettings = {
      ...(settings?.toObject() || {}),
      ...(templateOverride ? { autoReplyTemplate: templateOverride } : {}),
    };

    const html = generateAutoReplyHTML(sampleLead as never, previewSettings);
    res.json({ success: true, data: { html } });
  } catch (error) {
    next(error);
  }
};

export const updateEmailSignature = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { signature } = req.body;

    const settings = await Settings.findOneAndUpdate(
      { userId: req.user!.userId },
      { emailSignature: signature },
      { new: true, upsert: true }
    );

    res.json({ success: true, data: { settings } });
  } catch (error) {
    next(error);
  }
};

export default { getSettings, updateSettings, testEmailTemplate, updateEmailSignature };
