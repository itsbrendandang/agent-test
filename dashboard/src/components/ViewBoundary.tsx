// Keeps one broken view from blanking the whole app: the rail and the paid-calls indicator stay, and the view says
// what happened and offers to load again. React needs a class for this.
import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props { /** Changes when another view is opened, which clears the error. */ view: string; children: ReactNode }

export class ViewBoundary extends Component<Props, { failed?: string; view: string }> {
  state: { failed?: string; view: string } = { view: this.props.view }
  static getDerivedStateFromError(error: unknown) { return { failed: error instanceof Error ? error.message : String(error) } }
  static getDerivedStateFromProps(props: Props, state: { failed?: string; view: string }) {
    return props.view === state.view ? null : { failed: undefined, view: props.view }
  }
  componentDidCatch(error: unknown, info: ErrorInfo) { console.error(`The ${this.props.view} view stopped:`, error, info.componentStack) }
  render() {
    if (this.state.failed === undefined) return this.props.children
    return (
      <div className="page">
        <div className="engine-offline card-surface" role="alert">
          <h2>The {this.props.view} view stopped working</h2>
          <p className="muted">It received something it could not show. The other views still work. Loading the page again usually fixes it.</p>
          <p className="muted small"><code>{this.state.failed.slice(0, 300)}</code></p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>Load the page again</button>
        </div>
      </div>
    )
  }
}
