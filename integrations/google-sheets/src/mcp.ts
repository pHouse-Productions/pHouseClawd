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
const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

interface CreateSpreadsheetResult {
  spreadsheetId: string;
  title: string;
  url: string;
}

interface ShareSpreadsheetResult {
  spreadsheetId: string;
  sharedWith: string;
  role: string;
  url: string;
}

interface ReadSpreadsheetResult {
  spreadsheetId: string;
  range: string;
  values: string[][];
}

async function createSpreadsheet(
  title: string,
  sheetNames?: string[]
): Promise<CreateSpreadsheetResult> {
  const requestBody: any = {
    properties: { title },
  };

  // Add custom sheet names if provided
  if (sheetNames && sheetNames.length > 0) {
    requestBody.sheets = sheetNames.map((name) => ({
      properties: { title: name },
    }));
  }

  const response = await sheets.spreadsheets.create({ requestBody });

  const spreadsheetId = response.data.spreadsheetId!;
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  return {
    spreadsheetId,
    title,
    url,
  };
}

async function shareSpreadsheet(
  spreadsheetId: string,
  email: string,
  role: "reader" | "commenter" | "writer" = "writer"
): Promise<ShareSpreadsheetResult> {
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      type: "user",
      role,
      emailAddress: email,
    },
    sendNotificationEmail: true,
  });

  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  return {
    spreadsheetId,
    sharedWith: email,
    role,
    url,
  };
}

async function getSpreadsheetLink(spreadsheetId: string): Promise<string> {
  // Verify spreadsheet exists by fetching metadata
  await sheets.spreadsheets.get({ spreadsheetId });
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

async function readSpreadsheet(
  spreadsheetId: string,
  range: string
): Promise<ReadSpreadsheetResult> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return {
    spreadsheetId,
    range,
    values: (response.data.values as string[][]) || [],
  };
}

async function writeSpreadsheet(
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<{ updatedCells: number; updatedRange: string }> {
  const response = await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return {
    updatedCells: response.data.updatedCells || 0,
    updatedRange: response.data.updatedRange || range,
  };
}

async function appendToSpreadsheet(
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<{ updatedCells: number; updatedRange: string }> {
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return {
    updatedCells: response.data.updates?.updatedCells || 0,
    updatedRange: response.data.updates?.updatedRange || range,
  };
}

const server = new Server(
  { name: "google-sheets", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_spreadsheet",
      description:
        "Create a new Google Spreadsheet with an optional title and sheet names. Returns the spreadsheet ID and URL.",
      inputSchema: {
        type: "object" as const,
        properties: {
          title: {
            type: "string",
            description: "The title of the spreadsheet (default: 'Untitled')",
          },
          sheet_names: {
            type: "array",
            items: { type: "string" },
            description: "Optional array of sheet/tab names to create",
          },
        },
        required: [],
      },
    },
    {
      name: "share_spreadsheet",
      description:
        "Share a Google Spreadsheet with an email address. Defaults to writer (edit) access.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: {
            type: "string",
            description: "The Google Spreadsheet ID",
          },
          email: {
            type: "string",
            description:
              "Email address to share with (defaults to mikecarcasole@gmail.com)",
          },
          role: {
            type: "string",
            enum: ["reader", "commenter", "writer"],
            description:
              "Permission level: reader, commenter, or writer (default: writer)",
          },
        },
        required: ["spreadsheet_id"],
      },
    },
    {
      name: "get_spreadsheet_link",
      description: "Get the shareable link for a Google Spreadsheet by its ID.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: {
            type: "string",
            description: "The Google Spreadsheet ID",
          },
        },
        required: ["spreadsheet_id"],
      },
    },
    {
      name: "read_spreadsheet",
      description:
        "Read data from a Google Spreadsheet. Specify a range like 'Sheet1!A1:D10' or just 'A1:D10' for the first sheet.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: {
            type: "string",
            description: "The Google Spreadsheet ID",
          },
          range: {
            type: "string",
            description:
              "The A1 notation range to read (e.g., 'Sheet1!A1:D10' or 'A1:D10')",
          },
        },
        required: ["spreadsheet_id", "range"],
      },
    },
    {
      name: "write_spreadsheet",
      description:
        "Write data to a Google Spreadsheet. Overwrites existing data in the specified range.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: {
            type: "string",
            description: "The Google Spreadsheet ID",
          },
          range: {
            type: "string",
            description:
              "The A1 notation range to write to (e.g., 'Sheet1!A1' or 'A1')",
          },
          values: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
            description:
              "2D array of values to write (rows of columns), e.g., [[\"A1\", \"B1\"], [\"A2\", \"B2\"]]",
          },
        },
        required: ["spreadsheet_id", "range", "values"],
      },
    },
    {
      name: "append_to_spreadsheet",
      description:
        "Append rows to the end of data in a Google Spreadsheet. Finds the last row with data and adds new rows below it.",
      inputSchema: {
        type: "object" as const,
        properties: {
          spreadsheet_id: {
            type: "string",
            description: "The Google Spreadsheet ID",
          },
          range: {
            type: "string",
            description:
              "The A1 notation range that defines the table (e.g., 'Sheet1!A:D' or 'A:D')",
          },
          values: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" },
            },
            description:
              "2D array of rows to append, e.g., [[\"A1\", \"B1\"], [\"A2\", \"B2\"]]",
          },
        },
        required: ["spreadsheet_id", "range", "values"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "create_spreadsheet") {
    const { title = "Untitled", sheet_names } = (args as {
      title?: string;
      sheet_names?: string[];
    }) || {};

    try {
      const result = await createSpreadsheet(title, sheet_names);
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
          { type: "text", text: `Failed to create spreadsheet: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "share_spreadsheet") {
    const {
      spreadsheet_id,
      email = "mikecarcasole@gmail.com",
      role = "writer",
    } = args as {
      spreadsheet_id: string;
      email?: string;
      role?: "reader" | "commenter" | "writer";
    };

    try {
      const result = await shareSpreadsheet(spreadsheet_id, email, role);
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
          { type: "text", text: `Failed to share spreadsheet: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "get_spreadsheet_link") {
    const { spreadsheet_id } = args as { spreadsheet_id: string };

    try {
      const url = await getSpreadsheetLink(spreadsheet_id);
      return {
        content: [{ type: "text", text: url }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text", text: `Failed to get spreadsheet link: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "read_spreadsheet") {
    const { spreadsheet_id, range } = args as {
      spreadsheet_id: string;
      range: string;
    };

    try {
      const result = await readSpreadsheet(spreadsheet_id, range);
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
          { type: "text", text: `Failed to read spreadsheet: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "write_spreadsheet") {
    const { spreadsheet_id, range, values } = args as {
      spreadsheet_id: string;
      range: string;
      values: string[][];
    };

    try {
      const result = await writeSpreadsheet(spreadsheet_id, range, values);
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
          { type: "text", text: `Failed to write to spreadsheet: ${errMsg}` },
        ],
        isError: true,
      };
    }
  }

  if (name === "append_to_spreadsheet") {
    const { spreadsheet_id, range, values } = args as {
      spreadsheet_id: string;
      range: string;
      values: string[][];
    };

    try {
      const result = await appendToSpreadsheet(spreadsheet_id, range, values);
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
          { type: "text", text: `Failed to append to spreadsheet: ${errMsg}` },
        ],
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
  console.error("[MCP] Google Sheets MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
