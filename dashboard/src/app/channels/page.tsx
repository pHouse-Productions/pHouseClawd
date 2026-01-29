"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";

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
    google: Record<string, ConfigSchema>;
    ai: Record<string, ConfigSchema>;
    dashboard: Record<string, ConfigSchema>;
    googleCredentials: ConfigSchema;
    googleToken: ConfigSchema;
  };
  telegram: Record<string, string>;
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
    alertTelegramChatId: number | null;
  } | null;
  gchatSecurity: {
    allowedSpaces: string[];
    myUserId: string;
  } | null;
  claudeMd: string;
}

interface SessionSettings {
  modes: Record<string, string>;
  queueModes: Record<string, string>;
  transcriptLines: Record<string, number>;
}

function ConfigSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <div className="p-4 space-y-4 overflow-x-auto">{children}</div>
    </div>
  );
}

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

  const saveEmailSecurity = async (emailSecurity: { trustedEmailAddresses: string[]; alertTelegramChatId: number | null }) => {
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

  // Get display name for a channel
  const getChannelDisplayName = (channel: string) => {
    switch (channel) {
      case "telegram": return "Telegram";
      case "email": return "Email";
      case "gchat": return "Google Chat";
      default: return channel.charAt(0).toUpperCase() + channel.slice(1);
    }
  };

  // Get display name for a session key
  const getSessionDisplayName = (sessionKey: string) => {
    // Handle keys without suffixes (like "email")
    if (!sessionKey.includes('-')) {
      return getChannelDisplayName(sessionKey);
    }
    // Handle keys with suffixes (like "telegram-5473044160" or "gchat-spaces-10n2gSAAAAE")
    const baseChannel = sessionKey.split('-')[0];
    const suffix = sessionKey.split('-').slice(1).join('-');
    const baseName = getChannelDisplayName(baseChannel);
    return `${baseName} (${suffix})`;
  };

  // Check prerequisites for each channel
  const canEnableChannel = (channel: string) => {
    const googleAuthConfigured = config.googleToken.status === "configured";
    const telegramConfigured = config.telegram.TELEGRAM_BOT_TOKEN && config.telegram.TELEGRAM_BOT_TOKEN !== "";

    if (channel === "email" || channel === "gchat") {
      if (!googleAuthConfigured) {
        return { canEnable: false, reason: "Google OAuth token required" };
      }
    } else if (channel === "telegram") {
      if (!telegramConfigured) {
        return { canEnable: false, reason: "Telegram Bot Token required" };
      }
    }
    return { canEnable: true, reason: "" };
  };

  // Get session keys for enabled channels
  const getSessionKeys = () => {
    if (!sessionSettings || !config.channels?.channels) return [];

    return Object.keys(sessionSettings.modes).filter(key => {
      // For keys like "email" (no suffix), the base channel is the key itself
      // For keys like "telegram-5473044160", the base channel is "telegram"
      const baseChannel = key.includes('-') ? key.split('-')[0] : key;
      return config.channels?.channels[baseChannel]?.enabled;
    });
  };

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

      {/* Channel Enable/Disable */}
      <ConfigSection title="Communication Channels">
        <p className="text-zinc-500 text-xs mb-4">Enable or disable communication channels</p>
        {config.channels?.channels &&
          Object.entries(config.channels.channels).map(([channel, settings]) => {
            const { canEnable, reason } = canEnableChannel(channel);

            return (
              <div key={channel} className="border-b border-zinc-800 last:border-0 py-3 first:pt-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-white">{getChannelDisplayName(channel)}</span>
                    {!canEnable && (
                      <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
                        {reason}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (!canEnable && !settings.enabled) return;
                      const newChannels = { ...config.channels!.channels };
                      newChannels[channel] = { enabled: !settings.enabled };
                      saveChannels(newChannels);
                    }}
                    disabled={!canEnable && !settings.enabled}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      settings.enabled ? "bg-green-600" : "bg-zinc-700"
                    } ${!canEnable && !settings.enabled ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <div
                      className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        settings.enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {/* Google Chat setup instructions */}
                {channel === "gchat" && settings.enabled && (
                  <div className="mt-3 space-y-3">
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded text-xs text-yellow-200">
                      <p className="font-medium mb-1">Setup required (on the assistant&apos;s Google account):</p>
                      <ol className="list-decimal list-inside space-y-1 text-yellow-200/80">
                        <li>Log into the assistant&apos;s Google account and enable Google Chat in Workspace settings</li>
                        <li>From your own account, send a message to the assistant - you&apos;ll need to accept a prompt in the Google Chat UI to start the conversation</li>
                        <li>Select the spaces below that the assistant should listen to</li>
                      </ol>
                    </div>
                    <GChatSecurityEditor
                      config={config.gchatSecurity || { allowedSpaces: [], myUserId: "" }}
                      onSave={saveGchatSecurity}
                    />
                  </div>
                )}
              </div>
            );
          })}
      </ConfigSection>

      {/* Session Settings per Channel */}
      <ConfigSection title="Session Settings">
        <p className="text-zinc-500 text-xs mb-4">Memory mode, queue behavior, and transcript settings per channel</p>
        {sessionSettings && getSessionKeys().map((sessionKey) => {
          const memoryMode = sessionSettings.modes[sessionKey] || "session";
          const queueMode = sessionSettings.queueModes[sessionKey] || "interrupt";
          const transcriptLines = sessionSettings.transcriptLines[sessionKey] || 100;

          return (
            <div key={sessionKey} className="border-b border-zinc-800 last:border-0 py-4 first:pt-0">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-white font-medium">
                  {getSessionDisplayName(sessionKey)}
                </span>
              </div>

              {/* Memory Mode */}
              <div className="mb-4">
                <label className="text-zinc-400 text-xs font-medium block mb-2">Memory Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveSessionSetting("memoryMode", sessionKey, "session")}
                    className={`px-3 py-1.5 text-sm rounded ${
                      memoryMode === "session"
                        ? "bg-green-600 text-white"
                        : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                    }`}
                  >
                    Session
                  </button>
                  <button
                    onClick={() => saveSessionSetting("memoryMode", sessionKey, "transcript")}
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
              <div className="mb-4">
                <label className="text-zinc-400 text-xs font-medium block mb-2">Queue Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveSessionSetting("queueMode", sessionKey, "interrupt")}
                    className={`px-3 py-1.5 text-sm rounded ${
                      queueMode === "interrupt"
                        ? "bg-green-600 text-white"
                        : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                    }`}
                  >
                    Interrupt
                  </button>
                  <button
                    onClick={() => saveSessionSetting("queueMode", sessionKey, "queue")}
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
                    ? "New messages interrupt and take over current job"
                    : "Messages queue up and process in order"}
                </p>
              </div>

              {/* Transcript Lines (only show when in transcript mode) */}
              {memoryMode === "transcript" && (
                <div>
                  <label className="text-zinc-400 text-xs font-medium block mb-2">
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
                        saveSessionSetting("transcriptLines", sessionKey, value);
                      }}
                      onTouchEnd={(e) => {
                        const value = parseInt((e.target as HTMLInputElement).value, 10);
                        saveSessionSetting("transcriptLines", sessionKey, value);
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
        })}
        {(!sessionSettings || getSessionKeys().length === 0) && (
          <p className="text-zinc-500 text-sm">Enable at least one channel and start a conversation to configure session settings</p>
        )}
      </ConfigSection>

      {/* Email Security */}
      <ConfigSection title="Email Security">
        <div>
          <label className="text-white text-sm font-medium">Trusted Email Addresses</label>
          <p className="text-zinc-500 text-xs mt-1 mb-2">
            Emails from these addresses will be processed directly. Others require Telegram approval.
          </p>
          <TrustedEmailsEditor
            emails={config.emailSecurity?.trustedEmailAddresses || []}
            onSave={(emails) =>
              saveEmailSecurity({
                trustedEmailAddresses: emails,
                alertTelegramChatId: config.emailSecurity?.alertTelegramChatId || null,
              })
            }
          />
        </div>
      </ConfigSection>
    </div>
  );
}

function TrustedEmailsEditor({
  emails,
  onSave,
}: {
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

  if (!editing) {
    return (
      <div>
        <div className="space-y-1">
          {emails.length === 0 ? (
            <p className="text-zinc-500 text-sm">No trusted emails configured</p>
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
    );
  }

  return (
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
  );
}

function GChatSecurityEditor({
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
