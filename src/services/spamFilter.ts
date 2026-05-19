import { BusinessType, LEAD_PROFILES } from '../config/leadProfiles'

const GLOBAL_SPAM_PATTERNS = [
  /unsubscribe/i,
  /newsletter/i,
  /invoice\s*#\d/i,
  /order\s*confirmation/i,
  /do\s*not\s*reply/i,
  /noreply@/i,
  /no-reply@/i,
  /mailer-daemon/i,
  /delivery\s*failure/i,
  /out\s*of\s*office/i,
  /automatic\s*reply/i,
  /auto-?reply/i,
  /postmaster@/i,
  /bounced?\s*message/i,
]

export function isSpam(
  emailBody: string,
  emailFrom: string,
  businessType: BusinessType,
): boolean {
  const text = `${emailFrom} ${emailBody}`.toLowerCase()

  if (GLOBAL_SPAM_PATTERNS.some((re) => re.test(text))) return true

  const profile = LEAD_PROFILES[businessType]
  if (profile.spamKeywords.some((kw) => text.includes(kw.toLowerCase()))) return true

  return false
}
