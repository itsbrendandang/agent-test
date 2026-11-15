import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import './display.css'
import { startAppearance } from './lib/appearance'
import Dashboard from './Dashboard'

startAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>,
)
