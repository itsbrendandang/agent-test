import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// The desktop overlay window loads the same bundle with ?crew=1.
const overlay = new URLSearchParams(window.location.search).has('crew')
if (overlay) document.documentElement.classList.add('overlay')

// Each window loads only its own code: the overlay never pulls in the dashboard.
const Root = overlay
  ? lazy(() => import('./crew/CrewOverlay').then((m) => ({ default: m.CrewOverlay })))
  : lazy(() => import('./Dashboard'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
)
