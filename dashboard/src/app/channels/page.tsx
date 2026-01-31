"use client";

import { useEffect, useState, ReactNode } from "react";
import { authFetch } from "@/lib/auth";

// =============================================================================
// TYPES
// =============================================================================

interface ConfigSchema {
  label: string;
  description: string;
  howToGet: string;
  required?: boolean;
  sensitive?: boolean;
}

interface ConfigData {
  schema: {
    telegram: Record<string, ConfigSchema>;
    discord: Record<string, ConfigSchema>;
    google: Record<string, ConfigSchema>;
    ai: Record<string, ConfigSchema>;
    dashboard: Record<string, ConfigSchema>;
    googleCredentials: ConfigSchema;
    googleToken: ConfigSchema;
  };
  telegram: Record<string, string>;
  discord: Record<string, string>;
  google: Record<string, string>;
  ai: Record<string, string>;
  dashboard: Record<string, string>;
  googleCredentials: {
    status: "configured" | "not_configured";
    raw: string;
  };
  googleToken: {
    status: "configured" | "expired" | "not_configured";
    expiry: string;
    raw: string;
  };
  channels: {
    channels: Record<string, { enabled: boolean }>;
  } | null;
  emailSecurity: {
    trustedEmailAddresses: string[];
    forwardUntrustedTo: string[];
  } | null;
  gchatSecurity: {
    allowedSpaces: string[];
    myUserId: string;
  } | null;
  discordSecurity: {
    allowedChannels: string[];
    allowedGuilds: string[];
    myUserId: string | null;
    userNames: Record<string, string>;
  } | null;
  claudeMd: string;
}

interface SessionSettings {
  modes: Record<string, string>;
  queueModes: Record<string, string>;
  transcriptLines: Record<string, number>;
  responseStyles: Record<string, string>;
}

// =============================================================================
// REUSABLE COMPONENTS
// =============================================================================

/**
 * A single channel section with:
 * - Toggle switch (on/off)
 * - Custom config area (channel-specific)
 * - Session settings (memory mode, queue mode)
 * - Optional setup instructions
 */
function ChannelSection({
  channelKey,
  displayName,
  enabled,
  canEnable,
  disableReason,
  onToggle,
  setupInstructions,
  children,
  sessionKey,
  sessionSettings,
  onSaveSessionSetting,
  setSessionSettings,
}: {
  channelKey: string;
  displayName: string;
  enabled: boolean;
  canEnable: boolean;
  disableReason?: string;
  onToggle: () => void;
  setupInstructions?: ReactNode;
  children?: ReactNode;
  sessionKey: string | null;
  sessionSettings: SessionSettings | null;
  onSaveSessionSetting: (type: string, channel: string, value: string | number) => Promise<void>;
  setSessionSettings: React.Dispatch<React.SetStateAction<SessionSettings | null>>;
}) {
  return (
    <div className="border-b border-zinc-800 last:border-0 py-4 first:pt-0 last:pb-0">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium">{displayName}</span>
          {!canEnable && (
            <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
              {disableReason}
            </span>
          )}
        </div>
        <button
          onClick={onToggle}
          disabled={!canEnable && !enabled}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            enabled ? "bg-green-600" : "bg-zinc-700"
          } ${!canEnable && !enabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <div
            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Channel-specific content (always shown for config, expanded when enabled) */}
      {children && (
        <div className="mt-4 space-y-4">
          {children}
        </div>
      )}

      {/* Setup instructions (when enabled) */}
      {enabled && setupInstructions && (
        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-200">
          {setupInstructions}
        </div>
      )}

      {/* Session settings (when enabled and session key exists) */}
      {enabled && sessionKey && sessionSettings && (
        <SessionSettingsPanel
          sessionKey={sessionKey}
          sessionSettings={sessionSettings}
          onSaveSessionSetting={onSaveSessionSetting}
          setSessionSettings={setSessionSettings}
          channelKey={channelKey}
        />
      )}
    </div>
  );
}

/**
 * Session settings panel with memory mode, queue mode, and transcript lines
 */
function SessionSettingsPanel({
  sessionKey,
  sessionSettings,
  onSaveSessionSetting,
  setSessionSettings,
  channelKey,
}: {
  sessionKey: string;
  sessionSettings: SessionSettings;
  onSaveSessionSetting: (type: string, channel: string, value: string | number) => Promise<void>;
  setSessionSettings: React.Dispatch<React.SetStateAction<SessionSettings | null>>;
  channelKey: string;
}) {
  const memoryMode = sessionSettings.modes[sessionKey] || "session";
  const queueMode = sessionSettings.queueModes[sessionKey] || "interrupt";
  const transcriptLines = sessionSettings.transcriptLines[sessionKey] || 100;

  // Default response styles: streaming for real-time channels, final for email
  const defaultResponseStyle = channelKey === "email" ? "final" : "streaming";
  const responseStyle = sessionSettings.responseStyles[sessionKey] || defaultResponseStyle;

  return (
    <div className="mt-4 pt-4 border-t border-zinc-700">
      <label className="text-zinc-400 text-xs font-medium block mb-3">Session Settings</label>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Memory Mode */}
        <div>
          <label className="text-zinc-500 text-xs block mb-2">Memory Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => onSaveSessionSetting("memoryMode", sessionKey, "session")}
              className={`px-3 py-1.5 text-sm rounded ${
                memoryMode === "session"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              Session
            </button>
            <button
              onClick={() => onSaveSessionSetting("memoryMode", sessionKey, "transcript")}
              className={`px-3 py-1.5 text-sm rounded ${
                memoryMode === "transcript"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              Transcript
            </button>
          </div>
          <p className="text-zinc-500 text-xs mt-1">
            {memoryMode === "session"
              ? "Full conversation context within session"
              : "Each message is fresh but sees recent history"}
          </p>
        </div>

        {/* Queue Mode */}
        <div>
          <label className="text-zinc-500 text-xs block mb-2">Queue Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => onSaveSessionSetting("queueMode", sessionKey, "interrupt")}
              className={`px-3 py-1.5 text-sm rounded ${
                queueMode === "interrupt"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              Interrupt
            </button>
            <button
              onClick={() => onSaveSessionSetting("queueMode", sessionKey, "queue")}
              className={`px-3 py-1.5 text-sm rounded ${
                queueMode === "queue"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              Queue
            </button>
          </div>
          <p className="text-zinc-500 text-xs mt-1">
            {queueMode === "interrupt"
              ? "New messages interrupt current job"
              : "Messages queue up in order"}
          </p>
        </div>

        {/* Response Style */}
        <div>
          <label className="text-zinc-500 text-xs block mb-2">Response Style</label>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => onSaveSessionSetting("responseStyle", sessionKey, "streaming")}
              className={`px-3 py-1.5 text-sm rounded ${
                responseStyle === "streaming"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              Streaming
            </button>
            <button
              onClick={() => onSaveSessionSetting("responseStyle", sessionKey, "bundled")}
              className={`px-3 py-1.5 text-sm rounded ${
                responseStyle === "bundled"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              Bundled
            </button>
            <button
              onClick={() => onSaveSessionSetting("responseStyle", sessionKey, "final")}
              className={`px-3 py-1.5 text-sm rounded ${
                responseStyle === "final"
                  ? "bg-green-600 text-white"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              Final
            </button>
          </div>
          <p className="text-zinc-500 text-xs mt-1">
            {responseStyle === "streaming"
              ? "Updates sent as they arrive"
              : responseStyle === "bundled"
              ? "All updates in one message when done"
              : "Only the final response is sent"}
          </p>
        </div>
      </div>

      {/* Transcript Lines (only show when in transcript mode) */}
      {memoryMode === "transcript" && (
        <div className="mt-4">
          <label className="text-zinc-500 text-xs block mb-2">
            Transcript Context Lines
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="10"
              max="500"
              step="10"
              value={transcriptLines}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                setSessionSettings({
                  ...sessionSettings,
                  transcriptLines: { ...sessionSettings.transcriptLines, [sessionKey]: value },
                });
              }}
              onMouseUp={(e) => {
                const value = parseInt((e.target as HTMLInputElement).value, 10);
                onSaveSessionSetting("transcriptLines", sessionKey, value);
              }}
              onTouchEnd={(e) => {
                const value = parseInt((e.target as HTMLInputElement).value, 10);
                onSaveSessionSetting("transcriptLines", sessionKey, value);
              }}
              className="flex-1 h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-green-600"
            />
            <span className="text-white text-sm font-mono w-12 text-right">{transcriptLines}</span>
          </div>
          <p className="text-zinc-500 text-xs mt-1">
            Number of recent messages included as context (10-500)
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Bot token input with edit/save functionality
 */
function BotTokenInput({
  label,
  envKey,
  currentValue,
  schema,
  onSave,
}: {
  label: string;
  envKey: string;
  currentValue: string;
  schema?: ConfigSchema;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Check if value is actually configured (not empty and not a placeholder pattern)
  const isPlaceholder = currentValue && (
    currentValue.includes("your_") ||
    currentValue.includes("...here") ||
    currentValue.startsWith("your_")
  );
  const isConfigured = currentValue && currentValue !== "" && !isPlaceholder;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(envKey, inputValue);
      setEditing(false);
      setInputValue("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-zinc-300 text-sm">{label}</span>
            {isConfigured ? (
              <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/20 text-green-400 border border-green-500/30">
                Configured
              </span>
            ) : (
              <span className="px-1.5 py-0.5 text-xs rounded bg-zinc-500/20 text-zinc-400 border border-zinc-500/30">
                Not Set
              </span>
            )}
          </div>
          {schema?.description && (
            <p className="text-zinc-500 text-xs mt-1">{schema.description}</p>
          )}
          <div className="mt-2">
            {editing ? (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={`Enter ${label}`}
                  className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded disabled:opacity-50"
                >
                  {saving ? "..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditing(false);
                    setInputValue("");
                  }}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <code className="px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-400 font-mono">
                  {currentValue || "(not set)"}
                </code>
                <button
                  onClick={() => setEditing(true)}
                  className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  {isConfigured ? "Update" : "Add"}
                </button>
              </div>
            )}
          </div>
        </div>
        {schema?.howToGet && (
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-1 text-zinc-500 hover:text-white flex-shrink-0"
            title="How to get this"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        )}
      </div>
      {showHelp && schema?.howToGet && (
        <div className="mt-3 p-3 bg-zinc-800/50 rounded text-xs text-zinc-400 whitespace-pre-wrap">
          {schema.howToGet}
        </div>
      )}
    </div>
  );
}

/**
 * Email list editor for trusted senders / forward addresses
 */
function EmailListEditor({
  label,
  description,
  emails,
  onSave,
}: {
  label: string;
  description: string;
  emails: string[];
  onSave: (emails: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(emails.join("\n"));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const newEmails = inputValue
        .split("\n")
        .map((e) => e.trim())
        .filter((e) => e.includes("@"));
      await onSave(newEmails);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="text-zinc-400 text-xs font-medium">{label}</label>
      <p className="text-zinc-500 text-xs mt-1 mb-2">{description}</p>

      {!editing ? (
        <div>
          <div className="space-y-1">
            {emails.length === 0 ? (
              <p className="text-zinc-500 text-sm">No emails configured</p>
            ) : (
              emails.map((email) => (
                <div key={email} className="px-2 py-1 bg-zinc-800 rounded text-sm text-zinc-300 font-mono">
                  {email}
                </div>
              ))
            )}
          </div>
          <button
            onClick={() => {
              setInputValue(emails.join("\n"));
              setEditing(true);
            }}
            className="mt-2 px-3 py-1 text-sm text-blue-400 hover:text-blue-300"
          >
            Edit
          </button>
        </div>
      ) : (
        <div>
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="One email per line"
            rows={4}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 font-mono"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-sm rounded disabled:opacity-50"
            >
              {saving ? "..." : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Google Chat space selector
 */
function GChatSpaceSelector({
  config,
  onSave,
}: {
  config: { allowedSpaces: string[]; myUserId: string };
  onSave: (config: { allowedSpaces: string[]; myUserId: string }) => Promise<void>;
}) {
  const [spaces, setSpaces] = useState<{ name: string; displayName: string; type: string }[]>([]);
  const [detectedUserId, setDetectedUserId] = useState<string | null>(null);
  const [selectedSpaces, setSelectedSpaces] = useState<Set<string>>(new Set(config.allowedSpaces));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSpaces = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/gchat/spaces");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setSpaces(data.spaces || []);
        if (data.myUserId && !config.myUserId) {
          setDetectedUserId(data.myUserId);
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSpaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSpace = (spaceName: string) => {
    const newSelected = new Set(selectedSpaces);
    if (newSelected.has(spaceName)) {
      newSelected.delete(spaceName);
    } else {
      newSelected.add(spaceName);
    }
    setSelectedSpaces(newSelected);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        allowedSpaces: Array.from(selectedSpaces),
        myUserId: detectedUserId || config.myUserId || "",
      });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    JSON.stringify(Array.from(selectedSpaces).sort()) !== JSON.stringify(config.allowedSpaces.sort()) ||
    (detectedUserId && detectedUserId !== config.myUserId);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-zinc-400 text-xs font-medium">Available Spaces</label>
          <button
            onClick={fetchSpaces}
            disabled={loading}
            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 mb-2">
            {error}
          </div>
        )}

        {spaces.length === 0 && !loading && !error && (
          <p className="text-zinc-500 text-sm">No spaces found. Make sure Google Chat is enabled and you have conversations.</p>
        )}

        <div className="space-y-1 max-h-48 overflow-y-auto">
          {spaces.map((space) => (
            <label
              key={space.name}
              className="flex items-center gap-3 p-2 bg-zinc-800 rounded cursor-pointer hover:bg-zinc-750"
            >
              <input
                type="checkbox"
                checked={selectedSpaces.has(space.name!)}
                onChange={() => toggleSpace(space.name!)}
                className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-green-500 focus:ring-green-500 focus:ring-offset-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{space.displayName}</div>
                <div className="text-xs text-zinc-500 font-mono truncate">{space.name}</div>
              </div>
              <span className="text-xs text-zinc-500 capitalize">
                {space.type?.toLowerCase().replace("_", " ")}
              </span>
            </label>
          ))}
        </div>
      </div>

      {(detectedUserId || config.myUserId) && (
        <div>
          <label className="text-zinc-400 text-xs font-medium">Assistant&apos;s User ID</label>
          <div className="mt-1 px-2 py-1 bg-zinc-800 rounded text-sm text-zinc-300 font-mono">
            {detectedUserId || config.myUserId}
            {detectedUserId && !config.myUserId && (
              <span className="ml-2 text-xs text-green-400">(auto-detected)</span>
            )}
          </div>
        </div>
      )}

      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      )}
    </div>
  );
}

/**
 * Discord channel selector
 */
function DiscordChannelSelector({
  config,
  onSave,
}: {
  config: { allowedChannels: string[]; allowedGuilds: string[]; autoIncludeNewChannels?: boolean; myUserId: string | null; userNames: Record<string, string> };
  onSave: (config: { allowedChannels: string[]; allowedGuilds: string[]; autoIncludeNewChannels?: boolean; myUserId: string | null; userNames: Record<string, string> }) => Promise<void>;
}) {
  const [guilds, setGuilds] = useState<{ id: string; name: string; channels: { id: string; name: string; type: string }[] }[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set(config.allowedChannels));
  const [selectedGuilds, setSelectedGuilds] = useState<Set<string>>(new Set(config.allowedGuilds));
  const [autoInclude, setAutoInclude] = useState(config.autoIncludeNewChannels ?? false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchGuilds = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/discord/guilds");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setGuilds(data.guilds || []);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGuilds();
  }, []);

  const toggleChannel = (channelId: string, guildId: string) => {
    const newSelectedChannels = new Set(selectedChannels);
    const newSelectedGuilds = new Set(selectedGuilds);

    if (newSelectedChannels.has(channelId)) {
      newSelectedChannels.delete(channelId);
      // Check if any other channels from this guild are still selected
      const guild = guilds.find(g => g.id === guildId);
      const hasOtherChannels = guild?.channels.some(ch => ch.id !== channelId && newSelectedChannels.has(ch.id));
      if (!hasOtherChannels) {
        newSelectedGuilds.delete(guildId);
      }
    } else {
      newSelectedChannels.add(channelId);
      newSelectedGuilds.add(guildId);
    }

    setSelectedChannels(newSelectedChannels);
    setSelectedGuilds(newSelectedGuilds);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        allowedChannels: Array.from(selectedChannels),
        allowedGuilds: Array.from(selectedGuilds),
        autoIncludeNewChannels: autoInclude,
        myUserId: config.myUserId,
        userNames: config.userNames,
      });
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    JSON.stringify(Array.from(selectedChannels).sort()) !== JSON.stringify(config.allowedChannels.sort()) ||
    JSON.stringify(Array.from(selectedGuilds).sort()) !== JSON.stringify(config.allowedGuilds.sort()) ||
    autoInclude !== (config.autoIncludeNewChannels ?? false);

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-zinc-400 text-xs font-medium">Available Servers & Channels</label>
          <button
            onClick={fetchGuilds}
            disabled={loading}
            className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400 mb-2">
            {error}
          </div>
        )}

        {guilds.length === 0 && !loading && !error && (
          <p className="text-zinc-500 text-sm">No servers found. Make sure the bot is invited to a server and has proper permissions.</p>
        )}

        {guilds.length > 0 && (
          <label className="flex items-center gap-3 p-2 bg-zinc-800 rounded cursor-pointer hover:bg-zinc-750 mb-2">
            <input
              type="checkbox"
              checked={autoInclude}
              onChange={(e) => setAutoInclude(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-green-500 focus:ring-green-500 focus:ring-offset-0"
            />
            <div className="flex-1">
              <div className="text-sm text-zinc-300">Auto-include new channels</div>
              <div className="text-xs text-zinc-500">When enabled, any new channel added to these servers will automatically be monitored</div>
            </div>
          </label>
        )}

        <div className="space-y-3 max-h-64 overflow-y-auto">
          {guilds.map((guild) => (
            <div key={guild.id} className="bg-zinc-800 rounded p-2">
              <div className="text-sm text-white font-medium mb-2">{guild.name}</div>
              <div className="space-y-1 pl-2">
                {guild.channels.map((channel) => (
                  <label
                    key={channel.id}
                    className="flex items-center gap-3 p-1.5 bg-zinc-750 rounded cursor-pointer hover:bg-zinc-700"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannels.has(channel.id)}
                      onChange={() => toggleChannel(channel.id, guild.id)}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-green-500 focus:ring-green-500 focus:ring-offset-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-300">#{channel.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">{channel.id}</div>
                    </div>
                  </label>
                ))}
                {guild.channels.length === 0 && (
                  <p className="text-zinc-500 text-xs">No text channels found</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      )}
    </div>
  );
}

// =============================================================================
// CHANNEL-SPECIFIC CONFIG COMPONENTS
// =============================================================================

function TelegramConfig({
  config,
  onSaveEnvVar,
}: {
  config: ConfigData;
  onSaveEnvVar: (key: string, value: string) => Promise<void>;
}) {
  return (
    <BotTokenInput
      label="Bot Token"
      envKey="TELEGRAM_BOT_TOKEN"
      currentValue={config.telegram.TELEGRAM_BOT_TOKEN || ""}
      schema={config.schema.telegram.TELEGRAM_BOT_TOKEN}
      onSave={onSaveEnvVar}
    />
  );
}

function EmailConfig({
  config,
  onSaveEmailSecurity,
}: {
  config: ConfigData;
  onSaveEmailSecurity: (security: { trustedEmailAddresses: string[]; forwardUntrustedTo: string[] }) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <EmailListEditor
        label="Trusted Senders"
        description="Emails from these addresses will be processed and replied to directly."
        emails={config.emailSecurity?.trustedEmailAddresses || []}
        onSave={(emails) =>
          onSaveEmailSecurity({
            trustedEmailAddresses: emails,
            forwardUntrustedTo: config.emailSecurity?.forwardUntrustedTo || [],
          })
        }
      />
      <EmailListEditor
        label="Forward Untrusted To"
        description="Emails from untrusted senders will be forwarded to these addresses."
        emails={config.emailSecurity?.forwardUntrustedTo || []}
        onSave={(emails) =>
          onSaveEmailSecurity({
            trustedEmailAddresses: config.emailSecurity?.trustedEmailAddresses || [],
            forwardUntrustedTo: emails,
          })
        }
      />
    </div>
  );
}

function GChatConfig({
  config,
  onSaveGchatSecurity,
}: {
  config: ConfigData;
  onSaveGchatSecurity: (security: { allowedSpaces: string[]; myUserId: string }) => Promise<void>;
}) {
  return (
    <GChatSpaceSelector
      config={config.gchatSecurity || { allowedSpaces: [], myUserId: "" }}
      onSave={onSaveGchatSecurity}
    />
  );
}

function DiscordConfig({
  config,
  onSaveEnvVar,
  onSaveDiscordSecurity,
  enabled,
}: {
  config: ConfigData;
  onSaveEnvVar: (key: string, value: string) => Promise<void>;
  onSaveDiscordSecurity: (security: { allowedChannels: string[]; allowedGuilds: string[]; myUserId: string | null; userNames: Record<string, string> }) => Promise<void>;
  enabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <BotTokenInput
        label="Bot Token"
        envKey="DISCORD_BOT_TOKEN"
        currentValue={config.discord?.DISCORD_BOT_TOKEN || ""}
        schema={config.schema.discord?.DISCORD_BOT_TOKEN}
        onSave={onSaveEnvVar}
      />
      {enabled && (
        <DiscordChannelSelector
          config={config.discordSecurity || { allowedChannels: [], allowedGuilds: [], myUserId: null, userNames: {} }}
          onSave={onSaveDiscordSecurity}
        />
      )}
    </div>
  );
}

// =============================================================================
// MAIN PAGE COMPONENT
// =============================================================================

export default function ChannelsPage() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [sessionSettings, setSessionSettings] = useState<SessionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchConfig = async () => {
    try {
      const res = await authFetch("/api/config");
      const data = await res.json();
      setConfig(data);
    } catch (err) {
      console.error("Failed to fetch config:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionSettings = async () => {
    try {
      const res = await authFetch("/api/sessions");
      const data = await res.json();
      setSessionSettings(data);
    } catch (err) {
      console.error("Failed to fetch session settings:", err);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchSessionSettings();
  }, []);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // Save handlers
  const saveChannels = async (channels: Record<string, { enabled: boolean }>) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "channels", data: { channels } }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("success", data.message);
        fetchConfig();
      } else {
        showMessage("error", data.error || "Failed to save");
      }
    } catch (err) {
      showMessage("error", String(err));
    }
  };

  const saveEnvVar = async (key: string, value: string) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "env", key, value }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("success", data.message);
        fetchConfig();
      } else {
        showMessage("error", data.error || "Failed to save");
      }
    } catch (err) {
      showMessage("error", String(err));
    }
  };

  const saveEmailSecurity = async (emailSecurity: { trustedEmailAddresses: string[]; forwardUntrustedTo: string[] }) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "emailSecurity", data: emailSecurity }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("success", data.message);
        fetchConfig();
      } else {
        showMessage("error", data.error || "Failed to save");
      }
    } catch (err) {
      showMessage("error", String(err));
    }
  };

  const saveGchatSecurity = async (gchatSecurity: { allowedSpaces: string[]; myUserId: string }) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "gchatSecurity", data: gchatSecurity }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("success", data.message);
        fetchConfig();
      } else {
        showMessage("error", data.error || "Failed to save");
      }
    } catch (err) {
      showMessage("error", String(err));
    }
  };

  const saveDiscordSecurity = async (discordSecurity: { allowedChannels: string[]; allowedGuilds: string[]; myUserId: string | null; userNames: Record<string, string> }) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "discordSecurity", data: discordSecurity }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("success", data.message);
        fetchConfig();
      } else {
        showMessage("error", data.error || "Failed to save");
      }
    } catch (err) {
      showMessage("error", String(err));
    }
  };

  const saveSessionSetting = async (type: string, channel: string, value: string | number) => {
    try {
      const res = await authFetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, channel, value }),
      });
      const data = await res.json();
      if (data.success) {
        showMessage("success", data.message);
        fetchSessionSettings();
      } else {
        showMessage("error", data.error || "Failed to save");
      }
    } catch (err) {
      showMessage("error", String(err));
    }
  };

  // Helper functions
  const getChannelDisplayName = (channel: string) => {
    switch (channel) {
      case "telegram": return "Telegram";
      case "email": return "Email";
      case "gchat": return "Google Chat";
      case "discord": return "Discord";
      case "dashboard": return "Dashboard Chat";
      default: return channel.charAt(0).toUpperCase() + channel.slice(1);
    }
  };

  // Check if a value is a placeholder (not a real configured value)
  const isPlaceholderValue = (value: string | undefined) => {
    if (!value) return true;
    return value.includes("your_") || value.includes("...here") || value.startsWith("your_");
  };

  const canEnableChannel = (channel: string) => {
    // Accept both "configured" and "expired" - expired tokens can be auto-refreshed via refresh_token
    const googleAuthConfigured = config?.googleToken.status === "configured" || config?.googleToken.status === "expired";
    const telegramConfigured = config?.telegram.TELEGRAM_BOT_TOKEN && !isPlaceholderValue(config.telegram.TELEGRAM_BOT_TOKEN);
    const discordConfigured = config?.discord?.DISCORD_BOT_TOKEN && !isPlaceholderValue(config.discord.DISCORD_BOT_TOKEN);

    if (channel === "email" || channel === "gchat") {
      if (!googleAuthConfigured) {
        return { canEnable: false, reason: "Google OAuth token required" };
      }
    } else if (channel === "telegram") {
      if (!telegramConfigured) {
        return { canEnable: false, reason: "Bot token required" };
      }
    } else if (channel === "discord") {
      if (!discordConfigured) {
        return { canEnable: false, reason: "Bot token required" };
      }
    } else if (channel === "dashboard") {
      // Dashboard is always enableable - it's built into the app
      return { canEnable: true, reason: "" };
    }
    return { canEnable: true, reason: "" };
  };

  const getSessionKeyForChannel = (channel: string): string | null => {
    if (!sessionSettings) return null;
    // Find all session keys that match this channel
    const matchingKeys = Object.keys(sessionSettings.modes).filter(key => {
      const baseChannel = key.includes('-') ? key.split('-')[0] : key;
      return baseChannel === channel;
    });

    if (matchingKeys.length > 0) {
      // Prefer the more specific key (e.g., "dashboard-default" over "dashboard")
      // Sort by length descending so more specific keys come first
      matchingKeys.sort((a, b) => b.length - a.length);
      return matchingKeys[0];
    }

    // For enabled channels without a session yet, return a default key
    // This allows users to pre-configure settings before their first message
    const channelEnabled = channels[channel]?.enabled;
    if (channelEnabled) {
      // For dashboard, use the actual session key format the watcher uses
      if (channel === "dashboard") {
        return "dashboard-default";
      }
      // Use the base channel name as the default key
      // The watcher will match this or create a more specific one on first message
      return channel;
    }
    return null;
  };

  const toggleChannel = (channel: string, currentEnabled: boolean) => {
    const { canEnable } = canEnableChannel(channel);
    if (!canEnable && !currentEnabled) return;

    const newChannels = { ...config!.channels!.channels };
    newChannels[channel] = { enabled: !currentEnabled };
    saveChannels(newChannels);
  };

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Channels</h2>
          <p className="text-zinc-500 mt-1">Communication channels and session settings</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (!config) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Channels</h2>
          <p className="text-zinc-500 mt-1">Communication channels and session settings</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-red-400">Failed to load configuration</p>
        </div>
      </div>
    );
  }

  // Channel definitions
  const channels = config.channels?.channels || {};

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Channels</h2>
        <p className="text-zinc-500 mt-1">Communication channels and session settings</p>
      </div>

      {/* Toast Message */}
      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.type === "success"
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-red-500/20 text-red-400 border border-red-500/30"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Channel Sections */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-white">Communication Channels</h3>
          <p className="text-zinc-500 text-xs mt-1">Enable channels and configure their settings</p>
        </div>
        <div className="p-4">
          {/* Telegram */}
          {channels.telegram && (
            <ChannelSection
              channelKey="telegram"
              displayName={getChannelDisplayName("telegram")}
              enabled={channels.telegram.enabled}
              canEnable={canEnableChannel("telegram").canEnable}
              disableReason={canEnableChannel("telegram").reason}
              onToggle={() => toggleChannel("telegram", channels.telegram.enabled)}
              sessionKey={getSessionKeyForChannel("telegram")}
              sessionSettings={sessionSettings}
              onSaveSessionSetting={saveSessionSetting}
              setSessionSettings={setSessionSettings}
            >
              <TelegramConfig config={config} onSaveEnvVar={saveEnvVar} />
            </ChannelSection>
          )}

          {/* Email */}
          {channels.email && (
            <ChannelSection
              channelKey="email"
              displayName={getChannelDisplayName("email")}
              enabled={channels.email.enabled}
              canEnable={canEnableChannel("email").canEnable}
              disableReason={canEnableChannel("email").reason}
              onToggle={() => toggleChannel("email", channels.email.enabled)}
              sessionKey={getSessionKeyForChannel("email")}
              sessionSettings={sessionSettings}
              onSaveSessionSetting={saveSessionSetting}
              setSessionSettings={setSessionSettings}
            >
              {channels.email.enabled && (
                <EmailConfig config={config} onSaveEmailSecurity={saveEmailSecurity} />
              )}
            </ChannelSection>
          )}

          {/* Google Chat */}
          {channels.gchat && (
            <ChannelSection
              channelKey="gchat"
              displayName={getChannelDisplayName("gchat")}
              enabled={channels.gchat.enabled}
              canEnable={canEnableChannel("gchat").canEnable}
              disableReason={canEnableChannel("gchat").reason}
              onToggle={() => toggleChannel("gchat", channels.gchat.enabled)}
              setupInstructions={
                <>
                  <p className="font-medium mb-1">Setup required (on the assistant&apos;s Google account):</p>
                  <ol className="list-decimal list-inside space-y-1 text-yellow-200/80">
                    <li>Log into the assistant&apos;s Google account and enable Google Chat in Workspace settings</li>
                    <li>From your own account, send a message to the assistant - you&apos;ll need to accept a prompt in the Google Chat UI to start the conversation</li>
                    <li>Select the spaces below that the assistant should listen to</li>
                  </ol>
                </>
              }
              sessionKey={getSessionKeyForChannel("gchat")}
              sessionSettings={sessionSettings}
              onSaveSessionSetting={saveSessionSetting}
              setSessionSettings={setSessionSettings}
            >
              {channels.gchat.enabled && (
                <GChatConfig config={config} onSaveGchatSecurity={saveGchatSecurity} />
              )}
            </ChannelSection>
          )}

          {/* Discord */}
          {channels.discord && (
            <ChannelSection
              channelKey="discord"
              displayName={getChannelDisplayName("discord")}
              enabled={channels.discord.enabled}
              canEnable={canEnableChannel("discord").canEnable}
              disableReason={canEnableChannel("discord").reason}
              onToggle={() => toggleChannel("discord", channels.discord.enabled)}
              setupInstructions={
                <>
                  <p className="font-medium mb-1">Setup required:</p>
                  <ol className="list-decimal list-inside space-y-1 text-yellow-200/80">
                    <li>Create a Discord bot at discord.com/developers/applications</li>
                    <li>Enable Message Content Intent in the bot settings</li>
                    <li>Invite the bot to your server with Send Messages and Read Message History permissions</li>
                    <li>Select the channels below that the assistant should listen to</li>
                  </ol>
                </>
              }
              sessionKey={getSessionKeyForChannel("discord")}
              sessionSettings={sessionSettings}
              onSaveSessionSetting={saveSessionSetting}
              setSessionSettings={setSessionSettings}
            >
              <DiscordConfig
                config={config}
                onSaveEnvVar={saveEnvVar}
                onSaveDiscordSecurity={saveDiscordSecurity}
                enabled={channels.discord.enabled}
              />
            </ChannelSection>
          )}

          {/* Dashboard Chat */}
          {channels.dashboard && (
            <ChannelSection
              channelKey="dashboard"
              displayName={getChannelDisplayName("dashboard")}
              enabled={channels.dashboard.enabled}
              canEnable={canEnableChannel("dashboard").canEnable}
              disableReason={canEnableChannel("dashboard").reason}
              onToggle={() => toggleChannel("dashboard", channels.dashboard.enabled)}
              sessionKey={getSessionKeyForChannel("dashboard")}
              sessionSettings={sessionSettings}
              onSaveSessionSetting={saveSessionSetting}
              setSessionSettings={setSessionSettings}
            >
              {channels.dashboard.enabled && (
                <p className="text-zinc-400 text-sm">
                  The dashboard chat is available in the Chat tab. Configure session settings below.
                </p>
              )}
            </ChannelSection>
          )}
        </div>
      </div>
    </div>
  );
}
