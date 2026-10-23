import type { Category, SubscriptionCandidate } from '../types'
import type { SpendContext } from './aiContext'
import { extractJson } from '../lib/utils'
import { todayISO } from '../lib/dates'
import { callAI, type AICallOptions, type AIResult } from './client'
import { minorFactor } from '../lib/money'

export interface QuickAddDraft {
  type: 'expense' | 'income'
  amount: number
  currency?: string
  date: string
  merchant: string
  categoryId: string
  note?: string
}

export interface CategorizeOutput {
  assignments: { id: string; categoryId: string }[]
  result: AIResult
}

export interface ReceiptDraft {
  merchant: string
  total: number
  currency?: string
  date: string
  categoryId: string
  items: { name: string; amount: number }[]
}

export interface SubscriptionAuditOutput {
  items: { id: string; verdict: 'keep' | 'review' | 'cancel'; reason: string }[]
  result: AIResult
}

const JSON_SYSTEM =
  'You output only a single valid JSON object. No markdown, no code fences, no commentary. Use exactly the requested keys and value types.'

async function aiJson<T>(opts: Omit<AICallOptions, 'task'>, task: string): Promise<{ data: T; result: AIResult }> {
  const result = await callAI({ ...opts, task, json: true })
  let data = extractJson<T>(result.text)
  if (data === null) {
    const repair = await callAI({
      task: `${task}-repair`,
      system: JSON_SYSTEM,
      prompt: `Rewrite the following into one valid JSON object with the same meaning. Output JSON only.\n\n${result.text.slice(0, 6000)}`,
      json: true,
      maxTokens: 2000,
    })
    data = extractJson<T>(repair.text)
  }
  if (data === null) {
    throw new Error('The model did not return usable JSON. Try again or switch to another AI profile.')
  }
  return { data, result }
}

function categoryList(categories: Category[], kinds: ('expense' | 'income')[] = ['expense', 'income']): string {
  return categories
    .filter((c) => !c.archived && kinds.includes(c.kind as 'expense' | 'income'))
    .map((c) => `${c.id} = ${c.emoji} ${c.name}`)
    .join('\n')
}

/* -------------------------------- quick add -------------------------------- */

export async function parseQuickAdd(
  text: string,
  categories: Category[],
  baseCurrency: string,
): Promise<{ draft: QuickAddDraft; result: AIResult }> {
  const prompt = `Today is ${todayISO()}. Base currency: ${baseCurrency}.

Parse this into ONE personal finance transaction:
"${text}"

Rules:
- amount is a positive number in major currency units (e.g. 4.50, not 450).
- date must be YYYY-MM-DD. Resolve words like "yesterday" against today. Default to today if no date.
- type is "income" only if it is clearly money coming in.
- categoryId MUST be one of the ids listed below (pick the closest).
- currency: use the base currency unless the text names another one.
- merchant: short human name, e.g. "Blue Bottle", not "spent 4.50 at blue bottle".
- note: optional short extra detail, or "".

Categories:
${categoryList(categories)}

Return JSON exactly like:
{"type":"expense","amount":4.5,"currency":"${baseCurrency}","date":"${todayISO()}","merchant":"Blue Bottle","categoryId":"cat_dining","note":""}`

  const { data, result } = await aiJson<QuickAddDraft>({ prompt, system: JSON_SYSTEM, maxTokens: 400 }, 'quick-add')
  const allowed = new Set(categories.map((c) => c.id))
  const draft: QuickAddDraft = {
    type: data.type === 'income' ? 'income' : 'expense',
    amount: Math.abs(Number(data.amount) || 0),
    currency: typeof data.currency === 'string' && data.currency.length <= 5 ? data.currency : baseCurrency,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(data.date)) ? String(data.date) : todayISO(),
    merchant: String(data.merchant || text).slice(0, 80),
    categoryId: allowed.has(data.categoryId) ? data.categoryId : 'cat_other',
    note: data.note ? String(data.note).slice(0, 200) : undefined,
  }
  if (!draft.amount || !Number.isFinite(draft.amount)) {
    throw new Error('Could not find an amount in that text.')
  }
  return { draft, result }
}

/* -------------------------------- categorize ------------------------------- */

export async function categorizeTransactions(
  txns: { id: string; merchant: string; note?: string; amount: number; type: string }[],
  categories: Category[],
  baseCurrency: string,
): Promise<CategorizeOutput> {
  const prompt = `Categorise these personal finance transactions. Base currency: ${baseCurrency}.

Categories (id = name):
${categoryList(categories)}

Transactions:
${JSON.stringify(txns, null, 1)}

For every transaction id, choose exactly one category id whose kind matches the transaction type (expense → expense category, income → income category). Use cat_other / cat_other-income when unsure.

Return JSON exactly like:
{"assignments":[{"id":"t_123","categoryId":"cat_groceries"}]}`

  const { data, result } = await aiJson<{ assignments: { id: string; categoryId: string }[] }>(
    { prompt, system: JSON_SYSTEM, maxTokens: 1500 },
    'categorize',
  )
  const allowed = new Set(categories.map((c) => c.id))
  const wanted = new Set(txns.map((t) => t.id))
  const assignments = (Array.isArray(data.assignments) ? data.assignments : [])
    .filter((a) => a && typeof a.id === 'string' && allowed.has(a.categoryId) && wanted.has(a.id))
    .map((a) => ({ id: a.id, categoryId: a.categoryId }))
  return { assignments, result }
}

/* ---------------------------------- digest --------------------------------- */

export async function generateDigest(context: SpendContext): Promise<{ text: string; result: AIResult }> {
  const prompt = `Here is a snapshot of someone's personal spending. All money values are ${context.baseCurrency} major units and are already computed — do not recalculate or invent numbers.

${JSON.stringify(context, null, 1)}

Write a spending digest in GitHub-flavoured Markdown, maximum 170 words, with exactly these sections:

### Where you stand
1-2 sentences on this period vs last period, and the single biggest category.

### Watch this
2-4 short bullets: notable increases, budget pressure, anomalies, or subscription creep. Reference actual numbers.

### Next 7 days
1-2 bullets: bills due, safe-to-spend, or one concrete action.

Be direct and warm. No preamble, no closing offer of help, no "as an AI".`

  const result = await callAI({
    task: 'digest',
    system:
      'You are a sharp, concise personal finance analyst. You use only the numbers provided. You never invent transactions or amounts. You write in Markdown.',
    prompt,
    maxTokens: 900,
    temperature: 0.4,
  })
  return { text: result.text, result }
}

/* ----------------------------------- ask ----------------------------------- */

export async function askAboutSpending(question: string, context: SpendContext): Promise<{ text: string; result: AIResult }> {
  const prompt = `The user asks: "${question}"

Their spending snapshot (all money in ${context.baseCurrency} major units, already computed):
${JSON.stringify(context, null, 1)}

Answer in at most 120 words of GitHub-flavoured Markdown. Use the real numbers above. If the data does not contain the answer, say what is missing instead of guessing.`

  const result = await callAI({
    task: 'ask',
    system: 'You are a helpful, precise personal finance assistant. Never invent numbers. Answer only from the supplied data.',
    prompt,
    maxTokens: 500,
    temperature: 0.3,
  })
  return { text: result.text, result }
}

/* ------------------------------ subscriptions ------------------------------ */

export async function auditSubscriptions(
  candidates: SubscriptionCandidate[],
  baseCurrency: string,
): Promise<SubscriptionAuditOutput> {
  const unit = minorFactor(baseCurrency)
  const payload = candidates.map((c) => ({
    id: c.id,
    merchant: c.merchant,
    charges: c.occurrences,
    avgCharge: Math.round((c.avgAmount / unit) * 100) / 100,
    monthlyCost: Math.round((c.monthlyAmount / unit) * 100) / 100,
    lastCharge: c.lastDate,
    daysBetweenCharges: c.intervalDays,
    priceChangePct: Math.round(c.priceChangePct),
  }))

  const prompt = `Review these recurring charges for waste. Money is ${baseCurrency}.

${JSON.stringify(payload, null, 1)}

For each id, give a verdict:
- "cancel" — looks unused, duplicated, or clearly not worth it (e.g. duplicate streaming, dead gym, overlapping tools).
- "review" — price went up, rare use, or worth renegotiating. Use this when unsure rather than guessing.
- "keep" — normal essential spend.
Reason: max 18 words, concrete, mention the monthly cost or price change when relevant.

Return JSON exactly:
{"items":[{"id":"sub-...","verdict":"review","reason":"Price rose 20% but usage unknown."}]}`

  const { data, result } = await aiJson<{ items: { id: string; verdict: string; reason: string }[] }>(
    {
      prompt,
      system: JSON_SYSTEM,
      maxTokens: 1200,
      temperature: 0.2,
    },
    'subscriptions',
  )
  const ids = new Set(candidates.map((c) => c.id))
  const items = (Array.isArray(data.items) ? data.items : [])
    .filter((i) => ids.has(i.id))
    .map((i) => ({
      id: i.id,
      verdict: (['keep', 'review', 'cancel'].includes(i.verdict) ? i.verdict : 'review') as 'keep' | 'review' | 'cancel',
      reason: String(i.reason || '').slice(0, 200),
    }))
  return { items, result }
}

/* --------------------------------- receipt --------------------------------- */

export async function scanReceipt(
  imageDataUrl: string,
  categories: Category[],
  baseCurrency: string,
): Promise<{ draft: ReceiptDraft; result: AIResult }> {
  const prompt = `Extract the purchase from this receipt photo.

Today is ${todayISO()}. Base currency: ${baseCurrency}.

Rules:
- total: the final amount paid, positive, major units (not cents).
- currency: ISO code if visible, else ${baseCurrency}.
- date: YYYY-MM-DD if visible, else ${todayISO()}.
- merchant: the store name only.
- categoryId must be one of the ids below.
- items: up to 12 line items with name and amount in major units. Empty array if unreadable.

Categories:
${categoryList(categories, ['expense'])}

Return JSON:
{"merchant":"Store","total":23.4,"currency":"${baseCurrency}","date":"${todayISO()}","categoryId":"cat_groceries","items":[{"name":"Milk","amount":3.2}]}`

  const { data, result } = await aiJson<ReceiptDraft>(
    {
      prompt,
      system: JSON_SYSTEM,
      images: [imageDataUrl],
      maxTokens: 1200,
      temperature: 0,
    },
    'receipt',
  )

  const allowed = new Set(categories.map((c) => c.id))
  const total = Math.abs(Number(data.total) || 0)
  if (!total) throw new Error('Could not read a total from that receipt. Try a clearer photo.')
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.date)) ? String(data.date) : todayISO()
  return {
    draft: {
      merchant: String(data.merchant || 'Receipt').slice(0, 80),
      total,
      currency: typeof data.currency === 'string' && data.currency.length <= 5 ? data.currency : baseCurrency,
      date,
      categoryId: allowed.has(data.categoryId) ? data.categoryId : 'cat_other',
      items: Array.isArray(data.items)
        ? data.items.slice(0, 12).map((i) => ({ name: String(i.name || 'Item').slice(0, 60), amount: Math.abs(Number(i.amount) || 0) }))
        : [],
    },
    result,
  }
}
