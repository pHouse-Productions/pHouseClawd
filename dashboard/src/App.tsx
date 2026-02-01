import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/components/AuthProvider";
import Sidebar from "@/components/Sidebar";

// Import routes
import Home from "@/routes/Home";
import Chat from "@/routes/Chat";
import Jobs from "@/routes/Jobs";
import JobDetail from "@/routes/JobDetail";
import Memory from "@/routes/Memory";
import MemoryFile from "@/routes/MemoryFile";
import ShortTermMemory from "@/routes/ShortTermMemory";
import Channels from "@/routes/Channels";
import Skills from "@/routes/Skills";
import SkillDetail from "@/routes/SkillDetail";
import Mcp from "@/routes/Mcp";
import Logs from "@/routes/Logs";
import LogFile from "@/routes/LogFile";
import Cron from "@/routes/Cron";
import Config from "@/routes/Config";
import ClaudeMd from "@/routes/ClaudeMd";
import Sites from "@/routes/Sites";
import Processes from "@/routes/Processes";

export default function App() {
  return (
    <AuthProvider>
      <div className="flex min-h-screen">
        <Sidebar />
        {/* Main content - pt-14 on mobile for top header */}
        <main className="flex-1 min-w-0 p-4 pt-18 md:p-6 md:pt-6">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/memory" element={<Memory />} />
            <Route path="/memory/files/:name" element={<MemoryFile />} />
            <Route path="/memory/short-term" element={<ShortTermMemory />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/skills/:name" element={<SkillDetail />} />
            <Route path="/mcp" element={<Mcp />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/logs/:file" element={<LogFile />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/config" element={<Config />} />
            <Route path="/config/claude-md" element={<ClaudeMd />} />
            <Route path="/sites" element={<Sites />} />
            <Route path="/processes" element={<Processes />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}
