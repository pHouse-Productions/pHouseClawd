import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { authFetch } from "@/lib/auth";
import MarkdownRenderer from "@/components/MarkdownRenderer";

// Detect if user is on mobile device (not just touch-capable)
// Uses screen width as primary indicator since touch detection is unreliable
// (many laptops have touchscreens but users expect Enter to send)
function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  // Use 768px as breakpoint - standard tablet/mobile threshold
  return window.innerWidth < 768;
}

interface Attachment {
  type: "image" | "file";
  path: string;
  name: string;
  mimeType?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  status?: "pending" | "streaming" | "complete" | "error";
  attachments?: Attachment[];
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldScrollRef = useRef<boolean>(false);

  // Handle keyboard: Enter sends on desktop, Shift+Enter adds newline
  // On mobile, Enter just adds newline (use send button)
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isMobile()) {
      e.preventDefault();
      if (input.trim() || files.length > 0) {
        handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Reset height to auto to shrink if needed, then set to scrollHeight
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
  };

  const scrollToBottom = () => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  useEffect(() => {
    // Only auto-scroll when user just sent a message
    if (shouldScrollRef.current) {
      scrollToBottom();
      shouldScrollRef.current = false;
    }
  }, [messages]);

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const res = await authFetch("/api/chat");
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
          setIsTyping(data.isTyping || false);
        }
      } catch (err) {
        console.error("Failed to fetch messages:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchMessages();
    const interval = setInterval(fetchMessages, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && files.length === 0) || sending) return;

    setSending(true);
    const formData = new FormData();
    formData.append("message", input);
    files.forEach((file) => formData.append("files", file));

    try {
      const res = await authFetch("/api/chat", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        setInput("");
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        shouldScrollRef.current = true; // Scroll to bottom after sending
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleClear = async () => {
    if (!confirm("Clear all chat history?")) return;
    try {
      await authFetch("/api/chat", { method: "DELETE" });
      setMessages([]);
    } catch (err) {
      console.error("Failed to clear chat:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading chat...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)] md:h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Chat</h2>
          <p className="text-zinc-500 text-sm">Chat with your assistant</p>
        </div>
        <button
          onClick={handleClear}
          className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Messages - flex-col-reverse so scroll position is preserved from bottom */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto flex flex-col-reverse mb-4 bg-zinc-900 rounded-lg border border-zinc-800 p-4">
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="text-zinc-500 text-center py-8">No messages yet</div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-100"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <MarkdownRenderer content={msg.content} />
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {msg.attachments.map((att, i) => (
                        <div key={i} className="text-xs bg-zinc-700 px-2 py-1 rounded">
                          {att.name}
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.status === "streaming" && (
                    <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-1" />
                  )}
                </div>
              </div>
            ))
          )}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 rounded-lg px-4 py-3 text-zinc-400">
                <span className="animate-pulse">Typing...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 resize-none"
          style={{ maxHeight: "150px" }}
        />
        <button
          type="submit"
          disabled={sending || (!input.trim() && files.length === 0)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? "..." : "Send"}
        </button>
      </form>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span key={i} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-1 rounded">
              {f.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
