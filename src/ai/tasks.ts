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

/* ----------------------------- statement import ---------------------------- */

export interface StatementLine {
  date: string
  merchant: string
  amount: number
  currency: string
  type: 'expense' | 'income' | 'transfer' | 'refund'
  categoryId: string
  note?: string
  confidence: number
}

export type StatementSource = { kind: 'image'; dataUrl: string } | { kind: 'pdf'; dataUrl: string } | { kind: 'text'; text: string }

/** Pull transactions out of a statement screenshot, PDF, CSV or pasted text. */
export async function extractStatement(
  source: StatementSource,
  categories: Category[],
  baseCurrency: string,
): Promise<{ lines: StatementLine[]; result: AIResult }> {
  const year = todayISO().slice(0, 4)
  const prompt = `Extract every transaction from this bank or credit card statement.

Today is ${todayISO()}. Base currency: ${baseCurrency}.

Rules:
- amount: positive number in major units (12.50, not 1250).
- type: "expense" for purchases/charges/debits, "refund" for merchant refunds/returns/reversals, "income" for salary or other deposits, "transfer" for card payments, payments received on a credit card, or moves between the person's own accounts.
- date: YYYY-MM-DD. If the statement omits the year, use ${year} unless that would put the date in the future, then use the previous year.
- currency: ISO code shown for that line, else the statement currency, else ${baseCurrency}.
- merchant: a short clean name ("Starbucks", not "STARBUCKS #0423 TORONTO ON").
- categoryId: one of the ids below matching the type (refunds use the expense category of what was refunded).
- confidence: 0-1, how sure you are this line is a real transaction read correctly.
- Skip balances, totals, interest summaries and headers.

Categories:
${categoryList(categories, ['expense', 'income'])}
${categories
  .filter((c) => c.kind === 'transfer')
  .map((c) => `${c.id} = ${c.emoji} ${c.name} (transfer)`)
  .join('\n')}

Return JSON exactly like:
{"lines":[{"date":"${todayISO()}","merchant":"Starbucks","amount":5.25,"currency":"${baseCurrency}","type":"expense","categoryId":"cat_dining","note":"","confidence":0.95}]}${
    source.kind === 'text' ? `\n\nStatement text:\n${source.text.slice(0, 60_000)}` : ''
  }`

  const { data, result } = await aiJson<{ lines?: unknown[] } | unknown[]>(
    {
      prompt,
      system: JSON_SYSTEM,
      images: source.kind === 'image' ? [source.dataUrl] : undefined,
      pdfs: source.kind === 'pdf' ? [source.dataUrl] : undefined,
      maxTokens: 8000,
      temperature: 0,
      timeoutMs: 120_000,
    },
    'statement-import',
  )
  const raw = Array.isArray(data) ? data : Array.isArray(data.lines) ? data.lines : []
  const allowed = new Map(categories.map((c) => [c.id, c.kind]))
  const today = todayISO()
  const lines: StatementLine[] = []
  for (const item of raw) {
    const r = item as Record<string, unknown>
    const amount = Math.abs(Number(r.amount))
    if (!amount || !Number.isFinite(amount)) continue
    const type = r.type === 'income' || r.type === 'transfer' || r.type === 'refund' ? r.type : 'expense'
    let date = /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? String(r.date) : today
    if (date > today) date = `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`
    const cat = String(r.categoryId ?? '')
    const catOk = allowed.get(cat) === (type === 'refund' ? 'expense' : type)
    lines.push({
      date,
      merchant: String(r.merchant || 'Unknown').slice(0, 80),
      amount,
      currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : baseCurrency,
      type,
      categoryId: catOk ? cat : type === 'income' ? 'cat_other-income' : type === 'transfer' ? 'cat_transfer' : 'cat_other',
      note: r.note ? String(r.note).slice(0, 200) : undefined,
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
    })
  }
  return { lines, result }
}

/* --------------------------------- flagIt ---------------------------------- */

const COACH_SYSTEM =
  'You are a frank, practical personal-finance coach. Use only the numbers provided; never invent transactions. You cannot browse the web or check live prices — when something needs checking, say exactly what to check and where. Write concise GitHub-flavoured Markdown.'

export async function flagReview(context: unknown, baseCurrency: string): Promise<{ text: string; result: AIResult }> {
  const result = await callAI({
    task: 'flag-review',
    system: COACH_SYSTEM,
    prompt: `Review this person's recent money activity (amounts in ${baseCurrency} major units unless stated).

${JSON.stringify(context, null, 1)}

Write max 220 words with these sections:
### Flags
Up to 5 bullets: unusual or rising spend, duplicate-looking charges, subscriptions worth reviewing, foreign-currency charges that probably carried FX fees (name them and the likely fee at ~2.5% unless a fee line is visible), budget pressure.
### Save this week
2-3 concrete actions with the amount each would save.
### Investments
1-2 bullets on the holdings summary (concentration, idle cash, fees) — skip if there are no holdings.`,
    maxTokens: 1200,
    temperature: 0.3,
  })
  return { text: result.text, result }
}

export async function habitForecast(context: unknown, baseCurrency: string): Promise<{ text: string; result: AIResult }> {
  const result = await callAI({
    task: 'habit-forecast',
    system: COACH_SYSTEM,
    prompt: `From this spending history (${baseCurrency} major units), predict the next likely discretionary spends and suggest how to head them off.

${JSON.stringify(context, null, 1)}

Max 200 words:
### Likely next
2-4 bullets: what, roughly when (weekday/time of cycle), typical amount — based on the actual patterns above.
### Swap it
For each, one realistic cheaper or healthier alternative and what it saves per month.`,
    maxTokens: 1000,
    temperature: 0.4,
  })
  return { text: result.text, result }
}

export async function preSpendCheck(
  item: { title: string; price: string; url: string; notes: string },
  context: unknown,
  baseCurrency: string,
): Promise<{ text: string; result: AIResult }> {
  const result = await callAI({
    task: 'pre-spend',
    system: COACH_SYSTEM,
    prompt: `The person is thinking about buying: ${JSON.stringify(item)}

Their current position (${baseCurrency} major units), including similar past purchases:
${JSON.stringify(context, null, 1)}

Max 220 words:
### Can you afford it right now?
Compare against safe-to-spend, budgets and upcoming bills. Be specific.
### Before you buy
3-5 bullets: cheaper alternatives or timing (sales cycles, refurbished, older model), card benefits or price-protection worth checking, and what to verify on the retailer page. Say plainly that you can't see live prices.
### Verdict
One line: buy now, wait, or skip — and why.`,
    maxTokens: 1100,
    temperature: 0.4,
  })
  return { text: result.text, result }
}
