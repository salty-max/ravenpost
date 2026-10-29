import { useState } from "react";
import { Sidebar, type Page } from "@/components/Sidebar";
import { Toasts } from "@/components/ui";
import { Addons } from "@/pages/Addons";
import { Characters } from "@/pages/Characters";
import { Folders } from "@/pages/Folders";
import { Overview } from "@/pages/Overview";
import { Settings } from "@/pages/Settings";

/** The window: the sidebar, one page beside it (it alone scrolls), the toasts. */
export function App() {
  const [page, setPage] = useState<Page>("overview");
  return (
    <div className="flex h-full">
      <Sidebar page={page} go={setPage} />
      <main className="relative min-w-0 flex-1 overflow-y-auto">
        {/* the title bar's height, draggable as the window's own (macOS: the traffic lights' row) */}
        <div className="drag sticky top-0 z-10 h-10 bg-gradient-to-b from-night via-night/80 to-transparent" />
        <div key={page} className="fade-in mx-auto max-w-4xl px-8 pb-10">
          {page === "overview" && <Overview />}
          {page === "characters" && <Characters />}
          {page === "addons" && <Addons />}
          {page === "folders" && <Folders />}
          {page === "settings" && <Settings />}
        </div>
      </main>
      <Toasts />
    </div>
  );
}
