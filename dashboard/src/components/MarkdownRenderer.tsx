"use client";

import ReactMarkdown from "react-markdown";

export default function MarkdownRenderer({ content }: { content: string }) {
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
        prose-pre:bg-zinc-800 prose-pre:border prose-pre:border-zinc-700"
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
