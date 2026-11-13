import { Component } from 'react';
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('NexusFlow UI error', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="error-screen"><span className="eyebrow">NEXUSFLOW</span><h1>Something interrupted the flow.</h1><p>Your saved graphs are safe. Reload the workspace to reconnect.</p><button className="button button-primary" onClick={() => window.location.reload()}>Reload workspace</button><details><summary>Technical details</summary><pre>{this.state.error.message}</pre></details></main>;
  }
}
