/**
 * On-device text recognition (tesseract.js) for screenshots, so a text-only AI profile (Cerebras,
 * DeepSeek, Groq's default model…) can still turn a screenshot into transactions: the text is read
 * here, then only text goes to the AI. The engine is served by Monetr itself from /ocr (copied at
 * build by scripts/copy-ocr-assets.mjs) and loaded the first time it's needed.
 */
function assetUrl(path: string): string {
  return new URL(`ocr/${path}`, `${location.origin}${location.pathname}`).href
}

export async function ocrImage(dataUrl: string, signal?: AbortSignal): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  let worker: Awaited<ReturnType<typeof createWorker>>
  try {
    worker = await createWorker('eng', 1, {
      workerPath: assetUrl('worker.min.js'),
      corePath: assetUrl('core/'),
      langPath: assetUrl('lang'),
      gzip: true,
    })
  } catch (err) {
    throw new Error(`On-device text reading couldn't start (${err instanceof Error ? err.message : 'engine failed to load'}).`)
  }
  const stop = () => void worker.terminate()
  signal?.addEventListener('abort', stop)
  try {
    const { data } = await worker.recognize(dataUrl)
    if (signal?.aborted) throw new Error('Cancelled')
    return data.text
      .split('\n')
      .map((l) => l.replace(/\s{2,}/g, '  ').trim())
      .filter(Boolean)
      .join('\n')
  } finally {
    signal?.removeEventListener('abort', stop)
    await worker.terminate().catch(() => undefined)
  }
}
