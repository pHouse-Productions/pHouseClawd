// Channel types for the unified input/output system

export interface StreamEvent {
  type: string;
  subtype?: string;
  [key: string]: any;
}

// Event returned from channel polling
export interface ChannelEvent {
  sessionKey: string;  // Logical session key (e.g., "telegram-5473044160")
  prompt: string;      // What to send to Claude
  payload: any;        // Raw event data for the handler
}

// Handler for a single event's output stream
export interface ChannelEventHandler {
  onStreamEvent(event: StreamEvent): void;
  onComplete(code: number): void;
}

// Concurrency modes for event handling
export type ConcurrencyMode = "none" | "global" | "session";

// Full channel definition - handles both input (polling) and output (handling)
export interface ChannelDefinition {
  // Unique name for this channel
  name: string;

  // Concurrency mode for handling events
  // - "none": Run all events in parallel
  // - "global": One event at a time for this channel
  // - "session": One event at a time per sessionKey
  concurrency: ConcurrencyMode;

  // Start the listener - calls onEvent when new events arrive
  // Returns a stop function to clean up
  startListener(onEvent: (event: ChannelEvent) => void): Promise<() => void>;

  // Create a handler for a specific event
  createHandler(event: ChannelEvent): ChannelEventHandler;
}
