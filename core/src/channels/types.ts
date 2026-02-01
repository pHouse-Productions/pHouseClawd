// Channel types for the unified input/output system

export interface StreamEvent {
  type: string;
  subtype?: string;
  [key: string]: any;
}

// Normalized message fields - channels populate this from their source
export interface NormalizedMessage {
  text?: string;           // The raw message text (for command parsing, etc.)
  from?: string;           // Sender display name
  isMessage: boolean;      // Is this a user message (vs reaction, edit, etc.)
}

// Event returned from channel polling
export interface ChannelEvent {
  sessionKey: string;  // Logical session key (e.g., "telegram-5473044160")
  prompt: string;      // What to send to Claude
  payload: any;        // Raw event data for the handler (channel-specific)
  message: NormalizedMessage;  // Normalized common fields
}

// Handler for streaming output back to a channel
export interface StreamHandler {
  /** Send a message to the channel */
  relayMessage(text: string): Promise<void>;
  /** Optional: show typing indicator when work starts */
  startTyping?(): Promise<void>;
  /** Optional: hide typing indicator */
  stopTyping?(): Promise<void>;
  /** Optional: add "working" reaction (e.g., 👀) */
  startReaction?(): Promise<void>;
  /** Optional: remove "working" reaction */
  stopReaction?(): Promise<void>;
}

// Concurrency modes for event handling
export type ConcurrencyMode = "none" | "global" | "session";

// Channel definition - handles both input (listening) and output (streaming)
export interface Channel {
  // Unique name for this channel
  name: string;

  // Concurrency mode for handling events
  // - "none": Run all events in parallel
  // - "global": One event at a time for this channel
  // - "session": One event at a time per sessionKey
  concurrency: ConcurrencyMode;

  // Start listening for events - returns cleanup function
  listen(onEvent: (event: ChannelEvent) => void): Promise<() => void>;

  // Create a stream handler for a specific event
  createStreamHandler(event: ChannelEvent): StreamHandler;

  // Get the session key from the event payload
  // Allows channels to define their own session key format (e.g., email uses threadId)
  getSessionKey(payload: any): string;

  // Get channel-specific context to inject into prompts
  // Used to inform the LLM about available tools and how to use them
  getCustomPrompt?(): string;
}

// Legacy handler interface for backwards compatibility during migration
// TODO: Remove after full migration to Channel/StreamHandler
export interface ChannelEventHandler {
  /** Called once when work starts - show typing indicator, add reaction, etc. */
  onWorkStarted?(): void;
  /** Called for each stream event from Claude */
  onStreamEvent(event: StreamEvent): void;
  /** Called once when work is complete - remove typing indicator, reaction, etc. */
  onWorkComplete?(): void;
  /** Called when the process exits */
  onComplete(code: number): void;
}

// Legacy channel interface for backwards compatibility during migration
// TODO: Remove after full migration to Channel
export interface ChannelDefinition {
  name: string;
  concurrency: ConcurrencyMode;
  startListener(onEvent: (event: ChannelEvent) => void): Promise<() => void>;
  createHandler(event: ChannelEvent): ChannelEventHandler;
  getSessionKey(payload: any): string;
  getChannelContext?(): string;
}
