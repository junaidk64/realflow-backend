export const PADDLE_PLANS = {
	starter: {
		priceId: process.env.PADDLE_STARTER_PRICE_ID!,
		name: 'Starter',
		limits: { leads: 100, agents: 1 },
	},
	pro: {
		priceId: process.env.PADDLE_PRO_PRICE_ID!,
		name: 'Pro',
		limits: { leads: Infinity, agents: 1 },
	},
	brokerage: {
		priceId: process.env.PADDLE_BROKERAGE_PRICE_ID!,
		name: 'Brokerage',
		limits: { leads: Infinity, agents: 10 },
	},
}

// Plan hierarchy — higher rank = more access
export const PLAN_RANK: Record<string, number> = {
	trial: 0,
	starter: 1,
	pro: 2,
	brokerage: 3,
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
