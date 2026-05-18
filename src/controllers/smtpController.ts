import { Request, Response, NextFunction } from 'express'
import nodemailer from 'nodemailer'
import { SmtpConnection } from '../models/SmtpConnection'
import { encrypt, decrypt } from '../utils/encryption'
import logger from '../utils/logger'

export const connectSmtp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.userId
    const { fromName, fromEmail, host, port, secure, user, password } = req.body

    if (!fromEmail || !host || !port || !user || !password) {
      res.status(400).json({
        success: false,
        message: 'fromEmail, host, port, user, and password are required',
      })
      return
    }

    // Test the credentials before saving
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Boolean(secure),
      auth: { user, pass: password },
    })

    try {
      await transporter.verify()
    } catch (verifyErr) {
      res.status(422).json({
        success: false,
        message: `SMTP connection test failed: ${(verifyErr as Error).message}`,
      })
      return
    }

    const connection = await SmtpConnection.findOneAndUpdate(
      { userId },
      {
        userId,
        fromName: fromName || '',
        fromEmail: fromEmail.toLowerCase().trim(),
        host,
        port: Number(port),
        secure: Boolean(secure),
        user,
        password: encrypt(password),
        isActive: true,
        lastTestedAt: new Date(),
        testError: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )

    logger.info(`SMTP connected for user ${userId}: ${fromEmail} via ${host}`)

    res.json({
      success: true,
      data: {
        connection: {
          fromEmail: connection.fromEmail,
          fromName: connection.fromName,
          host: connection.host,
          port: connection.port,
          secure: connection.secure,
          isActive: connection.isActive,
          lastTestedAt: connection.lastTestedAt,
        },
      },
    })
  } catch (error) {
    next(error)
  }
}

export const disconnectSmtp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.userId
    await SmtpConnection.findOneAndDelete({ userId })
    logger.info(`SMTP disconnected for user ${userId}`)
    res.json({ success: true, message: 'SMTP connection removed' })
  } catch (error) {
    next(error)
  }
}

export const getSmtpStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.userId
    const connection = await SmtpConnection.findOne({ userId })
      .select('-password')
      .lean()

    if (!connection) {
      res.json({ success: true, data: { connected: false } })
      return
    }

    res.json({
      success: true,
      data: {
        connected: true,
        fromEmail: connection.fromEmail,
        fromName: connection.fromName,
        host: connection.host,
        port: connection.port,
        secure: connection.secure,
        isActive: connection.isActive,
        lastTestedAt: connection.lastTestedAt,
        testError: connection.testError,
      },
    })
  } catch (error) {
    next(error)
  }
}

export const testSmtp = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.user!.userId
    const { sendTo } = req.body

    const connection = await SmtpConnection.findOne({ userId, isActive: true })
    if (!connection) {
      res.status(404).json({ success: false, message: 'No SMTP connection found' })
      return
    }

    const password = decrypt(connection.password)
    const transporter = nodemailer.createTransport({
      host: connection.host,
      port: connection.port,
      secure: connection.secure,
      auth: { user: connection.user, pass: password },
    })

    const testRecipient = sendTo || connection.fromEmail
    const from = connection.fromName
      ? `"${connection.fromName}" <${connection.fromEmail}>`
      : connection.fromEmail

    try {
      await transporter.sendMail({
        from,
        to: testRecipient,
        subject: 'RealFlow SMTP Test',
        html: '<p>Your SMTP connection is working correctly.</p>',
      })

      await SmtpConnection.findByIdAndUpdate(connection._id, {
        lastTestedAt: new Date(),
        testError: null,
      })

      logger.info(`SMTP test passed for user ${userId}`)
      res.json({ success: true, message: `Test email sent to ${testRecipient}` })
    } catch (sendErr) {
      await SmtpConnection.findByIdAndUpdate(connection._id, {
        lastTestedAt: new Date(),
        testError: (sendErr as Error).message,
      })

      res.status(422).json({
        success: false,
        message: `Test email failed: ${(sendErr as Error).message}`,
      })
    }
  } catch (error) {
    next(error)
  }
}

export default { connectSmtp, disconnectSmtp, getSmtpStatus, testSmtp }
