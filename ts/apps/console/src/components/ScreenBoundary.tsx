import { Component, type ReactNode } from "react";

/** Keeps one broken render from blanking the whole console. */
export class ScreenBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice warn">
        <div className="footnote">
          <b className="caution">This screen hit an error.</b> {this.state.error.message}{" "}
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      </div>
    );
  }
}
