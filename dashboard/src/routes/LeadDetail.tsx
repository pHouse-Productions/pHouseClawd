import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
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

export default function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [outreaching, setOutreaching] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchLead = async () => {
      try {
        const res = await authFetch(`/api/leads/${id}`);
        if (res.ok) {
          const data = await res.json();
          setLead(data);
        } else {
          setError("Lead not found");
        }
      } catch (err) {
        console.error("Failed to fetch lead:", err);
        setError("Failed to load lead");
      } finally {
        setLoading(false);
      }
    };
    fetchLead();
  }, [id]);

  const handleBuildWebsite = async () => {
    if (!lead) return;
    setBuilding(true);
    setActionMessage(null);
    try {
      const res = await authFetch(`/api/leads/${lead.id}/build`, {
        method: "POST",
      });
      if (res.ok) {
        setActionMessage("Website builder started! Check Jobs for progress.");
      } else {
        const data = await res.json();
        setActionMessage(data.error || "Failed to start website builder");
      }
    } catch (err) {
      console.error("Failed to start website builder:", err);
      setActionMessage("Failed to start website builder");
    } finally {
      setBuilding(false);
    }
  };

  const handleOutreach = async () => {
    if (!lead) return;
    setOutreaching(true);
    setActionMessage(null);
    try {
      const res = await authFetch(`/api/leads/${lead.id}/outreach`, {
        method: "POST",
      });
      if (res.ok) {
        setActionMessage("Outreach email started! Draft will be posted to Discord for review.");
      } else {
        const data = await res.json();
        setActionMessage(data.error || "Failed to start outreach");
      }
    } catch (err) {
      console.error("Failed to start outreach:", err);
      setActionMessage("Failed to start outreach");
    } finally {
      setOutreaching(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Link
          to="/leads"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Leads
        </Link>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-zinc-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="space-y-4">
        <Link
          to="/leads"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Leads
        </Link>
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <p className="text-red-400">{error || "Lead not found"}</p>
        </div>
      </div>
    );
  }

  const statusBadge = getStatusBadge(lead.status);
  const hasWebsite = lead.astroPreview || lead.previewSite;
  const hasPRD = lead.prdLink;
  const previewUrl = lead.astroPreview || lead.previewSite;
  const repoUrl = lead.astroGithub || lead.githubRepo;

  return (
    <div className="space-y-6">
      <Link
        to="/leads"
        className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Leads
      </Link>

      {/* Header with actions */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-white">{lead.businessName}</h2>
              <span className={`px-3 py-1 text-sm font-medium rounded ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
            </div>
            <p className="text-zinc-400">{lead.industry}</p>
            {lead.googleRating && (
              <div className="flex items-center gap-1 mt-2">
                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="text-white font-medium">{lead.googleRating}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            {!hasWebsite && hasPRD && (
              <button
                onClick={handleBuildWebsite}
                disabled={building}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                {building ? "Starting..." : "Create Website"}
              </button>
            )}
            {hasWebsite && (
              <button
                onClick={handleOutreach}
                disabled={outreaching}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                {outreaching ? "Starting..." : "Draft Email"}
              </button>
            )}
          </div>
        </div>

        {actionMessage && (
          <div className="mt-4 p-3 bg-zinc-800 rounded-lg text-sm text-zinc-300">
            {actionMessage}
          </div>
        )}
      </div>

      {/* Details Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Contact Info */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            Contact
          </h3>
          <div className="space-y-3">
            {lead.phone && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wide">Phone</div>
                <a href={`tel:${lead.phone}`} className="text-white hover:text-blue-400">
                  {lead.phone}
                </a>
              </div>
            )}
            {lead.address && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wide">Address</div>
                <p className="text-white">{lead.address}</p>
              </div>
            )}
            {lead.currentWebsite && (
              <div>
                <div className="text-xs text-zinc-500 uppercase tracking-wide">Current Website</div>
                <a
                  href={lead.currentWebsite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 break-all"
                >
                  {lead.currentWebsite}
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Why They Need Help */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Why They Need Help
          </h3>
          <p className="text-zinc-300">{lead.whyNeedHelp || "No details provided"}</p>
        </div>
      </div>

      {/* Links Section */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Resources
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {hasPRD && (
            <a
              href={lead.prdLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-white">PRD Document</span>
            </a>
          )}
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
              <span className="text-white">Preview Site</span>
            </a>
          )}
          {repoUrl && (
            <a
              href={repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-purple-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              <span className="text-white">GitHub Repo</span>
            </a>
          )}
        </div>
      </div>

      {/* Notes */}
      {lead.notes && (
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Notes
          </h3>
          <p className="text-zinc-300 whitespace-pre-wrap">{lead.notes}</p>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-5">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Timeline
        </h3>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 mt-2 rounded-full bg-blue-500" />
            <div>
              <div className="text-white">Lead Added</div>
              <div className="text-sm text-zinc-500">{lead.dateAdded || "Unknown"}</div>
            </div>
          </div>
          {hasPRD && (
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 mt-2 rounded-full bg-yellow-500" />
              <div>
                <div className="text-white">PRD Created</div>
                <div className="text-sm text-zinc-500">Document ready for review</div>
              </div>
            </div>
          )}
          {hasWebsite && (
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 mt-2 rounded-full bg-green-500" />
              <div>
                <div className="text-white">Website Built</div>
                <div className="text-sm text-zinc-500">Preview available</div>
              </div>
            </div>
          )}
          {lead.notes?.toLowerCase().includes("draft sent") && (
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 mt-2 rounded-full bg-purple-500" />
              <div>
                <div className="text-white">Outreach Sent</div>
                <div className="text-sm text-zinc-500">Email drafted and sent</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
