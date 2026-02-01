import type { StreamEvent } from "./types.js";

export type Verbosity = "streaming" | "bundled" | "progress" | "final";

export interface OutputHandlerConfig {
  verbosity?: Verbosity;
}

export interface OutputHandlerCallbacks {
  onSend: (message: string) => void;
}

/**
 * Simple output handler - no buffering, no timers.
 * - streaming: send each text chunk immediately
 * - bundled/final: accumulate everything, send at the end
 * - progress: send tool notifications only
 */
export class OutputHandler {
  private verbosity: Verbosity;
  private callbacks: OutputHandlerCallbacks;
  private textBuffer: string = "";
  private isComplete: boolean = false;

  constructor(config: OutputHandlerConfig, callbacks: OutputHandlerCallbacks) {
    this.verbosity = config.verbosity || "streaming";
    this.callbacks = callbacks;
  }

  /**
   * Handle a stream event from Claude
   */
  onStreamEvent(event: StreamEvent): void {
    // Check for result event - this means Claude is done
    if (event.type === "result") {
      this.onComplete(event.subtype === "success" ? 0 : 1);
      return;
    }

    const { text, progress, isNewTurn } = this.extractRelayInfo(event);

    if (text) {
      if (this.verbosity === "streaming") {
        // Send immediately - no buffering
        this.callbacks.onSend(text);
      } else {
        // bundled or final - accumulate
        if (isNewTurn && this.textBuffer.trim()) {
          this.textBuffer += "\n\n";
        }
        this.textBuffer += text;
      }
    }

    if (this.verbosity === "progress" && progress) {
      this.callbacks.onSend(progress);
    }
  }

  /**
   * Mark the handler as complete and flush any remaining text
   */
  onComplete(code: number): void {
    if (this.isComplete) return;
    this.isComplete = true;

    // Send any accumulated text (bundled/final modes)
    if (this.textBuffer.trim()) {
      this.callbacks.onSend(this.textBuffer.trim());
      this.textBuffer = "";
    }
  }

  /**
   * Check if the handler is complete
   */
  isCompleted(): boolean {
    return this.isComplete;
  }

  /**
   * Extract text and progress information from a stream event
   */
  private extractRelayInfo(event: StreamEvent): { text: string | null; progress: string | null; isNewTurn: boolean } {
    const result: { text: string | null; progress: string | null; isNewTurn: boolean } = { text: null, progress: null, isNewTurn: false };

    switch (event.type) {
      case "assistant":
        // "assistant" event contains a complete message from a turn
        if (event.message?.content) {
          const text = event.message.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
          if (text) {
            result.text = text;
            result.isNewTurn = true;
          }
        }
        break;

      case "content_block_start":
        if (event.content_block?.type === "tool_use") {
          result.progress = `Using ${event.content_block.name}...`;
        }
        break;

      case "content_block_delta":
        if (event.delta?.type === "text_delta") {
          result.text = event.delta.text;
        }
        break;

      case "error":
        result.progress = `Error: ${event.error?.message || "Unknown error"}`;
        break;
    }

    return result;
  }
}
