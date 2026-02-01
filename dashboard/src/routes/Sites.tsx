import { useState, useEffect } from "react";
import { authFetch } from "@/lib/auth";

interface Site {
  name: string;
  path: string;
  url: string;
  hasPackageJson: boolean;
  framework?: string;
  lastModified?: string;
}

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    fetchSites();
  }, []);

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
        <h2 className="text-2xl font-bold text-white">Hosted Sites</h2>
        <p className="text-zinc-500 mt-1">Client sites hosted on this server</p>
      </div>

      <div className="bg-zinc-900 rounded-lg border border-zinc-800 divide-y divide-zinc-800">
        {sites.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">
            No sites found in /home/ubuntu/hosted-sites/
          </div>
        ) : (
          sites.map((site) => (
            <div
              key={site.name}
              className="p-4 hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-white">{site.name}</div>
                  <div className="text-sm text-zinc-500 mt-1 break-all">
                    {site.path}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {site.framework && (
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-900/50 text-blue-300">
                      {site.framework}
                    </span>
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
          ))
        )}
      </div>

      <div className="text-sm text-zinc-600">
        <p>Sites are auto-discovered from <code className="text-zinc-500">/home/ubuntu/hosted-sites/</code></p>
        <p className="mt-1">Add new sites to that directory and they'll appear here automatically.</p>
      </div>
    </div>
  );
}
