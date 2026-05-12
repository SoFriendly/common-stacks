import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
    return (
      <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
        <div className="font-display text-base text-red-700">Something broke</div>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-red-700">
          {this.state.error.message}
        </pre>
        <button
          onClick={this.reset}
          className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs text-white"
        >
          Try again
        </button>
      </div>
    );
  }
}
