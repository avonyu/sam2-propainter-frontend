import { NavLink, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { Sparkles, Github } from "lucide-react";
import { UploadPage } from "@/pages/upload-page";
import { AnnotatePage } from "@/pages/annotate-page";
import { ProcessingPage } from "@/pages/processing-page";
import { ResultPage } from "@/pages/result-page";
import { cn } from "@/lib/utils";

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          "rounded-md px-3 py-1.5 text-sm font-medium transition",
          isActive
            ? "bg-primary/20 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        )
      }
    >
      {label}
    </NavLink>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <NavLink to="/" className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <span className="font-semibold">Watermark Remover</span>
              <span className="hidden text-xs text-muted-foreground md:inline">
                SAM 2 · ProPainter
              </span>
            </NavLink>
            <nav className="flex items-center gap-1">
              <NavItem to="/" label="New Job" />
            </nav>
          </div>
          <a
            href="https://github.com/avonyu/sam2-propainter-frontend"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            <Github className="h-5 w-5" />
          </a>
        </div>
      </header>

      <main className="container flex-1 py-8">{children}</main>

      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Powered by Meta SAM 2 & sczhou ProPainter · Built with React + FastAPI
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/jobs/:jobId/annotate" element={<AnnotatePage />} />
          <Route path="/jobs/:jobId/processing" element={<ProcessingPage />} />
          <Route path="/jobs/:jobId/result" element={<ResultPage />} />
        </Routes>
      </Layout>
    </Router>
  );
}