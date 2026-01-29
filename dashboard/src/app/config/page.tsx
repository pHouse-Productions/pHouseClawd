"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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

function EnvVarInput({
  name,
  schema,
  value,
  onSave,
}: {
  name: string;
  schema: ConfigSchema;
  value: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(inputValue);
      setEditing(false);
      setInputValue("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-zinc-800 pb-4 last:border-0 last:pb-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium text-sm">{schema.label}</span>
            {schema.required && <span className="text-red-400 text-xs">Required</span>}
          </div>
          <p className="text-zinc-500 text-xs mt-1">{schema.description}</p>
          <div className="mt-2">
            {editing ? (
              <div className="flex gap-2">
                <input
                  type={schema.sensitive ? "password" : "text"}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={`Enter ${schema.label}`}
                  className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
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
                  {value || "(not set)"}
                </code>
                <button
                  onClick={() => setEditing(true)}
                  className="px-2 py-1 text-xs text-blue-400 hover:text-blue-300"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="p-1 text-zinc-500 hover:text-white"
          title="How to get this"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>
      {showHelp && (
        <div className="mt-3 p-3 bg-zinc-800/50 rounded text-xs text-zinc-400 whitespace-pre-wrap">
          {schema.howToGet}
        </div>
      )}
    </div>
  );
}

function GoogleCredentialsEditor({
  schema,
  status,
  rawCredentials,
  onSave,
}: {
  schema: ConfigSchema;
  status: "configured" | "not_configured";
  rawCredentials: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(rawCredentials);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(inputValue);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to remove the Google credentials?")) {
      setSaving(true);
      try {
        await onSave("");
      } finally {
        setSaving(false);
      }
    }
  };

  const statusBadge = {
    configured: { text: "Configured", color: "bg-green-500/20 text-green-400 border-green-500/30" },
    not_configured: { text: "Not Set", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  }[status];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium text-sm">{schema.label}</span>
            <span className={`px-2 py-0.5 text-xs rounded border ${statusBadge.color}`}>
              {statusBadge.text}
            </span>
          </div>
          <p className="text-zinc-500 text-xs mt-1">{schema.description}</p>
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="p-1 text-zinc-500 hover:text-white"
          title="How to get this"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      {showHelp && (
        <div className="mb-3 p-3 bg-zinc-800/50 rounded text-xs text-zinc-400 whitespace-pre-wrap">
          {schema.howToGet}
        </div>
      )}

      {editing ? (
        <div>
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder='Paste your Google OAuth credentials JSON here (the file you downloaded from Google Cloud Console)'
            rows={10}
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
              onClick={() => {
                setEditing(false);
                setInputValue(rawCredentials);
              }}
              className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {rawCredentials ? (
            <pre className="p-3 bg-zinc-800 rounded text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {rawCredentials}
            </pre>
          ) : (
            <p className="text-zinc-500 text-sm p-3 bg-zinc-800 rounded">No credentials configured</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              onClick={() => {
                setInputValue(rawCredentials);
                setEditing(true);
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
            >
              {rawCredentials ? "Edit Credentials" : "Add Credentials"}
            </button>
            {rawCredentials && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-1 text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleTokenEditor({
  schema,
  status,
  expiry,
  rawToken,
  onSave,
}: {
  schema: ConfigSchema;
  status: "configured" | "expired" | "not_configured";
  expiry: string;
  rawToken: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(rawToken);
  const [saving, setSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(inputValue);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to remove the Google token?")) {
      setSaving(true);
      try {
        await onSave("");
      } finally {
        setSaving(false);
      }
    }
  };

  const statusBadge = {
    configured: { text: "Configured", color: "bg-green-500/20 text-green-400 border-green-500/30" },
    expired: { text: "Expired", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    not_configured: { text: "Not Set", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
  }[status];

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium text-sm">{schema.label}</span>
            <span className={`px-2 py-0.5 text-xs rounded border ${statusBadge.color}`}>
              {statusBadge.text}
            </span>
          </div>
          <p className="text-zinc-500 text-xs mt-1">{schema.description}</p>
          {expiry && status === "configured" && (
            <p className="text-zinc-500 text-xs mt-1">
              Expires: {new Date(expiry).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="p-1 text-zinc-500 hover:text-white"
          title="How to get this"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      {showHelp && (
        <div className="mb-3 p-3 bg-zinc-800/50 rounded text-xs text-zinc-400 whitespace-pre-wrap">
          {schema.howToGet}
        </div>
      )}

      {editing ? (
        <div>
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder='Paste your Google OAuth token JSON here (e.g., {"access_token": "...", "refresh_token": "...", ...})'
            rows={10}
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
              onClick={() => {
                setEditing(false);
                setInputValue(rawToken);
              }}
              className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {rawToken ? (
            <pre className="p-3 bg-zinc-800 rounded text-xs text-zinc-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {rawToken}
            </pre>
          ) : (
            <p className="text-zinc-500 text-sm p-3 bg-zinc-800 rounded">No token configured</p>
          )}
          <div className="flex flex-wrap gap-2 mt-2">
            <a
              href="/api/oauth/google/start"
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {rawToken ? "Reconnect Google Account" : "Connect Google Account"}
            </a>
            <button
              onClick={() => {
                setInputValue(rawToken);
                setEditing(true);
              }}
              className="px-3 py-1 text-sm text-zinc-400 hover:text-zinc-300"
            >
              {rawToken ? "Edit manually" : "Paste token manually"}
            </button>
            {rawToken && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-3 py-1 text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConfigPage() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

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

  useEffect(() => {
    fetchConfig();
  }, []);

  // Handle OAuth callback params
  useEffect(() => {
    const oauthSuccess = searchParams.get("oauth_success");
    const oauthError = searchParams.get("oauth_error");

    if (oauthSuccess) {
      setMessage({ type: "success", text: oauthSuccess });
      // Clear the URL params
      router.replace("/config");
      // Refresh config to show new token
      fetchConfig();
    } else if (oauthError) {
      setMessage({ type: "error", text: `OAuth failed: ${oauthError}` });
      router.replace("/config");
    }
  }, [searchParams, router]);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const saveEnvVar = async (type: "env" | "dashboard", key: string, value: string) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, key, value }),
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

  const saveGoogleCredentials = async (credentialsJson: string) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "googleCredentials", data: credentialsJson }),
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

  const saveGoogleToken = async (tokenJson: string) => {
    try {
      const res = await authFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "googleToken", data: tokenJson }),
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

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Configuration</h2>
          <p className="text-zinc-500 mt-1">API keys and settings</p>
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
          <h2 className="text-2xl font-bold text-white">Configuration</h2>
          <p className="text-zinc-500 mt-1">API keys and settings</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-red-400">Failed to load configuration</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Configuration</h2>
        <p className="text-zinc-500 mt-1">API keys and settings</p>
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

      {/* Dashboard Settings */}
      <ConfigSection title="Dashboard">
        {Object.entries(config.schema.dashboard).map(([key, schema]) => (
          <EnvVarInput
            key={key}
            name={key}
            schema={schema}
            value={config.dashboard[key] || ""}
            onSave={(value) => saveEnvVar("dashboard", key, value)}
          />
        ))}
      </ConfigSection>

      {/* Telegram Settings */}
      <ConfigSection title="Telegram">
        {Object.entries(config.schema.telegram).map(([key, schema]) => (
          <EnvVarInput
            key={key}
            name={key}
            schema={schema}
            value={config.telegram[key] || ""}
            onSave={(value) => saveEnvVar("env", key, value)}
          />
        ))}
      </ConfigSection>

      {/* Google OAuth Credentials */}
      <ConfigSection title="Google OAuth Credentials">
        <GoogleCredentialsEditor
          schema={config.schema.googleCredentials}
          status={config.googleCredentials.status}
          rawCredentials={config.googleCredentials.raw}
          onSave={saveGoogleCredentials}
        />
      </ConfigSection>

      {/* Google Account Token */}
      <ConfigSection title="Google Account Token">
        <GoogleTokenEditor
          schema={config.schema.googleToken}
          status={config.googleToken.status}
          expiry={config.googleToken.expiry}
          rawToken={config.googleToken.raw}
          onSave={saveGoogleToken}
        />
      </ConfigSection>

      {/* Google Places API */}
      {Object.keys(config.schema.google).length > 0 && (
        <ConfigSection title="Google Places API">
          {Object.entries(config.schema.google).map(([key, schema]) => (
            <EnvVarInput
              key={key}
              name={key}
              schema={schema}
              value={config.google[key] || ""}
              onSave={(value) => saveEnvVar("env", key, value)}
            />
          ))}
        </ConfigSection>
      )}

      {/* AI Services */}
      <ConfigSection title="AI Services">
        {Object.entries(config.schema.ai).map(([key, schema]) => (
          <EnvVarInput
            key={key}
            name={key}
            schema={schema}
            value={config.ai[key] || ""}
            onSave={(value) => saveEnvVar("env", key, value)}
          />
        ))}
      </ConfigSection>

      {/* Channels */}
      <ConfigSection title="Channels">
        <p className="text-zinc-500 text-xs mb-4">Enable or disable communication channels</p>
        {config.channels?.channels &&
          Object.entries(config.channels.channels).map(([channel, settings]) => {
            // Check prerequisites for each channel
            const googleAuthConfigured = config.googleToken.status === "configured";
            const telegramConfigured = config.telegram.TELEGRAM_BOT_TOKEN && config.telegram.TELEGRAM_BOT_TOKEN !== "";

            let canEnable = true;
            let missingRequirement = "";

            if (channel === "email" || channel === "gchat") {
              if (!googleAuthConfigured) {
                canEnable = false;
                missingRequirement = "Google OAuth token required";
              }
            } else if (channel === "telegram") {
              if (!telegramConfigured) {
                canEnable = false;
                missingRequirement = "Telegram Bot Token required";
              }
            }

            return (
            <div key={channel} className="border-b border-zinc-800 last:border-0 py-3 first:pt-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-white capitalize">{channel === "gchat" ? "Google Chat" : channel}</span>
                  {!canEnable && (
                    <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">
                      {missingRequirement}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!canEnable && !settings.enabled) return; // Can't enable without prerequisites
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

      {/* CLAUDE.md */}
      <ConfigSection title="Assistant Identity (CLAUDE.md)">
        <div className="flex items-center justify-between">
          <p className="text-zinc-500 text-sm">
            Defines the assistant&apos;s personality, instructions, and context.
          </p>
          <a
            href="/config/claude-md"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            View & Edit
          </a>
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
