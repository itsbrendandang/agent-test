import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/fonts'
import './design/index.css'
import './design/theme.css'
import './design/display.css'
import { startAppearance } from './lib/appearance'
import Dashboard from './Dashboard'

startAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
)
