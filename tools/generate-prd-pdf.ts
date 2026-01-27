#!/usr/bin/env npx tsx
/**
 * Generate a styled PDF from a PRD markdown file
 * Usage: npx tsx generate-prd-pdf.ts <lead-slug>
 * Example: npx tsx generate-prd-pdf.ts streetsville-custom-upholstery
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const LEADS_DIR = path.join(PROJECT_ROOT, "leads");

function markdownToHtml(markdown: string): string {
  // Basic markdown to HTML conversion
  let html = markdown
    // Headers
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Blockquotes
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    // Unordered lists
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Horizontal rules
    .replace(/^---$/gm, "<hr>")
    // Line breaks for paragraphs
    .replace(/\n\n/g, "</p><p>")
    // Clean up consecutive blockquotes
    .replace(/<\/blockquote>\n<blockquote>/g, "<br>");

  // Wrap list items in ul tags
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  return `<p>${html}</p>`;
}

async function generatePDF(slug: string): Promise<string> {
  const leadDir = path.join(LEADS_DIR, slug);
  const prdPath = path.join(leadDir, "PRD.md");
  const logoPath = path.join(leadDir, "logo.png");
  const outputPath = path.join(leadDir, "PRD.pdf");

  if (!fs.existsSync(prdPath)) {
    throw new Error(`PRD not found: ${prdPath}`);
  }

  const prdContent = fs.readFileSync(prdPath, "utf-8");
  const hasLogo = fs.existsSync(logoPath);

  // Convert logo to base64 for embedding
  let logoBase64 = "";
  if (hasLogo) {
    const logoBuffer = fs.readFileSync(logoPath);
    logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;
  }

  // Extract business name from PRD
  const nameMatch = prdContent.match(/^# (.+?) - Website Proposal/m);
  const businessName = nameMatch ? nameMatch[1] : slug;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11pt;
      line-height: 1.6;
      color: #1a1a1a;
      padding: 40px 50px;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 24px;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 3px solid #2563eb;
    }

    .logo {
      width: 80px;
      height: 80px;
      object-fit: contain;
      border-radius: 8px;
    }

    .header-text h1 {
      font-size: 24pt;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 4px;
    }

    .header-text .subtitle {
      font-size: 12pt;
      color: #64748b;
      font-weight: 500;
    }

    h1 {
      font-size: 18pt;
      font-weight: 700;
      color: #1e3a5f;
      margin-top: 28px;
      margin-bottom: 12px;
    }

    h2 {
      font-size: 14pt;
      font-weight: 600;
      color: #2563eb;
      margin-top: 24px;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
    }

    h3 {
      font-size: 12pt;
      font-weight: 600;
      color: #334155;
      margin-top: 18px;
      margin-bottom: 8px;
    }

    p {
      margin-bottom: 10px;
    }

    ul {
      margin: 10px 0;
      padding-left: 24px;
    }

    li {
      margin-bottom: 6px;
    }

    blockquote {
      background: #f8fafc;
      border-left: 4px solid #2563eb;
      padding: 12px 16px;
      margin: 14px 0;
      font-style: italic;
      color: #475569;
      border-radius: 0 6px 6px 0;
    }

    strong {
      font-weight: 600;
      color: #1e293b;
    }

    hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 24px 0;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #94a3b8;
      font-size: 9pt;
    }

    .section-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }

    .highlight {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white;
      padding: 20px 24px;
      border-radius: 10px;
      margin: 20px 0;
    }

    .highlight h2 {
      color: white;
      border: none;
      margin-top: 0;
    }

    .highlight p {
      color: rgba(255,255,255,0.9);
    }
  </style>
</head>
<body>
  <div class="header">
    ${hasLogo ? `<img src="${logoBase64}" class="logo" alt="Logo">` : ""}
    <div class="header-text">
      <h1>${businessName}</h1>
      <div class="subtitle">Website Proposal</div>
    </div>
  </div>

  <div class="content">
    ${markdownToHtml(prdContent.replace(/^# .+$/m, ""))}
  </div>

  <div class="footer">
    Prepared by AI Assistant | ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
  </div>
</body>
</html>
  `;

  // Launch browser and generate PDF
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setContent(htmlContent, { waitUntil: "networkidle" });

  await page.pdf({
    path: outputPath,
    format: "Letter",
    printBackground: true,
    margin: {
      top: "0.5in",
      right: "0.5in",
      bottom: "0.5in",
      left: "0.5in",
    },
  });

  await browser.close();

  console.log(`PDF generated: ${outputPath}`);
  return outputPath;
}

// Main execution
const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npx tsx generate-prd-pdf.ts <lead-slug>");
  process.exit(1);
}

generatePDF(slug)
  .then((path) => console.log(`Success: ${path}`))
  .catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
