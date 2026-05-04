import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

// const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash']

const configuredModel = process.env.GEMINI_MODEL?.trim()

// export const activeGeminiModels = [configuredModel, ...FALLBACK_MODELS].filter(
// 	(model, idx, arr): model is string =>
// 		Boolean(model) && arr.indexOf(model) === idx,

// )

function isNotFoundModelError(err: unknown) {
	if (!err || typeof err !== 'object') return false
	const maybeErr = err as {
		status?: number
		statusText?: string
		message?: string
	}

	return (
		maybeErr.status === 404 ||
		(maybeErr.statusText ?? '').toLowerCase().includes('not found') ||
		(maybeErr.message ?? '').toLowerCase().includes('not found')
	)
}

export async function generateGeminiContent(prompt: string) {
	console.log(process.env.GEMINI_API_KEY)
	// compress the prompt if it's too long for the model (over 15k tokens for Gemini-2.0-flash)

	let lastError: unknown

	const model = configuredModel ?? 'gemini-2.0-flash'
	try {
		const geminiModel = genAI.getGenerativeModel({ model })
		const result = await geminiModel.generateContent(prompt)
		return { result, model }
	} catch (err) {
		lastError = err
		throw lastError
		// if (!isNotFoundModelError(err)) throw err
	}
}
