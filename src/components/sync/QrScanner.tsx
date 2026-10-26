import { useEffect, useRef, useState } from 'react'
import { Camera, ImageUp } from 'lucide-react'
import jsQR from 'jsqr'
import { Button, Modal } from '../ui'
import { suspendAutoLock } from '../../lib/lockGuard'
import { pickFile } from '../../lib/utils'

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

function nativeDetector(): BarcodeDetectorLike | null {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  if (!Ctor) return null
  try {
    return new Ctor({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

function decodeCanvas(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null
}

async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not open that image'))
      el.src = url
    })
    const detector = nativeDetector()
    if (detector) {
      const found = await detector.detect(img).catch(() => [])
      if (found[0]?.rawValue) return found[0].rawValue
    }
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return decodeCanvas(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Camera QR scanner. Uses the native BarcodeDetector when available (Chrome on Android) and falls
 * back to jsQR. If the camera can't be opened (no https, permission denied) the user can take a
 * photo of the QR instead, which works everywhere.
 */
export function QrScanner({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const resume = suspendAutoLock(10 * 60_000)
    const canvas = document.createElement('canvas')
    const detector = nativeDetector()

    async function start() {
      setError('')
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('The camera needs a secure (https) connection. Take a photo of the QR instead.')
        return
      }
      setStarting(true)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        })
        if (stopped) return
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        tick()
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow it in your browser settings, or take a photo of the QR.'
            : 'Could not open the camera. Take a photo of the QR instead.',
        )
      } finally {
        setStarting(false)
      }
    }

    async function tick() {
      if (stopped) return
      const video = videoRef.current
      if (video && video.readyState >= 2 && video.videoWidth) {
        let text: string | null = null
        if (detector) {
          const found = await detector.detect(video).catch(() => [])
          text = found[0]?.rawValue ?? null
        } else {
          const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
          canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, 0, 0, canvas.width, canvas.height)
          text = decodeCanvas(canvas)
        }
        if (text && !stopped) {
          stopped = true
          navigator.vibrate?.(40)
          onResult(text)
          return
        }
      }
      raf = window.setTimeout(() => requestAnimationFrame(tick), 120) as unknown as number
    }

    void start()
    return () => {
      stopped = true
      window.clearTimeout(raf)
      stream?.getTracks().forEach((t) => t.stop())
      resume()
    }
  }, [open, onResult])

  async function fromPhoto() {
    const file = await pickFile('image/*', 'environment')
    if (!file) return
    const text = await decodeImageFile(file).catch(() => null)
    if (text) onResult(text)
    else setError('No QR code found in that photo. Try again closer and in focus.')
  }

  return (
    <Modal open={open} onClose={onClose} title="Scan the sync QR" subtitle="Open Settings → Cloud sync on your other device and point the camera at its QR code." size="sm">
      <div className="space-y-3">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-line/70 bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          {starting ? (
            <p className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5 text-[11px] text-white/80">
              <Camera className="h-3.5 w-3.5" /> Starting camera…
            </p>
          ) : null}
        </div>
        {error ? <p className="text-[11px] font-medium text-warn">{error}</p> : null}
        <Button variant="soft" className="w-full" onClick={fromPhoto}>
          <ImageUp className="h-4 w-4" /> Take or choose a photo of the QR
        </Button>
      </div>
    </Modal>
  )
}
