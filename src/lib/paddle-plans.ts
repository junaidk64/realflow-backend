import dotenv from 'dotenv'
dotenv.config()
export const PADDLE_PLANS = {
	essentials: {
		monthlyPriceId: process.env.PADDLE_ESSENTIALS_MONTHLY_PRICE_ID!,
		yearlyPriceId: process.env.PADDLE_ESSENTIALS_YEARLY_PRICE_ID!,
		name: 'Essentials',
		internalPlan: 'starter' as const,
		price: { monthly: 9, yearly: 99 },
		limits: { leads: 100, agents: 1 },
		features: [
			'Up to 100 leads',
			'1 agent seat',
			'New Lead Follow-Up automation',
			'Lead & listing management',
			'Basic analytics',
		],
	},
	professional: {
		monthlyPriceId: process.env.PADDLE_PRO_MONTHLY_PRICE_ID!,
		yearlyPriceId: process.env.PADDLE_PRO_YEARLY_PRICE_ID!,
		name: 'Professional',
		internalPlan: 'pro' as const,
		price: { monthly: 19, yearly: 190 },
		limits: { leads: Infinity, agents: 1 },
		features: [
			'Unlimited leads',
			'1 agent seat',
			'All Essentials features',
			'Appointment Reminder automation',
			'Listing Published Alert automation',
			'Advanced analytics',
		],
	},
	elite: {
		monthlyPriceId: process.env.PADDLE_ELITE_MONTHLY_PRICE_ID!,
		yearlyPriceId: process.env.PADDLE_ELITE_YEARLY_PRICE_ID!,
		name: 'Elite',
		internalPlan: 'brokerage' as const,
		price: { monthly: 29, yearly: 290 },
		limits: { leads: Infinity, agents: 10 },
		features: [
			'Unlimited leads',
			'Up to 10 agent seats',
			'All Professional features',
			'Monthly Performance Report automation',
			'Agent performance analytics',
			'Priority support',
		],
	},
}

export type PaddlePlanKey = keyof typeof PADDLE_PLANS
export type InternalPlan = 'trial' | 'starter' | 'pro' | 'brokerage'

// Plan hierarchy — higher rank = more access
export const PLAN_RANK: Record<string, number> = {
	trial: 0,
	starter: 1,
	pro: 2,
	brokerage: 3,
}

// Resolve a Paddle price ID to the internal plan name (starter/pro/brokerage)
export function getPlanFromPriceId(priceId: string): InternalPlan {
	const {
		PADDLE_ESSENTIALS_MONTHLY_PRICE_ID,
		PADDLE_ESSENTIALS_YEARLY_PRICE_ID,
		PADDLE_PRO_MONTHLY_PRICE_ID,
		PADDLE_PRO_YEARLY_PRICE_ID,
		PADDLE_ELITE_MONTHLY_PRICE_ID,
		PADDLE_ELITE_YEARLY_PRICE_ID,
	} = process.env

	if (
		priceId === PADDLE_ESSENTIALS_MONTHLY_PRICE_ID ||
		priceId === PADDLE_ESSENTIALS_YEARLY_PRICE_ID
	)
		return 'starter'
	if (
		priceId === PADDLE_PRO_MONTHLY_PRICE_ID ||
		priceId === PADDLE_PRO_YEARLY_PRICE_ID
	)
		return 'pro'
	if (
		priceId === PADDLE_ELITE_MONTHLY_PRICE_ID ||
		priceId === PADDLE_ELITE_YEARLY_PRICE_ID
	)
		return 'brokerage'
	return 'trial'
}

// The 4 platform-seeded workflows. Users can only enable/disable these;
// they cannot create custom automations.
export const SEEDED_WORKFLOWS = [
	{
		workflowKey: 'wf-001',
		n8nWorkflowId: '3vG02RJ05rmaGSpO',
		name: 'New Lead Follow-Up Sequence',
		description:
			'Automatically sends a follow-up email and SMS when a new lead is created.',
		trigger: 'lead-created' as const,
		requiredPlan: 'trial' as const, // all plans including trial
	},
	{
		workflowKey: 'wf-002',
		n8nWorkflowId: 'realflow-wf-002',
		name: 'Appointment Reminder',
		description:
			'Sends automated reminders to leads 24 hours before a scheduled appointment.',
		trigger: 'appointment-set' as const,
		requiredPlan: 'pro' as const,
	},
	{
		workflowKey: 'wf-003',
		n8nWorkflowId: 'realflow-wf-003',
		name: 'Listing Published Alert',
		description:
			'Notifies matched leads when a new property listing goes live.',
		trigger: 'listing-published' as const,
		requiredPlan: 'pro' as const,
	},
	{
		workflowKey: 'wf-004',
		n8nWorkflowId: 'realflow-wf-004',
		name: 'Monthly Performance Report',
		description:
			'Generates and emails a monthly performance summary for your agency.',
		trigger: 'manual' as const,
		requiredPlan: 'brokerage' as const,
	},
] as const

export type WorkflowKey = (typeof SEEDED_WORKFLOWS)[number]['workflowKey']

/** Returns true when the user's plan meets the workflow's minimum requirement. */
export function canEnableWorkflow(
	userPlan: string,
	workflowKey: string,
): boolean {
	const wf = SEEDED_WORKFLOWS.find((w) => w.workflowKey === workflowKey)
	if (!wf) return false
	return (PLAN_RANK[userPlan] ?? -1) >= (PLAN_RANK[wf.requiredPlan] ?? 99)
}

/** Legacy helper kept for existing callers. */
export function getAllowedWorkflows(plan: string): string[] {
	return SEEDED_WORKFLOWS.filter((wf) =>
		canEnableWorkflow(plan, wf.workflowKey),
	).map((wf) => wf.n8nWorkflowId)
}
