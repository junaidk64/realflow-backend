import { Request, Response, NextFunction } from 'express'
import { EmailLog } from '../models/EmailLog'
import { GmailConnection } from '../models/GmailConnection'
import { SmtpConnection } from '../models/SmtpConnection'
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

export default { sendEmail, getEmailProviderStatus }
