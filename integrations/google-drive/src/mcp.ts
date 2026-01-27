import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Share credentials with Gmail integration
const CREDENTIALS_PATH = path.join(__dirname, "../../gmail/client_secret.json");
const TOKEN_PATH = path.join(__dirname, "../../gmail/tokens.json");

// Load credentials and tokens
function getOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = credentials.installed;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "http://localhost:8080"
  );

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oauth2Client.setCredentials(tokens);

  // Auto-refresh tokens when they expire
  oauth2Client.on("tokens", (newTokens) => {
    const currentTokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
    const updatedTokens = { ...currentTokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updatedTokens, null, 2));
    fs.chmodSync(TOKEN_PATH, 0o600);
  });

  return oauth2Client;
}

const auth = getOAuth2Client();
const drive = google.drive({ version: "v3", auth });

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface SearchFilesResult {
  files: DriveFile[];
  totalFound: number;
}

interface ListRecentFilesResult {
  files: DriveFile[];
}

interface DeleteFileResult {
  fileId: string;
  deleted: boolean;
}

interface UploadFileResult {
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  webContentLink?: string;
}

async function searchFiles(
  query: string,
  fileType?: "spreadsheet" | "document" | "all",
  maxResults: number = 20
): Promise<SearchFilesResult> {
  // Build the query
  let q = `name contains '${query.replace(/'/g, "\\'")}'`;

  // Add file type filter
  if (fileType === "spreadsheet") {
    q += " and mimeType='application/vnd.google-apps.spreadsheet'";
  } else if (fileType === "document") {
    q += " and mimeType='application/vnd.google-apps.document'";
  } else if (fileType === "all") {
    q += " and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document')";
  }

  // Exclude trashed files
  q += " and trashed=false";

  const response = await drive.files.list({
    q,
    pageSize: maxResults,
    fields: "files(id, name, mimeType, createdTime, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc",
  });

  const files = (response.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    createdTime: f.createdTime || undefined,
    modifiedTime: f.modifiedTime || undefined,
    webViewLink: f.webViewLink || undefined,
  }));

  return {
    files,
    totalFound: files.length,
  };
}

async function listRecentFiles(
  fileType?: "spreadsheet" | "document" | "all",
  maxResults: number = 20
): Promise<ListRecentFilesResult> {
  // Build the query
  let q = "trashed=false";

  // Add file type filter
  if (fileType === "spreadsheet") {
    q += " and mimeType='application/vnd.google-apps.spreadsheet'";
  } else if (fileType === "document") {
    q += " and mimeType='application/vnd.google-apps.document'";
  } else if (fileType === "all") {
    q += " and (mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.document')";
  }

  const response = await drive.files.list({
    q,
    pageSize: maxResults,
    fields: "files(id, name, mimeType, createdTime, modifiedTime, webViewLink)",
    orderBy: "modifiedTime desc",
  });

  const files = (response.data.files || []).map((f) => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType!,
    createdTime: f.createdTime || undefined,
    modifiedTime: f.modifiedTime || undefined,
    webViewLink: f.webViewLink || undefined,
  }));

  return { files };
}

async function deleteFile(fileId: string): Promise<DeleteFileResult> {
  await drive.files.delete({ fileId });
  return {
    fileId,
    deleted: true,
  };
}

async function uploadFile(
  filePath: string,
  fileName?: string,
  folderId?: string
): Promise<UploadFileResult> {
  const actualFileName = fileName || path.basename(filePath);

  // Determine MIME type from extension
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".md": "text/markdown",
  };
  const mimeType = mimeTypes[ext] || "application/octet-stream";

  const fileMetadata: any = {
    name: actualFileName,
  };

  if (folderId) {
    fileMetadata.parents = [folderId];
  }

  const media = {
    mimeType,
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id, name, mimeType, webViewLink, webContentLink",
  });

  return {
    fileId: response.data.id!,
    name: response.data.name!,
    mimeType: response.data.mimeType!,
    webViewLink: response.data.webViewLink!,
    webContentLink: response.data.webContentLink || undefined,
  };
}

async function shareFile(
  fileId: string,
  email: string,
  role: "reader" | "commenter" | "writer" = "reader"
): Promise<{ fileId: string; sharedWith: string; role: string }> {
  await drive.permissions.create({
    fileId,
    requestBody: {
      type: "user",
      role,
      emailAddress: email,
    },
    sendNotificationEmail: false,
  });

  return {
    fileId,
    sharedWith: email,
    role,
  };
}

async function makeFilePublic(
  fileId: string
): Promise<{ fileId: string; webViewLink: string }> {
  // Make the file publicly viewable
  await drive.permissions.create({
    fileId,
    requestBody: {
      type: "anyone",
      role: "reader",
    },
  });

  // Get the updated file info with the public link
  const file = await drive.files.get({
    fileId,
    fields: "webViewLink",
  });

  return {
    fileId,
    webViewLink: file.data.webViewLink!,
  };
}

const server = new Server(
  { name: "google-drive", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_files",
      description:
        "Search for Google Docs and Sheets by name. Returns matching files with their IDs, names, and links.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query to match against file names",
          },
          file_type: {
            type: "string",
            enum: ["spreadsheet", "document", "all"],
            description:
              "Filter by file type: 'spreadsheet' for Google Sheets, 'document' for Google Docs, 'all' for both (default: all)",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "list_recent_files",
      description:
        "List recent Google Docs and Sheets, sorted by last modified time. Useful for finding files you recently worked on.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_type: {
            type: "string",
            enum: ["spreadsheet", "document", "all"],
            description:
              "Filter by file type: 'spreadsheet' for Google Sheets, 'document' for Google Docs, 'all' for both (default: all)",
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default: 20)",
          },
        },
        required: [],
      },
    },
    {
      name: "delete_file",
      description:
        "Permanently delete a Google Doc or Sheet by its file ID. Use with caution - this cannot be undone!",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_id: {
            type: "string",
            description: "The Google Drive file ID to delete",
          },
        },
        required: ["file_id"],
      },
    },
    {
      name: "upload_file",
      description:
        "Upload a file (PDF, image, etc.) to Google Drive. Returns the file ID and shareable link. The file is private by default - use share_file or make_file_public to share it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_path: {
            type: "string",
            description: "The local file path to upload",
          },
          file_name: {
            type: "string",
            description: "Optional name for the file in Drive (defaults to original filename)",
          },
          folder_id: {
            type: "string",
            description: "Optional Google Drive folder ID to upload to",
          },
        },
        required: ["file_path"],
      },
    },
    {
      name: "share_file",
      description:
        "Share a Google Drive file with a specific email address.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_id: {
            type: "string",
            description: "The Google Drive file ID to share",
          },
          email: {
            type: "string",
            description: "Email address to share with (defaults to mikecarcasole@gmail.com)",
          },
          role: {
            type: "string",
            enum: ["reader", "commenter", "writer"],
            description: "Permission level (default: reader)",
          },
        },
        required: ["file_id"],
      },
    },
    {
      name: "make_file_public",
      description:
        "Make a Google Drive file publicly viewable via link. Anyone with the link can view it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file_id: {
            type: "string",
            description: "The Google Drive file ID to make public",
          },
        },
        required: ["file_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "search_files") {
    const { query, file_type, max_results = 20 } = args as {
      query: string;
      file_type?: "spreadsheet" | "document" | "all";
      max_results?: number;
    };

    try {
      const result = await searchFiles(query, file_type || "all", max_results);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to search files: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "list_recent_files") {
    const { file_type, max_results = 20 } = (args as {
      file_type?: "spreadsheet" | "document" | "all";
      max_results?: number;
    }) || {};

    try {
      const result = await listRecentFiles(file_type || "all", max_results);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to list recent files: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "delete_file") {
    const { file_id } = args as { file_id: string };

    try {
      const result = await deleteFile(file_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to delete file: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "upload_file") {
    const { file_path, file_name, folder_id } = args as {
      file_path: string;
      file_name?: string;
      folder_id?: string;
    };

    try {
      const result = await uploadFile(file_path, file_name, folder_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to upload file: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "share_file") {
    const { file_id, email = "mikecarcasole@gmail.com", role = "reader" } = args as {
      file_id: string;
      email?: string;
      role?: "reader" | "commenter" | "writer";
    };

    try {
      const result = await shareFile(file_id, email, role);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to share file: ${errMsg}` }],
        isError: true,
      };
    }
  }

  if (name === "make_file_public") {
    const { file_id } = args as { file_id: string };

    try {
      const result = await makeFilePublic(file_id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Failed to make file public: ${errMsg}` }],
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
  console.error("[MCP] Google Drive MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
