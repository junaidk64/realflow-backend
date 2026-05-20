import cron from 'node-cron'
import { User } from '../models/User'
import { Lead } from '../models/Lead'
import { Settings } from '../models/Settings'
import { Workflow } from '../models/Workflow'
import { sendEmailForUser } from '../services/emailService'
import { generateDigestSummary } from '../services/aiService'
import logger from '../utils/logger'

let digestJob: cron.ScheduledTask | null = null

export const startDailyDigestJob = (): void => {
  // Runs every day at 7 AM
  digestJob = cron.schedule('0 7 * * *', async () => {
    logger.info('Running daily digest job...')

    try {
      const settings = await Settings.find({ 'notifications.dailySummary': true }).lean()

      for (const s of settings) {
        try {
          // daily_digest workflow must be installed AND active — strict gate
          const orgId = s.organizationId ?? null
          const digestWorkflow = orgId
            ? await Workflow.findOne({ organizationId: orgId, type: 'daily_digest' })
            : await Workflow.findOne({ userId: s.userId, type: 'daily_digest' })
          if (!digestWorkflow || !digestWorkflow.isActive) {
            logger.debug(`Daily digest skipped for user ${s.userId} — workflow not installed or disabled`)
            continue
          }
          const yesterday = new Date(Date.now() - 86_400_000)
          const leads = await Lead.find({
            userId: s.userId,
            createdAt: { $gte: yesterday },
          }).lean()

          if (leads.length === 0) continue

          const hot = leads.filter((l) => ((l as { aiScore?: number }).aiScore ?? 0) >= 7).length
          const cold = leads.filter((l) => ((l as { aiScore?: number }).aiScore ?? 10) < 4).length
          const businessType = s.businessType || 'general'

          const summary = await generateDigestSummary(leads.length, hot, cold, businessType)

          const user = await User.findById(s.userId).lean()
          if (!user) continue

          const toEmail = s.notifications?.emailAddress || (user as { email?: string }).email || ''
          if (!toEmail) continue

          await sendEmailForUser(String(s.userId), {
            to: toEmail,
            subject: `Your daily lead digest — ${leads.length} new lead${leads.length !== 1 ? 's' : ''}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;">
<h2 style="color:#333;">Good morning!</h2>
<p style="color:#555;line-height:1.6;">${summary}</p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
<p style="color:#888;font-size:13px;">
  ${leads.length} leads received yesterday &bull; ${hot} hot &bull; ${cold} cold
</p>
<a href="${process.env.FRONTEND_URL}/leads" style="display:inline-block;margin-top:16px;background:#667eea;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;">
  View leads →
</a>
</div>`,
          })

          logger.info(`Daily digest sent to ${toEmail} for user ${s.userId}`)
        } catch (err) {
          logger.error(`Digest failed for user ${s.userId}:`, err)
        }
      }
    } catch (err) {
      logger.error('Daily digest job error:', err)
    }
  })

  logger.info('Daily digest cron started (daily at 7 AM)')
}

export const stopDailyDigestJob = (): void => {
  if (digestJob) {
    digestJob.stop()
    digestJob = null
  }
}
