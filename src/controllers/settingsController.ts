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

export const testEmailTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { templateOverride } = req.body;

    const sampleLead = {
      customerName: 'John Smith',
      customerEmail: 'john.smith@example.com',
      customerPhone: '07700 900123',
      movingDate: '15th June 2025',
      fromAddress: '123 High Street, London, SW1A 1AA',
      toAddress: '456 New Road, Manchester, M1 1AE',
      services: ['Full Packing', 'Storage'],
      notes: 'Please handle fragile items with extra care.',
    };

    const settings = await Settings.findOne({ userId: req.user!.userId });
    const previewSettings = {
      ...(settings?.toObject() || {}),
      ...(templateOverride ? { autoReplyTemplate: templateOverride } : {}),
    };

    const html = generateAutoReplyHTML(sampleLead, previewSettings);
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
