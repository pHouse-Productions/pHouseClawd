import { OpenRouter } from "@openrouter/sdk";
import { readFile } from "fs/promises";
import { z } from "zod";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";
import { saveBase64Image } from "./fileUtils.js";
import { EditImageSchema, type EditImageInput } from "./schemas.js";
import { getGeminiModel } from "./getGeminiModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

export interface EditImageOptionsWithVerbose extends EditImageInput {
  verbose?: boolean;
}

export interface EditImageResult {
  outputPath: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
}

const openRouter = new OpenRouter({
  apiKey: z.string().parse(process.env.OPENROUTER_API_KEY),
});

export async function editImage(
  options: EditImageOptionsWithVerbose
): Promise<EditImageResult> {
  const {
    prompt,
    inputImage,
    outputPath,
    aspectRatio = "1:1",
    imageSize = "1K",
    usePro = false,
    verbose = false,
  } = options;

  const model = getGeminiModel(usePro);

  // Read the input image and convert to base64
  const imageBuffer = await readFile(inputImage);
  const base64Image = imageBuffer.toString("base64");

  // Determine mime type from extension
  const ext = inputImage.toLowerCase().split(".").pop();
  const mimeType =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : "image/png";

  if (verbose) {
    console.log("\n=== Image Edit Details ===");
    console.log(`Model: ${model}`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Input Image: ${inputImage}`);
    console.log(`Output Path: ${outputPath}`);
    console.log(`Aspect Ratio: ${aspectRatio}`);
    console.log(`Image Size: ${imageSize}`);
    console.log(`Use Pro: ${usePro}`);
    console.log("=========================\n");
  } else {
    console.log(`Model: ${model}`);
    console.log(`Aspect Ratio: ${aspectRatio}`);
    console.log(`Image Size: ${imageSize}`);
    console.log(`Editing: ${prompt}`);
  }

  const result = await openRouter.chat.send({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt,
          },
          {
            type: "image_url",
            imageUrl: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          },
        ],
      },
    ],
    model,
    modalities: ["image", "text"],
    imageConfig: {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    },
  });

  if (verbose) {
    console.log("\n=== Full API Response ===");
    console.log(JSON.stringify(result, null, 2));
    console.log("=== End Response ===\n");
  }

  const base64ImageResponse =
    result.choices[0]?.message.images?.[0]?.imageUrl?.url;

  if (!base64ImageResponse) {
    throw new Error("No image returned from edit request");
  }

  saveBase64Image(base64ImageResponse, outputPath);

  return {
    outputPath,
    model,
    aspectRatio,
    imageSize,
  };
}

// MCP Tool Definition
export const mcpTool = {
  name: "edit_image",
  description:
    "Edit an image using AI with a text prompt. Takes an input image and applies transformations based on the prompt. Supports the same aspect ratios and image sizes as generate_image.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text prompt describing the desired edits",
      },
      inputImage: {
        type: "string",
        description: "Path to the input image file",
      },
      outputPath: {
        type: "string",
        description: "Output file path (e.g., edited_image.png)",
      },
      aspectRatio: {
        type: "string",
        enum: [
          "1:1",
          "2:3",
          "3:2",
          "3:4",
          "4:3",
          "4:5",
          "5:4",
          "9:16",
          "16:9",
          "21:9",
        ],
        description: "Aspect ratio (default: 1:1)",
      },
      imageSize: {
        type: "string",
        enum: ["1K", "2K", "4K"],
        description: "Image size (default: 1K)",
      },
      usePro: {
        type: "boolean",
        description: "Use Pro model for higher quality (default: false)",
      },
    },
    required: ["prompt", "inputImage", "outputPath"],
  },
};

// MCP Tool Handler
export async function mcpHandler(args: any) {
  try {
    // Validate and parse arguments with Zod
    const parsed = EditImageSchema.parse(args);

    const result = await editImage({
      ...parsed,
      verbose: false,
    });

    return {
      content: [
        {
          type: "text",
          text: `Successfully edited image and saved to: ${result.outputPath}\n\nModel: ${result.model}\nAspect Ratio: ${result.aspectRatio}\nImage Size: ${result.imageSize}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error editing image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
