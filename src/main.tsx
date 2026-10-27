import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource-variable/geist'
import './index.css'
import { capturePendingLink } from './lib/sync'

// A scanned sync QR opens `#/link?code=…`; stash it before the router sees the URL.
capturePendingLink()

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn('Service worker registration failed', err))
  })
}
