// Generates the PWA icons without any image dependencies.
// Run: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public')
mkdirSync(outDir, { recursive: true })

const SS = 4 // supersampling factor

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function insideRoundRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = Math.min(Math.max(x, left + radius), right - radius)
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius + 1e-6
}

function insideCapsule(x, y, cx, top, bottom, radius) {
  const cy = Math.min(Math.max(y, top + radius), bottom - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius + 1e-6
}

/** Draw the Monetr mark at `size` px. `maskable` fills the square. */
function draw(size, { maskable = false } = {}) {
  const S = size
  const inner = maskable ? S * 0.78 : S
  const pad = (S - inner) / 2
  const radius = maskable ? 0 : S * 0.225
  const out = Buffer.alloc(S * S * 4)
  const bars = [
    { h: 0.34, a: 0.72 },
    { h: 0.52, a: 0.88 },
    { h: 0.7, a: 1 },
  ]
  const barW = inner * 0.115
  const gap = inner * 0.06
  const totalW = barW * 3 + gap * 2
  const startX = pad + (inner - totalW) / 2
  const baseline = pad + inner * 0.77

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          if (!insideRoundRect(px, py, pad, pad, pad + inner, pad + inner, radius)) continue

          // Diagonal gradient: #8B6BFF → #5537E0
          const t = Math.min(1, Math.max(0, (px - pad + (py - pad)) / (inner * 2)))
          let cr = Math.round(0x8b + (0x55 - 0x8b) * t)
          let cg = Math.round(0x6b + (0x37 - 0x6b) * t)
          let cb = Math.round(0xff + (0xe0 - 0xff) * t)
          let ca = 255

          for (let i = 0; i < bars.length; i++) {
            const cx = startX + i * (barW + gap) + barW / 2
            const top = baseline - inner * bars[i].h
            if (insideCapsule(px, py, cx, top, baseline, barW / 2)) {
              const alpha = bars[i].a
              cr = Math.round(cr * (1 - alpha) + 255 * alpha)
              cg = Math.round(cg * (1 - alpha) + 255 * alpha)
              cb = Math.round(cb * (1 - alpha) + 255 * alpha)
            }
          }

          r += cr
          g += cg
          b += cb
          a += ca
        }
      }

      const n = SS * SS
      const idx = (y * S + x) * 4
      out[idx] = Math.round(r / n)
      out[idx + 1] = Math.round(g / n)
      out[idx + 2] = Math.round(b / n)
      out[idx + 3] = Math.round(a / n)
    }
  }
  return out
}

const files = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: true },
]

for (const file of files) {
  const rgba = draw(file.size, { maskable: file.maskable })
  const png = encodePng(file.size, file.size, rgba)
  writeFileSync(resolve(outDir, file.name), png)
  console.log(`wrote public/${file.name} (${file.size}×${file.size}, ${(png.length / 1024).toFixed(1)} KB)`)
}
