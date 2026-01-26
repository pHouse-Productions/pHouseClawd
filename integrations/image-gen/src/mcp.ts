import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import * as path from "path";
import { generateImage } from "./generateImage.js";
import { editImage } from "./editImage.js";
import { GenerateImageSchema, EditImageSchema } from "./schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, "../.env") });

const server = new Server(
  { name: "image-gen", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description: "Generate an image using Gemini via OpenRouter and save it to a file",
      inputSchema: {
        type: "object" as const,
        properties: {
          prompt: {
            type: "string",
            description: "The prompt describing the image to generate",
          },
          outputPath: {
            type: "string",
            description: "Path where the image should be saved (e.g., /tmp/image.png)",
          },
          aspectRatio: {
            type: "string",
            enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
            description: "Aspect ratio of the image (default: 1:1)",
          },
          imageSize: {
            type: "string",
            enum: ["1K", "2K", "4K"],
            description: "Size of the image (default: 1K)",
          },
          usePro: {
            type: "boolean",
            description: "Use the Pro model instead of Flash (default: false)",
          },
        },
        required: ["prompt", "outputPath"],
      },
    },
    {
      name: "edit_image",
      description: "Edit an image using AI with a text prompt. Takes an input image and applies transformations based on the prompt.",
      inputSchema: {
        type: "object" as const,
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
            description: "Path where the edited image should be saved",
          },
          aspectRatio: {
            type: "string",
            enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"],
            description: "Aspect ratio of the output image (default: 1:1)",
          },
          imageSize: {
            type: "string",
            enum: ["1K", "2K", "4K"],
            description: "Size of the output image (default: 1K)",
          },
          usePro: {
            type: "boolean",
            description: "Use the Pro model instead of Flash (default: false)",
          },
        },
        required: ["prompt", "inputImage", "outputPath"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "generate_image") {
    try {
      const parsed = GenerateImageSchema.parse(args);
      const result = await generateImage(parsed);

      return {
        content: [
          {
            type: "text",
            text: `Image generated successfully and saved to: ${result.outputPath}`,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to generate image: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "edit_image") {
    try {
      const parsed = EditImageSchema.parse(args);
      const result = await editImage(parsed);

      return {
        content: [
          {
            type: "text",
            text: `Image edited successfully and saved to: ${result.outputPath}`,
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to edit image: ${errMsg}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Image Generation MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
