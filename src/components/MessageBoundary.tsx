import { Component, type ReactNode } from "react";

/** One bad markdown node must not white-screen the app — the transcript
 * degrades to a plain-text bubble instead. Rooms use the same boundary. */
export class MessageBoundary extends Component<{ children: ReactNode; fallbackText: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="chat-text w-fit max-w-[min(80%,560px,calc(100%-82px))] rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 whitespace-pre-wrap text-ink">
          {this.props.fallbackText}
        </div>
      );
    }
    return this.props.children;
  }
}
