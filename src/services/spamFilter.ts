import { BusinessType, LEAD_PROFILES } from '../config/leadProfiles'

// Known lead aggregator/comparison platforms — their noreply addresses carry real
// customer data and must never be treated as spam even though they use noreply@.
const LEAD_AGGREGATOR_DOMAINS = new Set([
	'comparemymove.com',
	'anyvan.com',
	'reallymoving.com',
	'movingiq.co.uk',
	'shiply.com',
	'bark.com',
	'gocompare.com',
	'comparethemarket.com',
	'moneysupermarket.com',
	'confused.com',
	'checkatrade.com',
	'ratedpeople.com',
	'trustatrader.com',
	'mybuilder.com',
	'zoopla.co.uk',
	'rightmove.co.uk',
	'onthemarket.com',
])

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
	// Aggregator domains send lead notifications from noreply@ addresses — never spam
	const fromDomain = emailFrom.split('@')[1]?.toLowerCase() ?? ''
	console.log('this is the from domain : ', fromDomain)

	if (
		LEAD_AGGREGATOR_DOMAINS.has(fromDomain) ||
		[...LEAD_AGGREGATOR_DOMAINS].some((d) => fromDomain.endsWith('.' + d))
	) {
		return false
	}

	const text = `${emailFrom} ${emailBody}`.toLowerCase()

	if (GLOBAL_SPAM_PATTERNS.some((re) => re.test(text))) return true

	const profile = LEAD_PROFILES[businessType]
	if (profile.spamKeywords.some((kw) => text.includes(kw.toLowerCase())))
		return true

	return false
}
