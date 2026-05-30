import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadPresetsFromServer } from './utils/macroPresets'

// Load admin-editable nutrition presets before first render so filters use the live values.
// Race with a short timeout so a slow/unavailable API never blocks startup (defaults kick in).
async function boot() {
  await Promise.race([
    loadPresetsFromServer(),
    new Promise(resolve => setTimeout(resolve, 1500)),
  ])
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

boot()
