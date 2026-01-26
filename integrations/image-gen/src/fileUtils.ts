import * as fs from "fs";
import * as path from "path";

export function saveBase64Image(
  base64Data: string,
  outputPath: string
): string {
  // Remove data URL prefix if present
  const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, "");

  // Convert to buffer
  const buffer = Buffer.from(base64Content, "base64");

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}
