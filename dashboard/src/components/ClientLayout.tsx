"use client";

import { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import Sidebar from "./Sidebar";

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        {/* Main content - pt-14 on mobile for top header, normal on desktop */}
        <main className="flex-1 min-w-0 p-4 pt-18 md:p-6 md:pt-6 overflow-hidden">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}
