import { Component, type ReactNode } from 'react'
import { reportBackendIssue } from '@/services/system-issues'
import { StatusErrorPage } from '@/pages/errors/ErrorPage'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    try {
      reportBackendIssue('ui', 'render', error)
    } catch {
      /* never let logging break the error page */
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return <StatusErrorPage kind="500" />
  }
}
