/** A page that throws breaks itself, never the shell around it. */
import { Alert } from "@wren/ui";
import { Component, type ReactNode } from "react";

export class Contained extends Component<
  { quiet?: boolean; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // The console keeps what broke, so a report can name it.
  override componentDidCatch(error: unknown) {
    console.error(error);
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <Alert onRetry={() => this.setState({ failed: false })}>
        This page hit a problem. Try again, or open another app.
      </Alert>
    );
  }
}
