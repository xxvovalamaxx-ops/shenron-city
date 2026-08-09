import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

document.addEventListener('contextmenu', (e) => e.preventDefault())

const host = document.getElementById('root')
if (!host) throw new Error('#root missing from index.html')

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
