#!/usr/bin/env python3
"""
Simple PDF to text/markdown converter using PyMuPDF (fitz).
Extracts text from all pages and saves to a .md file.

Usage: python3 pdf-to-text.py <input.pdf> [output.md]
If output is not specified, creates <input>.md alongside the PDF.

Returns the output path on success, error message on failure.
"""

import sys
import os

try:
    import fitz  # PyMuPDF
except ImportError:
    print("ERROR: PyMuPDF not installed. Run: pip install pymupdf", file=sys.stderr)
    sys.exit(1)


def extract_pdf_text(pdf_path: str, output_path: str | None = None) -> str:
    """Extract text from PDF and save to markdown file."""

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    # Default output path: same name with .md extension
    if output_path is None:
        output_path = os.path.splitext(pdf_path)[0] + ".md"

    doc = fitz.open(pdf_path)

    lines = []
    lines.append(f"# {os.path.basename(pdf_path)}")
    lines.append(f"")
    lines.append(f"*{len(doc)} pages*")
    lines.append(f"")

    for i, page in enumerate(doc):
        text = page.get_text().strip()
        if text:
            lines.append(f"---")
            lines.append(f"## Page {i + 1}")
            lines.append(f"")
            lines.append(text)
            lines.append(f"")

    doc.close()

    content = "\n".join(lines)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    return output_path


def main():
    if len(sys.argv) < 2:
        print("Usage: pdf-to-text.py <input.pdf> [output.md]", file=sys.stderr)
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        result_path = extract_pdf_text(pdf_path, output_path)
        print(result_path)  # Output the path for the caller
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
