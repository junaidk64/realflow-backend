import { Request, Response, NextFunction } from 'express'
import { EmailLog } from '../models/EmailLog'
import { GmailConnection } from '../models/GmailConnection'
import { Settings } from '../models/Settings'
import { SmtpConnection } from '../models/SmtpConnection'
import { generateReplyDraft } from '../services/aiService'
import { classifyEmail, summarizeEmailThread } from '../services/geminiService'
import { sendEmailForUser } from '../services/emailService'
import logger from '../utils/logger'

export const sendEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { userId, to, subject, html, replyTo } = req.body

    if (!userId || !to || !subject || !html) {
      res.status(400).json({
        success: false,
        message: 'userId, to, subject, and html are required',
      })
      return
    }

    const result = await sendEmailForUser(userId, { to, subject, html, replyTo })

    if (!result.success) {
      logger.warn(`Email send failed for user ${userId}: ${result.error}`)
      res.status(422).json({
        success: false,
        error: result.error,
        provider: result.provider,
      })
      return
    }

    // Determine the sender address for the log
    let fromAddress = ''
    if (result.provider === 'gmail') {
      const conn = await GmailConnection.findOne({ userId, isActive: true }).lean()
      fromAddress = conn?.email || ''
    } else if (result.provider === 'smtp') {
      const conn = await SmtpConnection.findOne({ userId, isActive: true }).lean()
      fromAddress = conn?.fromEmail || ''
    }

    await EmailLog.create({
      userId,
      type: 'outgoing',
      from: fromAddress,
      to,
      subject,
      body: '',
      htmlBody: html,
      gmailMessageId: result.messageId || '',
      status: 'sent',
      sentAt: new Date(),
    })

    res.json({
      success: true,
      data: { messageId: result.messageId, provider: result.provider },
    })
  } catch (error) {
    next(error)
  }
}

export const getEmailProviderStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.userId

    const [gmail, smtp] = await Promise.all([
      GmailConnection.findOne({ userId, isActive: true }).select('email watchExpiry lastSyncAt').lean(),
      SmtpConnection.findOne({ userId, isActive: true }).select('fromEmail fromName host port lastTestedAt testError').lean(),
    ])

    res.json({
      success: true,
      data: {
        gmail: gmail
          ? { connected: true, email: gmail.email, watchExpiry: gmail.watchExpiry, lastSyncAt: gmail.lastSyncAt }
          : { connected: false },
        smtp: smtp
          ? { connected: true, fromEmail: smtp.fromEmail, fromName: smtp.fromName, host: smtp.host, port: smtp.port, lastTestedAt: smtp.lastTestedAt, testError: smtp.testError }
          : { connected: false },
        activeProvider: gmail ? 'gmail' : smtp ? 'smtp' : 'none',
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * POST /api/email/draft-reply
 * AI-powered reply draft. Gemini (free) classifies + summarizes, Claude Haiku writes the draft.
 * Body: { emailBody, emailSubject, customerName?, tone? }
 */
export const draftReply = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.userId
    const { emailBody, emailSubject, customerName, tone = 'professional' } = req.body

    if (!emailBody || !emailSubject) {
      res.status(400).json({ success: false, message: 'emailBody and emailSubject are required' })
      return
    }

    // Gemini: classify first — refuse to draft for spam
    const complexity = await classifyEmail(emailSubject, emailBody)
    if (complexity === 'spam') {
      res.status(422).json({ success: false, message: 'Email classified as spam — no draft generated' })
      return
    }

    // Gemini: summarize long/complex threads before Claude sees them
    const processedBody =
      complexity === 'complex' || emailBody.length > 800
        ? await summarizeEmailThread(emailBody)
        : emailBody

    const settings = await Settings.findOne({ userId }).lean()
    const companyName = settings?.businessName || 'Our Team'
    const businessType = settings?.businessType || 'general'

    const result = await generateReplyDraft(
      processedBody,
      emailSubject,
      customerName || null,
      companyName,
      businessType,
      tone,
      userId,
    )

    res.json({
      success: true,
      data: {
        draft: result.draft,
        model: result.model,
        costUsd: result.costUsd,
        complexity,
        summarized: complexity === 'complex' || emailBody.length > 800,
      },
    })
  } catch (error) {
    next(error)
  }
}

export default { sendEmail, getEmailProviderStatus, draftReply }
