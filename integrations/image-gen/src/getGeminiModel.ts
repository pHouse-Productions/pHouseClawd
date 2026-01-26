export function getGeminiModel(usePro: boolean = false): string {
  return usePro
    ? "google/gemini-3-pro-image-preview"  // Pro model (Nano Banana Pro)
    : "google/gemini-2.5-flash-image";
}
