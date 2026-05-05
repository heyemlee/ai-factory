"use client";
import React from "react";

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
  stack: string;
}

export class MachineCutErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, stack: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, stack: "" };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const lines = (info.componentStack || "").split("\n").slice(0, 6).join("\n");
    this.setState({ error, stack: lines });
    console.error("[MachineCutErrorBoundary] caught", this.props.label || "", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-xl border-2 border-red-400 bg-red-50 p-4 text-[12px] font-mono text-red-700">
          <div className="font-bold mb-1">⚠ Render error {this.props.label ? `(${this.props.label})` : ""}</div>
          <div className="mb-2 whitespace-pre-wrap break-all">{this.state.error.message}</div>
          {this.state.stack ? (
            <pre className="text-[10px] opacity-70 whitespace-pre-wrap break-all">{this.state.stack}</pre>
          ) : null}
        </div>
      );
    }
    return this.props.children;
  }
}

export default MachineCutErrorBoundary;
