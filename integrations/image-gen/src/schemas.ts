import { z } from "zod";

export const AspectRatio = z.enum([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
]);

export const ImageSize = z.enum(["1K", "2K", "4K"]);

export const SharedImageOptionsSchema = z.object({
  aspectRatio: AspectRatio.default("1:1"),
  imageSize: ImageSize.default("1K"),
  usePro: z.boolean().default(false),
});

export const GenerateImageSchema = z.object({
  prompt: z.string().describe("The prompt describing the image to generate"),
  outputPath: z.string().describe("Path where the image should be saved"),
}).merge(SharedImageOptionsSchema.partial());

export const EditImageSchema = z.object({
  prompt: z.string().describe("The prompt describing the desired edits"),
  inputImage: z.string().describe("Path to the input image file"),
  outputPath: z.string().describe("Path where the edited image should be saved"),
}).merge(SharedImageOptionsSchema.partial());

export type GenerateImageInput = z.infer<typeof GenerateImageSchema>;
export type EditImageInput = z.infer<typeof EditImageSchema>;
export type AspectRatioType = z.infer<typeof AspectRatio>;
export type ImageSizeType = z.infer<typeof ImageSize>;
