export interface WorkflowCatalogueItem {
	type: string
	name: string
	description: string
	needsEmailTemplate: boolean
	backendManaged: boolean
	defaultConfig: Record<string, unknown>
}

export const WORKFLOW_CATALOGUE: WorkflowCatalogueItem[] = [
	{
		type: 'lead_extraction',
		name: 'Lead Extraction',
		description:
			'Automatically extract and score lead information from incoming emails using AI. This is the core pipeline — install and enable this first.',
		needsEmailTemplate: false,
		backendManaged: true,
		defaultConfig: {},
	},
	{
		type: 'auto_reply',
		name: 'Auto Reply',
		description:
			'Send a personalised automatic reply to every new lead using your selected email template. Requires a template to be assigned before activation.',
		needsEmailTemplate: true,
		backendManaged: true,
		defaultConfig: { templateId: null, subject: null, fallbackToGlobal: false },
	},
	{
		type: 'notification',
		name: 'Notifications',
		description:
			'Receive real-time in-app notifications whenever a new lead is detected.',
		needsEmailTemplate: false,
		backendManaged: true,
		defaultConfig: {},
	},
	{
		type: 'spam_filtering',
		name: 'Spam Filtering',
		description:
			'Automatically filter out spam and irrelevant emails before lead extraction runs, keeping your lead list clean.',
		needsEmailTemplate: false,
		backendManaged: true,
		defaultConfig: {},
	},
	{
		type: 'daily_digest',
		name: 'Daily Digest',
		description:
			'Receive a daily email summary of your new leads every morning at 7 AM.',
		needsEmailTemplate: false,
		backendManaged: true,
		defaultConfig: {},
	},
]

// Set of all catalogue types that the backend manages natively (no n8n required)
export const BACKEND_MANAGED_TYPES = new Set(
	WORKFLOW_CATALOGUE.filter((w) => w.backendManaged).map((w) => w.type),
)

// Set of all types that can only be installed once per org
export const SINGLETON_TYPES = BACKEND_MANAGED_TYPES

export const getCatalogueItem = (type: string): WorkflowCatalogueItem | undefined =>
	WORKFLOW_CATALOGUE.find((w) => w.type === type)
