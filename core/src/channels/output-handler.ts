import type { StreamEvent } from "./types.js";

export type Verbosity = "streaming" | "bundled" | "progress" | "final";

export interface OutputHandlerConfig {
  verbosity?: Verbosity;
  flushIntervalMs?: number;
  minCharsToFlush?: number;
}

export interface OutputHandlerCallbacks {
  onSend: (message: string) => void;
  /** Called when work starts and periodically while working. Platform implements however it can (typing indicator, emoji reaction, etc.) */
  onWorkStarted?: () => void;
  /** Called when work is complete. Platform clears its working indicator. */
  onWorkComplete?: () => void;
}

const DEFAULT_FLUSH_INTERVAL_MS = 2000;
const DEFAULT_MIN_CHARS_TO_FLUSH = 50;

/**
 * Shared output handler for managing text buffering and flushing
 * across all chat channels. Handles streaming, bundled, progress, and final modes.
 */
export class OutputHandler {
  private verbosity: Verbosity;
  private flushIntervalMs: number;
  private minCharsToFlush: number;
  private callbacks: OutputHandlerCallbacks;

  private textBuffer: string = "";
  private lastFlush: number = Date.now();
  private flushTimer: NodeJS.Timeout | null = null;
  private isComplete: boolean = false;
  private workingInterval: NodeJS.Timeout | null = null;

  constructor(config: OutputHandlerConfig, callbacks: OutputHandlerCallbacks) {
    this.verbosity = config.verbosity || "streaming";
    this.flushIntervalMs = config.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS;
    this.minCharsToFlush = config.minCharsToFlush || DEFAULT_MIN_CHARS_TO_FLUSH;
    this.callbacks = callbacks;

    // Start working indicator if we have one
    // Progress mode doesn't need it since it only sends tool notifications
    if (this.callbacks.onWorkStarted && this.verbosity !== "progress") {
      this.callbacks.onWorkStarted();
      // Keep working indicator alive every 4 seconds
      // Each platform implements this however they can (typing indicator, emoji reaction, etc.)
      this.workingInterval = setInterval(() => {
        if (!this.isComplete) {
          this.callbacks.onWorkStarted?.();
        }
      }, 4000);
    }
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
        this.bufferText(text);
      } else {
        // bundled or final - just accumulate
        // Add spacing between turns for readability
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

    // Clear any pending timers
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.workingInterval) {
      clearInterval(this.workingInterval);
      this.workingInterval = null;
    }

    // Clear working indicator
    this.callbacks.onWorkComplete?.();

    // Send any remaining buffered text
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

  /**
   * Buffer text and flush when appropriate (streaming mode)
   */
  private bufferText(text: string): void {
    this.textBuffer += text;

    const timeSinceFlush = Date.now() - this.lastFlush;
    if (this.textBuffer.length >= this.minCharsToFlush || timeSinceFlush > this.flushIntervalMs) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /**
   * Flush the buffer and send the text
   */
  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const text = this.textBuffer.trim();
    if (text) {
      this.callbacks.onSend(text);
      // Add spacing after each flush for readability in bundled messages
      this.textBuffer = "\n\n";
      this.lastFlush = Date.now();
    }
  }
}
