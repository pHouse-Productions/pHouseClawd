"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

// Transform local file paths to API endpoint URLs
function transformImageSrc(src: string): string {
  // Check if it's a local file path (starts with / but not /api)
  if (src.startsWith("/home/") || src.startsWith("/tmp/")) {
    return `/api/chat/files?path=${encodeURIComponent(src)}`;
  }
  // Also handle memory/dashboard/files paths without leading slash
  if (src.includes("memory/dashboard/files")) {
    return `/api/chat/files?path=${encodeURIComponent(src)}`;
  }
  return src;
}

// Add paragraph breaks where sentences run together (e.g., "message.Now" → "message.\n\nNow")
// This happens when Claude makes tool calls between text blocks
function normalizeContent(content: string): string {
  // Add line break after sentence-ending punctuation followed immediately by a capital letter
  return content.replace(/([.!?])([A-Z])/g, '$1\n\n$2');
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const normalized = normalizeContent(content);
  return (
    <div
      className="prose prose-invert prose-sm max-w-none
        prose-headings:text-white prose-headings:font-semibold
        prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
        prose-p:text-zinc-300 prose-p:leading-relaxed
        prose-li:text-zinc-300
        prose-strong:text-white
        prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
        prose-code:text-pink-400 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
        prose-pre:bg-zinc-800 prose-pre:border prose-pre:border-zinc-700 prose-pre:overflow-x-auto prose-pre:whitespace-pre-wrap prose-pre:break-all
        prose-code:break-all
        prose-table:border-collapse prose-table:w-full
        prose-th:bg-zinc-800 prose-th:border prose-th:border-zinc-600 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:text-zinc-200
        prose-td:border prose-td:border-zinc-700 prose-td:px-3 prose-td:py-2 prose-td:text-zinc-300"
      style={{
        wordWrap: "break-word",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          img: ({ src, alt, ...props }) => {
            const srcStr = typeof src === "string" ? src : "";
            return (
              <img
                src={srcStr ? transformImageSrc(srcStr) : ""}
                alt={alt || ""}
                className="max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => srcStr && window.open(transformImageSrc(srcStr), "_blank")}
                {...props}
              />
            );
          },
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
