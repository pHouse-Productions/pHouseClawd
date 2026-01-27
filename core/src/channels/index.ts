// Channel interface for handling Claude stream events
// Each channel (Telegram, Email, Discord, etc.) implements this interface
// to handle events in a way appropriate for that platform

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

export interface Channel {
  // Called with every stream event from Claude
  onStreamEvent(event: StreamEvent): void;

  // Called when Claude is completely done (receives exit code)
  onComplete(code: number): void;
}

export { TelegramChannel } from "./telegram.js";
export { EmailChannel } from "./email.js";
