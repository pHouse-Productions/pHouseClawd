import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";

interface Site {
  name: string;
  path: string;
  url: string;
  hasPackageJson: boolean;
  framework?: string;
  lastModified?: string;
  type: "static" | "app";
  status?: "online" | "stopped" | "errored";
  port?: number;
}

interface LogFile {
  type: string;
  path: string;
  label: string;
}

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logFiles, setLogFiles] = useState<Record<string, LogFile[]>>({});
  const [logFilesLoading, setLogFilesLoading] = useState<string | null>(null);

  const fetchSites = async () => {
    try {
      const res = await authFetch("/api/sites");
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites || []);
      }
    } catch (err) {
      console.error("Failed to fetch sites:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSites();
  }, []);

  const toggleApp = async (name: string, action: "start" | "stop") => {
    setActionLoading(name);
    try {
      const res = await authFetch(`/api/sites/${name}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        // Refresh the sites list after a short delay to allow PM2 to update
        setTimeout(() => {
          fetchSites();
          setActionLoading(null);
        }, 1000);
      } else {
        setActionLoading(null);
      }
    } catch (err) {
      console.error(`Failed to ${action} app:`, err);
      setActionLoading(null);
    }
  };

  const toggleLogSection = async (name: string) => {
    if (expandedLogs === name) {
      setExpandedLogs(null);
      return;
    }

    setExpandedLogs(name);

    // Fetch log files if we don't have them cached
    if (!logFiles[name]) {
      setLogFilesLoading(name);
      try {
        const res = await authFetch(`/api/sites/${name}/log-files`);
        if (res.ok) {
          const data = await res.json();
          setLogFiles((prev) => ({ ...prev, [name]: data.logFiles || [] }));
        }
      } catch (err) {
        console.error("Failed to fetch log files:", err);
      } finally {
        setLogFilesLoading(null);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500">Loading sites...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-white">Hosted Sites & Apps</h2>
        <p className="text-zinc-500 mt-1">Static sites and web apps hosted on this server</p>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800">
        {sites.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">
            No sites found in /home/ubuntu/hosted-sites/
          </div>
        ) : (
          sites.map((site) => (
            <div key={site.name}>
              <div className="p-4 hover:bg-zinc-800/50 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-white">{site.name}</div>
                    <div className="text-sm text-zinc-500 mt-1 break-all">
                      {site.path}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {site.type === "app" && site.status && (
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          site.status === "online"
                            ? "bg-green-900/50 text-green-300"
                            : site.status === "stopped"
                            ? "bg-yellow-900/50 text-yellow-300"
                            : "bg-red-900/50 text-red-300"
                        }`}
                      >
                        {site.status}
                      </span>
                    )}
                    {site.type === "app" && (
                      <span className="text-xs px-2 py-1 rounded-full bg-purple-900/50 text-purple-300">
                        App
                      </span>
                    )}
                    {site.framework && (
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-900/50 text-blue-300">
                        {site.framework}
                      </span>
                    )}
                    {site.type === "app" && (
                      <>
                        <button
                          onClick={() => toggleLogSection(site.name)}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                            expandedLogs === site.name
                              ? "bg-blue-600 text-white"
                              : "bg-blue-700 hover:bg-blue-600 text-white"
                          }`}
                        >
                          Logs {expandedLogs === site.name ? "▲" : "▼"}
                        </button>
                        <button
                          onClick={() =>
                            toggleApp(
                              site.name,
                              site.status === "online" ? "stop" : "start"
                            )
                          }
                          disabled={actionLoading === site.name}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                            site.status === "online"
                              ? "bg-red-700 hover:bg-red-600 text-white"
                              : "bg-green-700 hover:bg-green-600 text-white"
                          }`}
                        >
                          {actionLoading === site.name
                            ? "..."
                            : site.status === "online"
                            ? "Stop"
                            : "Start"}
                        </button>
                      </>
                    )}
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white transition-colors"
                    >
                      View →
                    </a>
                  </div>
                </div>
                {site.lastModified && (
                  <div className="text-xs text-zinc-600 mt-2">
                    Last modified: {new Date(site.lastModified).toLocaleString()}
                  </div>
                )}
              </div>

              {/* Expanded Logs Section */}
              {expandedLogs === site.name && (
                <div className="px-4 pb-4 bg-zinc-800/30">
                  <div className="pt-2 border-t border-zinc-700">
                    <div className="text-sm text-zinc-400 mb-2">Log Files</div>
                    {logFilesLoading === site.name ? (
                      <div className="text-zinc-500 text-sm">Loading log files...</div>
                    ) : logFiles[site.name]?.length === 0 ? (
                      <div className="text-zinc-500 text-sm">No log files found</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {logFiles[site.name]?.map((logFile) => (
                          <Link
                            key={logFile.type}
                            to={`/sites/${site.name}/logs/${logFile.type}`}
                            className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                          >
                            <span
                              className={`text-sm font-medium ${
                                logFile.type === "error"
                                  ? "text-red-400"
                                  : "text-green-400"
                              }`}
                            >
                              {logFile.type === "error" ? "stderr" : "stdout"}
                            </span>
                            <span className="text-xs text-zinc-500">
                              {logFile.label.replace(/^(stdout|stderr) /, "")}
                            </span>
                            <span className="text-zinc-500">→</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="text-sm text-zinc-600">
        <p>Static sites are discovered from <code className="text-zinc-500">/home/ubuntu/hosted-sites/</code></p>
        <p className="mt-1">Web apps are detected from PM2 processes with configured subdomains.</p>
      </div>
    </div>
  );
}
