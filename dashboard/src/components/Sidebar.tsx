import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { authFetch } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

// Fallback nav items if API fails
const DEFAULT_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/chat", label: "Chat", icon: "chat" },
  { href: "/jobs", label: "Jobs", icon: "briefcase" },
  { href: "/memory", label: "Memory", icon: "brain" },
  { href: "/system", label: "System", icon: "book" },
  { href: "/skills", label: "Skills", icon: "bolt" },
  { href: "/config", label: "Config", icon: "cog" },
  { href: "/sites", label: "Sites", icon: "globe" },
  { href: "/processes", label: "Processes", icon: "server" },
  { href: "/channels", label: "Channels", icon: "channels" },
  { href: "/mcp", label: "MCP", icon: "plug" },
  { href: "/logs", label: "Logs", icon: "file-text" },
  { href: "/cron", label: "Cron", icon: "clock" },
];

const icons: Record<string, React.ReactNode> = {
  home: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  chat: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  "file-text": (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  clock: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  brain: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  cog: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  bolt: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  briefcase: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  plug: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  channels: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  globe: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  ),
  server: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  ),
  target: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={2} />
      <circle cx="12" cy="12" r="6" strokeWidth={2} />
      <circle cx="12" cy="12" r="2" strokeWidth={2} />
    </svg>
  ),
  book: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  more: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  ),
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

// Track nav click (fire and forget)
function trackClick(page: string) {
  authFetch("/api/nav/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page }),
  }).catch(() => {}); // Ignore errors
}

export default function Sidebar() {
  const location = useLocation();
  const pathname = location.pathname;
  const { logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [primaryItems, setPrimaryItems] = useState<NavItem[]>(DEFAULT_NAV_ITEMS);
  const [secondaryItems, setSecondaryItems] = useState<NavItem[]>([]);

  // Fetch nav config on mount
  useEffect(() => {
    authFetch("/api/nav/config")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.primary?.length > 0) {
          setPrimaryItems(data.primary);
          setSecondaryItems(data.secondary || []);
        }
      })
      .catch(() => {}); // Use defaults on error
  }, []);

  // Track page views
  useEffect(() => {
    trackClick(pathname);
  }, [pathname]);

  const closeMobile = () => setMobileOpen(false);

  const handleNavClick = (href: string) => {
    closeMobile();
    setMoreOpen(false);
  };

  const renderNavItem = (item: NavItem, isMobile: boolean) => {
    const active = isActive(pathname, item.href);
    return (
      <li key={item.href}>
        <Link
          to={item.href}
          onClick={() => handleNavClick(item.href)}
          className={`flex items-center gap-3 ${isMobile ? "px-3 py-2" : "px-4 py-2"} rounded-lg transition-colors ${
            active
              ? "bg-zinc-800 text-white"
              : isMobile
              ? "text-zinc-400 active:bg-zinc-800/50"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
          }`}
        >
          {icons[item.icon]}
          {item.label}
        </Link>
      </li>
    );
  };

  const renderMoreSection = (isMobile: boolean) => {
    if (secondaryItems.length === 0) return null;

    return (
      <div className={isMobile ? "mb-4" : "mb-5"}>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className={`w-full flex items-center justify-between ${isMobile ? "px-3 py-2" : "px-4 py-2"} text-zinc-400 hover:text-white rounded-lg transition-colors`}
        >
          <span className="flex items-center gap-3">
            {icons.more}
            More
          </span>
          <svg
            className={`w-4 h-4 transition-transform ${moreOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {moreOpen && (
          <ul className="space-y-1 mt-1 ml-2 border-l border-zinc-800 pl-2">
            {secondaryItems.map((item) => renderNavItem(item, isMobile))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Header with Hamburger */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-zinc-900 border-b border-zinc-800 h-14 flex items-center px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-2 -ml-2 text-zinc-400 hover:text-white"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="ml-3 text-white font-semibold">pHouseClawd</span>
      </header>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50"
          onClick={closeMobile}
        />
      )}

      {/* Mobile Slide-out Menu */}
      <aside
        className={`md:hidden fixed top-0 left-0 z-50 h-full w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col transform transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">AI Dashboard</h1>
            <p className="text-xs text-zinc-500">pHouseClawd</p>
          </div>
          <button
            onClick={closeMobile}
            className="p-2 -mr-2 text-zinc-400 hover:text-white"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 p-3 overflow-y-auto">
          <ul className="space-y-1">
            {primaryItems.map((item) => renderNavItem(item, true))}
          </ul>
          {renderMoreSection(true)}
        </nav>
        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={() => {
              closeMobile();
              logout();
            }}
            className="flex items-center gap-3 px-3 py-2.5 w-full text-left text-zinc-400 hover:text-white rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 bg-zinc-900 border-r border-zinc-800 flex-col">
        <div className="p-6 border-b border-zinc-800">
          <h1 className="text-xl font-bold text-white">AI Dashboard</h1>
          <p className="text-sm text-zinc-500 mt-1">pHouseClawd</p>
        </div>
        <nav className="flex-1 p-4 overflow-y-auto">
          <ul className="space-y-1">
            {primaryItems.map((item) => renderNavItem(item, false))}
          </ul>
          {renderMoreSection(false)}
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center justify-between">
            <div className="text-xs text-zinc-500">
              Status: <span className="text-green-500">Online</span>
            </div>
            <button
              onClick={logout}
              className="text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
