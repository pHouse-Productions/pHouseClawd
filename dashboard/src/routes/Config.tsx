import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authFetch } from "@/lib/auth";

function ApiKeyField({
  label,
  currentValue,
  envKey,
  onSave,
  saving,
  placeholder,
}: {
  label: string;
  currentValue?: string;
  envKey: string;
  onSave: (key: string, value: string) => Promise<void>;
  saving: string | null;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const handleSave = async () => {
    await onSave(envKey, value);
    setEditing(false);
    setValue("");
  };

  const handleCancel = () => {
    setEditing(false);
    setValue("");
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <label className="text-sm text-zinc-400 block">{label}</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={handleSave}
            disabled={saving === envKey || !value.trim()}
            className="px-3 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {saving === envKey ? "..." : "Save"}
          </button>
          <button
            onClick={handleCancel}
            className="px-3 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm text-zinc-400">{label}</span>
        <p className="text-xs text-zinc-600">{currentValue || "Not set"}</p>
      </div>
      <button
        onClick={() => setEditing(true)}
        className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
      >
        {currentValue ? "Change" : "Set"}
      </button>
    </div>
  );
}

interface MemorySettings {
  shortTermSizeThreshold: number;
  chunkSizeBytes: number;
  longTermFileMaxSize: number;
}

interface ChannelsConfig {
  global: {
    maxConcurrentJobs: number;
  };
  channels: Record<string, { enabled: boolean }>;
}

export default function Config() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<any>(null);
  const [searchParams] = useSearchParams();
  const oauthSuccess = searchParams.get("oauth_success");
  const oauthError = searchParams.get("oauth_error");

  // Editable state
  const [memorySettings, setMemorySettings] = useState<MemorySettings>({
    shortTermSizeThreshold: 51200,
    chunkSizeBytes: 25600,
    longTermFileMaxSize: 30720,
  });
  const [maxConcurrentJobs, setMaxConcurrentJobs] = useState(2);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await authFetch("/api/config");
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
          if (data.memorySettings) {
            setMemorySettings(data.memorySettings);
          }
          if (data.channels?.global?.maxConcurrentJobs) {
            setMaxConcurrentJobs(data.channels.global.maxConcurrentJobs);
          }
        }
      } catch (err) {
        console.error("Failed to fetch config:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const saveMemorySettings = async () => {
    setSaving("memory");
    setMessage(null);
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "memorySettings", data: memorySettings }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Saved!" });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save" });
    } finally {
      setSaving(null);
    }
  };

  const saveMaxConcurrentJobs = async () => {
    setSaving("jobs");
    setMessage(null);
    try {
      // Merge with existing channels config
      const channelsConfig: ChannelsConfig = config?.channels || {
        global: { maxConcurrentJobs: 2 },
        channels: {},
      };
      channelsConfig.global.maxConcurrentJobs = maxConcurrentJobs;

      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "channels", data: channelsConfig }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Saved!" });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save" });
    } finally {
      setSaving(null);
    }
  };

  const formatKB = (bytes: number) => Math.round(bytes / 1024);
  const toBytes = (kb: number) => kb * 1024;

  const saveEnvKey = async (key: string, value: string) => {
    setSaving(key);
    setMessage(null);
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "env", key, value }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Saved!" });
        // Refresh config to show updated masked value
        const configRes = await authFetch("/api/config");
        if (configRes.ok) {
          setConfig(await configRes.json());
        }
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to save" });
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading config...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Configuration</h2>
        <p className="text-zinc-500 mt-1">System settings and API keys</p>
      </div>

      {oauthSuccess && (
        <div className="bg-green-600/20 border border-green-600/30 rounded-lg p-4 text-green-400">
          {oauthSuccess}
        </div>
      )}

      {oauthError && (
        <div className="bg-red-600/20 border border-red-600/30 rounded-lg p-4 text-red-400">
          {oauthError}
        </div>
      )}

      {message && (
        <div
          className={`p-3 rounded-lg ${
            message.type === "success"
              ? "bg-green-600/20 text-green-400"
              : "bg-red-600/20 text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-4">
        {/* System Settings */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">System Settings</h3>
            <button
              onClick={saveMaxConcurrentJobs}
              disabled={saving === "jobs"}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving === "jobs" ? "Saving..." : "Save"}
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-zinc-400 block mb-2">Max Concurrent Jobs</label>
              <p className="text-xs text-zinc-500 mb-2">How many messages can be processed at once across all channels</p>
              <input
                type="number"
                min={1}
                max={10}
                value={maxConcurrentJobs}
                onChange={(e) => setMaxConcurrentJobs(parseInt(e.target.value) || 1)}
                className="w-24 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
              />
            </div>
          </div>
        </div>

        {/* Memory Settings */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white">Memory Settings</h3>
            <button
              onClick={saveMemorySettings}
              disabled={saving === "memory"}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving === "memory" ? "Saving..." : "Save"}
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-zinc-400 block mb-2">Short-term Size Threshold (KB)</label>
              <p className="text-xs text-zinc-500 mb-2">When short-term memory exceeds this, it gets auto-truncated</p>
              <input
                type="number"
                min={10}
                max={500}
                value={formatKB(memorySettings.shortTermSizeThreshold)}
                onChange={(e) => setMemorySettings({
                  ...memorySettings,
                  shortTermSizeThreshold: toBytes(parseInt(e.target.value) || 50),
                })}
                className="w-24 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-sm text-zinc-400 block mb-2">Chunk Size (KB)</label>
              <p className="text-xs text-zinc-500 mb-2">Size of each chunk when truncating short-term memory</p>
              <input
                type="number"
                min={5}
                max={100}
                value={formatKB(memorySettings.chunkSizeBytes)}
                onChange={(e) => setMemorySettings({
                  ...memorySettings,
                  chunkSizeBytes: toBytes(parseInt(e.target.value) || 25),
                })}
                className="w-24 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-sm text-zinc-400 block mb-2">Long-term File Max Size (KB)</label>
              <p className="text-xs text-zinc-500 mb-2">Maximum size for individual long-term memory files</p>
              <input
                type="number"
                min={10}
                max={200}
                value={formatKB(memorySettings.longTermFileMaxSize)}
                onChange={(e) => setMemorySettings({
                  ...memorySettings,
                  longTermFileMaxSize: toBytes(parseInt(e.target.value) || 30),
                })}
                className="w-24 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-zinc-600"
              />
            </div>
          </div>
        </div>

        {/* Google OAuth */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h3 className="font-semibold text-white mb-2">Google OAuth</h3>
          <p className="text-sm text-zinc-400 mb-3">
            Status: {config?.googleToken?.status || "unknown"}
          </p>
          <a
            href="/api/oauth/google/start"
            className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Connect Google Account
          </a>
        </div>

        {/* CLAUDE.md */}
        <Link
          to="/config/claude-md"
          className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:bg-zinc-800/50 transition-colors block"
        >
          <h3 className="font-semibold text-white mb-2">CLAUDE.md</h3>
          <p className="text-sm text-zinc-400">Edit the system instructions</p>
        </Link>

        {/* API Keys */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <h3 className="font-semibold text-white mb-4">API Keys</h3>
          <div className="space-y-4">
            <ApiKeyField
              label="Telegram Bot Token"
              currentValue={config?.telegram?.TELEGRAM_BOT_TOKEN}
              envKey="TELEGRAM_BOT_TOKEN"
              onSave={saveEnvKey}
              saving={saving}
              placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
            />
            <ApiKeyField
              label="Discord Bot Token"
              currentValue={config?.discord?.DISCORD_BOT_TOKEN}
              envKey="DISCORD_BOT_TOKEN"
              onSave={saveEnvKey}
              saving={saving}
              placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4OQ..."
            />
            <ApiKeyField
              label="OpenRouter API Key"
              currentValue={config?.ai?.OPENROUTER_API_KEY}
              envKey="OPENROUTER_API_KEY"
              onSave={saveEnvKey}
              saving={saving}
              placeholder="sk-or-v1-..."
            />
            <ApiKeyField
              label="Google Places API Key"
              currentValue={config?.google?.GOOGLE_PLACES_API_KEY}
              envKey="GOOGLE_PLACES_API_KEY"
              onSave={saveEnvKey}
              saving={saving}
              placeholder="AIzaSy..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
