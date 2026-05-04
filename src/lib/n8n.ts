const N8N_BASE_URL = process.env.N8N_BASE_URL
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET

export async function triggerN8nWebhook(event: string, payload: object) {
	try {
		console.log('n8n hited', `${N8N_BASE_URL}/webhook/${event}`, payload)

		await fetch(`${N8N_BASE_URL}/webhook/${event}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Webhook-Secret': N8N_WEBHOOK_SECRET!,
			},
			body: JSON.stringify(payload),
		})
	} catch (err) {
		console.error(`[n8n] Failed to trigger webhook "${event}":`, err)
	}
}
