"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { authFetch } from "@/lib/auth";
import MarkdownRenderer from "@/components/MarkdownRenderer";

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

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function AttachmentPreview({ attachment, isUser }: { attachment: Attachment; isUser: boolean }) {
  const apiPath = `/api/chat/files?path=${encodeURIComponent(attachment.path)}`;

  if (attachment.type === "image") {
    return (
      <div className="mb-2">
        <img
          src={apiPath}
          alt={attachment.name}
          className="max-w-full max-h-64 rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          onClick={() => window.open(apiPath, "_blank")}
        />
      </div>
    );
  }

  return (
    <a
      href={apiPath}
      download={attachment.name}
      className={`flex items-center gap-2 p-2 rounded-lg mb-2 ${
        isUser ? "bg-blue-700 hover:bg-blue-800" : "bg-zinc-700 hover:bg-zinc-600"
      } transition-colors`}
    >
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <span className="truncate text-sm">{attachment.name}</span>
    </a>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white rounded-br-md"
            : "bg-zinc-800 text-zinc-100 rounded-bl-md"
        }`}
      >
        {/* Render attachments first */}
        {message.attachments?.map((attachment, idx) => (
          <AttachmentPreview key={idx} attachment={attachment} isUser={isUser} />
        ))}

        {/* Render text content */}
        {message.content && (
          isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <MarkdownRenderer content={message.content} />
            </div>
          )
        )}
        <div
          className={`text-xs mt-2 flex items-center gap-2 ${
            isUser ? "text-blue-200" : "text-zinc-500"
          }`}
        >
          <span>{formatTime(message.timestamp)}</span>
          {message.status === "streaming" && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              typing...
            </span>
          )}
          {message.status === "error" && (
            <span className="text-red-400">failed</span>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="bg-zinc-800 rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}

const MESSAGES_PER_PAGE = 20;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false); // local loading state for send button
  const [isTyping, setIsTyping] = useState(false); // server-side typing indicator
  const [isConnected, setIsConnected] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const lastPollTsRef = useRef<string | null>(null);

  // Load chat history (last N messages)
  const loadHistory = useCallback(async () => {
    try {
      const res = await authFetch(`/api/chat?limit=${MESSAGES_PER_PAGE}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        setHasMore(data.hasMore || false);
        setIsTyping(data.isTyping || false);
        setIsConnected(true);
        if (data.messages?.length > 0) {
          // Use the latest complete message timestamp for polling
          const lastComplete = [...data.messages].reverse().find(
            (m: Message) => m.status === "complete" || m.status === "error"
          );
          if (lastComplete) {
            lastPollTsRef.current = lastComplete.timestamp;
          }
        }
      }
    } catch (err) {
      console.error("Failed to load chat history:", err);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Load older messages
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;

    setLoadingMore(true);
    try {
      const oldestTs = messages[0].timestamp;
      const res = await authFetch(`/api/chat?before=${encodeURIComponent(oldestTs)}&limit=${MESSAGES_PER_PAGE}`);
      if (res.ok) {
        const data = await res.json();
        if (data.messages?.length > 0) {
          setMessages((prev) => [...data.messages, ...prev]);
        }
        setHasMore(data.hasMore || false);
      }
    } catch (err) {
      console.error("Failed to load more messages:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages]);

  // Poll for new messages
  const pollMessages = useCallback(async () => {
    if (!isConnected) return;

    try {
      const url = lastPollTsRef.current
        ? `/api/chat?after=${encodeURIComponent(lastPollTsRef.current)}`
        : "/api/chat";
      const res = await authFetch(url);
      if (res.ok) {
        const data = await res.json();

        // Update typing state from server
        setIsTyping(data.isTyping || false);

        // When typing stops, also clear local loading state
        if (!data.isTyping) {
          setIsLoading(false);
        }

        if (data.messages?.length > 0) {
          setMessages((prev) => {
            // Merge new messages, updating streaming ones
            const newMsgs = [...prev];
            for (const msg of data.messages) {
              const existingIdx = newMsgs.findIndex((m) => m.id === msg.id);
              if (existingIdx >= 0) {
                newMsgs[existingIdx] = msg;
              } else {
                newMsgs.push(msg);
              }
            }
            // Sort by timestamp
            newMsgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            return newMsgs;
          });

          // Update lastPollTsRef to the latest COMPLETE message
          const lastCompleteMsg = [...data.messages]
            .reverse()
            .find((m: Message) => m.status === "complete" || m.status === "error");
          if (lastCompleteMsg) {
            lastPollTsRef.current = lastCompleteMsg.timestamp;
          }
        }
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  }, [isConnected]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Start fast polling when loading or typing
  useEffect(() => {
    if (isLoading || isTyping) {
      pollingRef.current = setInterval(pollMessages, 1000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [isLoading, isTyping, pollMessages]);

  // Also poll periodically when not loading (for messages from other channels)
  useEffect(() => {
    const interval = setInterval(pollMessages, 5000);
    return () => clearInterval(interval);
  }, [pollMessages]);

  const sendMessage = async () => {
    const text = input.trim();
    const hasFiles = selectedFiles.length > 0;
    if ((!text && !hasFiles) || isLoading) return;

    // Create preview attachments for user message
    const previewAttachments: Attachment[] = selectedFiles.map(file => ({
      type: file.type.startsWith("image/") ? "image" : "file",
      path: URL.createObjectURL(file), // Temporary blob URL for preview
      name: file.name,
      mimeType: file.type,
    }));

    const nowTs = new Date().toISOString();

    // Add user message immediately (optimistic update)
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: nowTs,
      status: "complete",
      attachments: previewAttachments.length > 0 ? previewAttachments : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    const filesToUpload = [...selectedFiles];
    setSelectedFiles([]);
    setIsLoading(true);

    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    try {
      // Use FormData if we have files, otherwise JSON
      let res: Response;
      if (filesToUpload.length > 0) {
        const formData = new FormData();
        formData.append("message", text);
        filesToUpload.forEach(file => {
          formData.append("files", file);
        });
        res = await authFetch("/api/chat", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await authFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to send message");
      }

      const data = await res.json();

      // Update user message with real ID and server-side attachments
      setMessages((prev) =>
        prev.map((m) =>
          m.id === userMessage.id
            ? { ...m, id: data.userMessageId, timestamp: data.timestamp, attachments: data.attachments || m.attachments }
            : m
        )
      );

      // Set poll timestamp to now so we pick up the assistant response
      lastPollTsRef.current = data.timestamp;
    } catch (err) {
      console.error("Send error:", err);
      setIsLoading(false);
      // Mark user message as error
      setMessages((prev) =>
        prev.map((m) =>
          m.id === userMessage.id ? { ...m, status: "error" } : m
        )
      );
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newFiles = Array.from(files);
      setSelectedFiles(prev => [...prev, ...newFiles]);
    }
    e.target.value = "";
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + "px";
  };

  const clearChat = async () => {
    if (!confirm("Clear all chat history?")) return;

    try {
      const res = await authFetch("/api/chat", { method: "DELETE" });
      if (res.ok) {
        setMessages([]);
        lastPollTsRef.current = null;
      }
    } catch (err) {
      console.error("Failed to clear chat:", err);
    }
  };

  if (loadingHistory) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-white">Chat</h2>
            <p className="text-zinc-500 mt-1">Talk to Vito directly</p>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-3rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h2 className="text-2xl font-bold text-white">Chat</h2>
          <p className="text-zinc-500 mt-1">Talk to Vito directly</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
          <button
            onClick={clearChat}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            title="Clear chat"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages Area - using flex-col-reverse with descending order so newest is at bottom */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto bg-zinc-900 rounded-lg border border-zinc-800 p-4 mb-4 flex flex-col-reverse"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Start a conversation</h3>
            <p className="text-zinc-500 max-w-sm">
              Chat with Vito directly from the dashboard. No external integrations needed.
            </p>
          </div>
        ) : (
          <>
            {/* Typing indicator - first in DOM = bottom visually due to flex-col-reverse */}
            {isTyping && (
              <TypingIndicator />
            )}

            {/* Messages in descending order (newest first in DOM = bottom visually) */}
            {/* Filter out empty assistant messages (no content, no attachments) */}
            {[...messages].reverse()
              .filter((m) => m.role === "user" || m.content?.trim() || m.attachments?.length)
              .map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

            {/* Load More button - last in DOM = top visually */}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="self-center mt-4 px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {loadingMore ? "Loading..." : "Load older messages"}
              </button>
            )}
          </>
        )}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 bg-zinc-900 rounded-lg border border-zinc-800 p-3">
        {/* Selected files preview */}
        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-zinc-700">
            {selectedFiles.map((file, idx) => (
              <div
                key={idx}
                className="relative group bg-zinc-800 rounded-lg overflow-hidden"
              >
                {file.type.startsWith("image/") ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-16 w-16 object-cover"
                  />
                ) : (
                  <div className="h-16 w-16 flex flex-col items-center justify-center p-2">
                    <svg className="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs text-zinc-400 truncate w-full text-center mt-1">
                      {file.name.split(".").pop()}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeFile(idx)}
                  className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-3">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            accept="image/*,.heic,.heif,.pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx,*/*"
          />

          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex-shrink-0"
            title="Attach file"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 bg-zinc-800 text-white placeholder-zinc-500 rounded-lg px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            style={{ maxHeight: "150px" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() && selectedFiles.length === 0}
            className="p-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
