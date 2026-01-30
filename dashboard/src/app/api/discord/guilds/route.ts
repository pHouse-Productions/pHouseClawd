import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const PROJECT_ROOT = process.env.PHOUSE_PROJECT_ROOT || path.resolve(process.cwd(), "..");
const MCP_ROOT = path.resolve(PROJECT_ROOT, "../pHouseMcp");
const MCP_ENV_FILE = path.join(MCP_ROOT, ".env");

const DISCORD_API_BASE = "https://discord.com/api/v10";

async function getDiscordToken(): Promise<string | null> {
  try {
    const content = await fs.readFile(MCP_ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DISCORD_BOT_TOKEN=")) {
        return trimmed.slice("DISCORD_BOT_TOKEN=".length);
      }
    }
    return null;
  } catch {
    return null;
  }
}

interface DiscordGuild {
  id: string;
  name: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  guild_id?: string;
}

interface GuildInfo {
  id: string;
  name: string;
  channels: { id: string; name: string; type: string }[];
}

export async function GET() {
  try {
    const token = await getDiscordToken();
    if (!token) {
      return NextResponse.json(
        { error: "Discord bot token not configured. Add DISCORD_BOT_TOKEN in Settings > MCP Config." },
        { status: 400 }
      );
    }

    // Fetch guilds the bot is in
    const guildsRes = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
      headers: {
        Authorization: `Bot ${token}`,
      },
    });

    if (!guildsRes.ok) {
      const errText = await guildsRes.text();
      return NextResponse.json(
        { error: `Failed to fetch guilds: ${guildsRes.status} ${errText}` },
        { status: 500 }
      );
    }

    const guildsData: DiscordGuild[] = await guildsRes.json();
    const guildsWithChannels: GuildInfo[] = [];

    // Fetch channels for each guild
    for (const guild of guildsData) {
      try {
        const channelsRes = await fetch(`${DISCORD_API_BASE}/guilds/${guild.id}/channels`, {
          headers: {
            Authorization: `Bot ${token}`,
          },
        });

        if (channelsRes.ok) {
          const channelsData: DiscordChannel[] = await channelsRes.json();

          // Filter to text channels only (type 0 = GUILD_TEXT)
          const textChannels = channelsData
            .filter(ch => ch.type === 0)
            .map(ch => ({
              id: ch.id,
              name: ch.name,
              type: "text",
            }));

          guildsWithChannels.push({
            id: guild.id,
            name: guild.name,
            channels: textChannels,
          });
        }
      } catch (err) {
        console.error(`Failed to fetch channels for guild ${guild.id}:`, err);
        // Still include the guild, just without channels
        guildsWithChannels.push({
          id: guild.id,
          name: guild.name,
          channels: [],
        });
      }
    }

    return NextResponse.json({
      guilds: guildsWithChannels,
    });
  } catch (error: unknown) {
    console.error("Error fetching Discord guilds:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch Discord guilds";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
