/** A page that throws breaks itself, never the shell around it. */
import { Alert } from "@wren/ui";
import { Component, type ReactNode } from "react";
import { isStaleChunk, reloadOnce } from "./stale.js";

export class Contained extends Component<
  { quiet?: boolean; children: ReactNode },
  { failed: boolean; stale: boolean }
> {
  override state = { failed: false, stale: false };
  static getDerivedStateFromError(error: unknown) {
    return { failed: true, stale: isStaleChunk(error) };
  }
  // The console keeps what broke, so a report can name it. A tab older than the live build
  // reloads itself once; Try again can't help it, since the old file is gone.
  override componentDidCatch(error: unknown) {
    console.error(error);
    if (isStaleChunk(error)) reloadOnce();
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    if (this.state.stale)
      return (
        <Alert onRetry={() => window.location.reload()}>
          Wren was updated since this tab opened. Reload to get the new version.
        </Alert>
      );
    return (
      <Alert onRetry={() => this.setState({ failed: false, stale: false })}>
        This page hit a problem. Try again, or open another app.
      </Alert>
    );
  }
}
