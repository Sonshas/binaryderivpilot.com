import { Component, type ReactNode } from 'react'
import { Alert, Button } from '@/components/ui'

interface Props {
  children: ReactNode
  title?: string
}

interface State {
  error: Error | null
}

/** Keeps the admin chrome visible when a panel throws. */
export class AdminPanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <Alert tone="danger" title={this.props.title ?? 'This panel failed to load'} className="mb-4">
        <p className="mb-3 break-words font-mono text-xs">{this.state.error.message}</p>
        <Button type="button" size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </Alert>
    )
  }
}
