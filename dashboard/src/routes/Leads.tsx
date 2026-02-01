import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";

interface Lead {
  id: number;
  businessName: string;
  industry: string;
  status: string;
  googleRating: string;
  phone: string;
  address: string;
  currentWebsite: string;
  whyNeedHelp: string;
  prdLink: string;
  previewSite: string;
  dateAdded: string;
  notes: string;
  githubRepo: string;
  astroPreview: string;
  astroGithub: string;
}

function getStatusBadge(status: string) {
  const statusLower = status.toLowerCase();
  if (statusLower.includes("website built")) {
    return { color: "bg-green-500/20 text-green-400", label: "Website Built" };
  }
  if (statusLower.includes("prd ready")) {
    return { color: "bg-yellow-500/20 text-yellow-400", label: "PRD Ready" };
  }
  if (statusLower.includes("lead")) {
    return { color: "bg-blue-500/20 text-blue-400", label: "Lead" };
  }
  if (statusLower.includes("draft sent")) {
    return { color: "bg-purple-500/20 text-purple-400", label: "Draft Sent" };
  }
  return { color: "bg-zinc-500/20 text-zinc-400", label: status || "New" };
}

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [findPrompt, setFindPrompt] = useState("");
  const [showFindModal, setShowFindModal] = useState(false);
  const [finding, setFinding] = useState(false);

  const fetchLeads = async () => {
    try {
      const res = await authFetch("/api/leads");
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
      }
    } catch (err) {
      console.error("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const handleFindLead = async () => {
    setFinding(true);
    try {
      await authFetch("/api/leads/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: findPrompt }),
      });
      setShowFindModal(false);
      setFindPrompt("");
      // The job will run in background
    } catch (err) {
      console.error("Failed to start lead finder:", err);
    } finally {
      setFinding(false);
    }
  };

  // Group leads by status for summary
  const statusCounts = leads.reduce(
    (acc, lead) => {
      const status = lead.status.toLowerCase();
      if (status.includes("website built")) acc.built++;
      else if (status.includes("prd ready")) acc.prdReady++;
      else if (status.includes("draft sent")) acc.draftSent++;
      else acc.new++;
      return acc;
    },
    { built: 0, prdReady: 0, draftSent: 0, new: 0 }
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Leads</h2>
          <p className="text-zinc-500 mt-1">Track and manage sales leads</p>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Leads</h2>
          <p className="text-zinc-500 mt-1">Track and manage sales leads</p>
        </div>
        <button
          onClick={() => setShowFindModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          Find Lead
        </button>
      </div>

      {/* Status Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="text-3xl font-bold text-white">{statusCounts.built}</div>
          <div className="text-sm text-green-400">Website Built</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="text-3xl font-bold text-white">{statusCounts.prdReady}</div>
          <div className="text-sm text-yellow-400">PRD Ready</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="text-3xl font-bold text-white">{statusCounts.draftSent}</div>
          <div className="text-sm text-purple-400">Draft Sent</div>
        </div>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-4">
          <div className="text-3xl font-bold text-white">{statusCounts.new}</div>
          <div className="text-sm text-zinc-400">Other</div>
        </div>
      </div>

      {/* Leads List */}
      {leads.length === 0 ? (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <svg
            className="w-12 h-12 mx-auto text-zinc-600 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          <p className="text-zinc-500 mb-4">No leads yet</p>
          <button
            onClick={() => setShowFindModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Find Your First Lead
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {leads.map((lead) => {
            const statusBadge = getStatusBadge(lead.status);
            const hasWebsite = lead.astroPreview || lead.previewSite;
            return (
              <Link
                key={lead.id}
                to={`/leads/${lead.id}`}
                className="flex items-center justify-between bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-white font-medium truncate">
                      {lead.businessName}
                    </h3>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded ${statusBadge.color}`}
                    >
                      {statusBadge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-zinc-500">
                    <span>{lead.industry}</span>
                    {lead.googleRating && (
                      <span className="flex items-center gap-1">
                        <svg
                          className="w-4 h-4 text-yellow-400"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        {lead.googleRating}
                      </span>
                    )}
                    <span>{lead.dateAdded}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  {hasWebsite && (
                    <span
                      className="w-3 h-3 rounded-full bg-green-500"
                      title="Has website"
                    />
                  )}
                  <svg
                    className="w-5 h-5 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Find Lead Modal */}
      {showFindModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              Find New Lead
            </h3>
            <p className="text-zinc-500 text-sm mb-4">
              Optionally provide a prompt to guide the search. Leave empty for a
              general search of Mississauga businesses that need a new website.
            </p>
            <textarea
              value={findPrompt}
              onChange={(e) => setFindPrompt(e.target.value)}
              placeholder="e.g., 'restaurants in Port Credit' or 'plumbers with bad websites'"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => {
                  setShowFindModal(false);
                  setFindPrompt("");
                }}
                className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFindLead}
                disabled={finding}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {finding ? "Starting..." : "Find Lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
