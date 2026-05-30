export interface WorkflowCatalogueItem {
	id?: string
	type: string
	name: string
	description: string
	needsEmailTemplate?: boolean
	backendManaged?: boolean
	defaultConfig?: Record<string, unknown>
	json?: Record<string, unknown> // Optional n8n workflow JSON for auto-importing
}

export const WORKFLOW_CATALOGUE: WorkflowCatalogueItem[] = [
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
	{
		id: 'gmail-trigger',
		name: 'Gmail Lead Trigger',
		description:
			'Receives a webhook when a new lead is extracted, checks the isLead flag, then forwards the lead data to your team notification endpoint.',
		type: 'webhook_lead_trigger',
		json: {
			name: 'Gmail Lead Trigger',
			nodes: [
				{
					parameters: {
						httpMethod: 'POST',
						path: 'gmail-lead',
						responseMode: 'lastNode',
						responseData: 'allEntries',
					},
					id: 'webhook-node',
					name: 'Webhook',
					type: 'n8n-nodes-base.webhook',
					typeVersion: 1,
					position: [250, 300],
				},
				{
					parameters: {
						conditions: {
							boolean: [{ value1: '={{$json["isLead"]}}', value2: true }],
						},
					},
					id: 'if-node',
					name: 'Is Lead?',
					type: 'n8n-nodes-base.if',
					typeVersion: 1,
					position: [450, 300],
				},
			],
			connections: {
				Webhook: { main: [[{ node: 'Is Lead?', type: 'main', index: 0 }]] },
				'Is Lead?': {
					main: [[{ node: 'Notify Team', type: 'main', index: 0 }]],
				},
			},
		},
	},
	{
		id: 'auto-reply',
		name: 'Auto Reply Workflow',
		description:
			"Sends an immediate automated thank-you reply to a new lead via n8n's email node. Fires on webhook — set a webhook URL after installing to activate.",
		type: 'webhook_auto_reply',
		json: {
			name: 'Auto Reply Workflow',
			nodes: [
				{
					parameters: {
						httpMethod: 'POST',
						path: 'auto-reply',
						responseMode: 'lastNode',
					},
					id: 'webhook-node',
					name: 'Webhook',
					type: 'n8n-nodes-base.webhook',
					typeVersion: 1,
					position: [250, 300],
				},
				{
					parameters: {
						fromEmail: '={{$json["fromEmail"]}}',
						toEmail: '={{$json["customerEmail"]}}',
						subject: 'Thank you for your enquiry!',
						text: 'We have received your request and will be in touch shortly.',
					},
					id: 'email-node',
					name: 'Send Email',
					type: 'n8n-nodes-base.emailSend',
					typeVersion: 1,
					position: [450, 300],
				},
			],
			connections: {
				Webhook: { main: [[{ node: 'Send Email', type: 'main', index: 0 }]] },
			},
		},
	},
	{
		id: 'crm-sync',
		name: 'CRM Sync',
		description:
			'Pushes every new lead to your external CRM via HTTP POST. Replace the placeholder CRM URL in the n8n workflow before activating.',
		type: 'crm_sync',
		json: {
			name: 'CRM Sync Workflow',
			nodes: [
				{
					parameters: { httpMethod: 'POST', path: 'crm-sync' },
					id: 'webhook-node',
					name: 'Webhook',
					type: 'n8n-nodes-base.webhook',
					typeVersion: 1,
					position: [250, 300],
				},
				{
					parameters: {
						method: 'POST',
						url: 'https://your-crm.com/api/leads',
						sendBody: true,
						bodyParameters: {
							parameters: [{ name: 'lead', value: '={{$json}}' }],
						},
					},
					id: 'crm-http-node',
					name: 'Push to CRM',
					type: 'n8n-nodes-base.httpRequest',
					typeVersion: 3,
					position: [450, 300],
				},
			],
			connections: {
				Webhook: {
					main: [[{ node: 'Push to CRM', type: 'main', index: 0 }]],
				},
			},
		},
	},
	{
		id: 'slack-notification',
		name: 'Slack Lead Alert',
		description:
			'Posts a formatted Slack alert to your channel via Incoming Webhook whenever a new lead arrives. Replace the placeholder Slack webhook URL in n8n before activating.',
		type: 'slack_notification',
		json: {
			name: 'Slack Lead Alert',
			nodes: [
				{
					parameters: { httpMethod: 'POST', path: 'slack-lead' },
					id: 'webhook-node',
					name: 'Webhook',
					type: 'n8n-nodes-base.webhook',
					typeVersion: 1,
					position: [250, 300],
				},
				{
					parameters: {
						method: 'POST',
						url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
						sendBody: true,
						bodyParameters: {
							parameters: [
								{
									name: 'text',
									value:
										'=🔔 New lead: *{{$json["customerName"]}}* ({{$json["customerEmail"]}}) — {{$json["rawEmailSubject"]}}',
								},
							],
						},
					},
					id: 'slack-node',
					name: 'Slack Message',
					type: 'n8n-nodes-base.httpRequest',
					typeVersion: 3,
					position: [450, 300],
				},
			],
			connections: {
				Webhook: {
					main: [[{ node: 'Slack Message', type: 'main', index: 0 }]],
				},
			},
		},
	},
	{
		id: 'google-sheets-log',
		name: 'Google Sheets Logger',
		description:
			'Appends a new row to a Google Sheet for every lead, capturing name, email, phone, status, AI confidence score, and creation date. Replace YOUR_GOOGLE_SHEET_ID in n8n before activating.',
		type: 'google_sheets',
		json: {
			name: 'Google Sheets Logger',
			nodes: [
				{
					parameters: { httpMethod: 'POST', path: 'sheets-log' },
					id: 'webhook-node',
					name: 'Webhook',
					type: 'n8n-nodes-base.webhook',
					typeVersion: 1,
					position: [250, 300],
				},
				{
					parameters: {
						operation: 'append',
						documentId: 'YOUR_GOOGLE_SHEET_ID',
						sheetName: 'Leads',
						columns: {
							mappingMode: 'defineBelow',
							value: {
								Name: '={{$json["customerName"]}}',
								Email: '={{$json["customerEmail"]}}',
								Phone: '={{$json["customerPhone"]}}',
								Date: '={{$json["movingDate"]}}',
								Status: '={{$json["status"]}}',
								Confidence: '={{$json["confidence"]}}',
								Created: '={{$json["createdAt"]}}',
							},
						},
					},
					id: 'sheets-node',
					name: 'Append to Sheet',
					type: 'n8n-nodes-base.googleSheets',
					typeVersion: 4,
					position: [450, 300],
				},
			],
			connections: {
				Webhook: {
					main: [[{ node: 'Append to Sheet', type: 'main', index: 0 }]],
				},
			},
		},
	},
	{
		id: 'follow-up-sequence',
		name: 'Follow-up Sequence',
		description:
			'Waits 24 hours after initial contact, then sends a personalized follow-up email to re-engage the lead. Designed to run after the auto-reply workflow.',
		type: 'follow_up',
		json: {
			name: 'Follow-up Sequence',
			nodes: [
				{
					parameters: { httpMethod: 'POST', path: 'follow-up' },
					id: 'webhook-node',
					name: 'Webhook',
					type: 'n8n-nodes-base.webhook',
					typeVersion: 1,
					position: [250, 300],
				},
				{
					parameters: { amount: 1, unit: 'days' },
					id: 'wait-node',
					name: 'Wait 24h',
					type: 'n8n-nodes-base.wait',
					typeVersion: 1,
					position: [450, 300],
				},
				{
					parameters: {
						fromEmail: '={{$json["fromEmail"]}}',
						toEmail: '={{$json["customerEmail"]}}',
						subject: 'Following up on your enquiry',
						text: 'Hi {{$json["customerName"]}},\n\nJust following up on your recent enquiry. We would love to help — are you still interested?\n\nBest regards',
					},
					id: 'email-node',
					name: 'Send Follow-up',
					type: 'n8n-nodes-base.emailSend',
					typeVersion: 1,
					position: [650, 300],
				},
			],
			connections: {
				Webhook: { main: [[{ node: 'Wait 24h', type: 'main', index: 0 }]] },
				'Wait 24h': {
					main: [[{ node: 'Send Follow-up', type: 'main', index: 0 }]],
				},
			},
		},
	},
]

// Set of all catalogue types that the backend manages natively (no n8n required)
export const BACKEND_MANAGED_TYPES = new Set(
	WORKFLOW_CATALOGUE.filter((w: any) => w.backendManaged).map((w) => w.type),
)

// Set of all types that can only be installed once per org
export const SINGLETON_TYPES = BACKEND_MANAGED_TYPES

export const getCatalogueItem = (
	type: string,
): WorkflowCatalogueItem | undefined =>
	WORKFLOW_CATALOGUE.find((w) => w.type === type)
