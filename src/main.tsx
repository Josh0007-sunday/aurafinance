import './polyfills'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SolanaProvider } from './providers/SolanaProvider'
import { StacksProvider } from './providers/StacksProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SolanaProvider>
      <StacksProvider>
        <App />
      </StacksProvider>
    </SolanaProvider>
  </StrictMode>,
)
