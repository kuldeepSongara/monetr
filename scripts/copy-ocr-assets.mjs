// Copies the on-device OCR engine (tesseract.js worker, WASM core, English data) into public/ocr so
// the app serves it itself — no CDN dependency, and it keeps working offline once cached.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const out = join(process.cwd(), 'public', 'ocr')
const tess = dirname(require.resolve('tesseract.js/package.json'))
const core = dirname(require.resolve('tesseract.js-core/package.json'))
const lang = dirname(require.resolve('@tesseract.js-data/eng/package.json'))

const files = [
  [join(tess, 'dist', 'worker.min.js'), join(out, 'worker.min.js')],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'].map((f) => [join(core, f), join(out, 'core', f)]),
  // Compact LSTM model (~3 MB) — plenty for printed bank/card screenshots.
  [join(lang, '4.0.0_best_int', 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz')],
]
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`OCR asset missing: ${from}`)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}
console.log(`OCR assets copied to ${out}`)
