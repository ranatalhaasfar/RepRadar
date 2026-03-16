import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught:', error, info.componentStack)
  }

  handleRefresh = () => {
    // Clear potentially corrupt localStorage before reloading
    try {
      const toRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('repradar_')) toRemove.push(k)
      }
      toRemove.forEach(k => localStorage.removeItem(k))
    } catch { /* ignore */ }
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'linear-gradient(145deg, #E8F0EC, #EBE8E4)' }}>
          <div className="max-w-md w-full text-center space-y-4">
            <p className="text-4xl">⚠️</p>
            <h1 className="text-lg font-semibold text-black/80">Something went wrong</h1>
            <p className="text-sm text-black/40">
              The page ran into an unexpected error. Clicking refresh will clear the local cache and reload.
            </p>
            <button
              onClick={this.handleRefresh}
              className="mt-2 px-5 py-2.5 btn-primary text-sm font-medium rounded-lg transition-colors"
            >
              Click here to refresh
            </button>
            {this.state.error && (
              <p className="text-[11px] text-black/30 font-mono break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
