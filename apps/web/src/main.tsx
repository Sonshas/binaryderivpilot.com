import '@/lib/auth-link'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { AppErrorBoundary } from '@/components/AppErrorBoundary'
import { installErrorLog } from '@/lib/error-log'
import { installErrorLogRemoteBridge } from '@/services/system-issues'
import { startDemoSettlementLoop } from '@/providers/trading/demo-trading-provider'
import './index.css'

installErrorLog()
installErrorLogRemoteBridge()
startDemoSettlementLoop()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
