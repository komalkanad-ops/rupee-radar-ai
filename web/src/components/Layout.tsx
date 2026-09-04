import { Link, Outlet } from "react-router-dom";
import { useState } from "react";
import { trackEvent } from "../lib/analytics";
import CookieConsentBanner from "./CookieConsentBanner";

const navLinks = [
  { to: "/cards", label: "Credit Cards" },
  { to: "/statement-analyzer", label: "Statement Analyzer" },
  { to: "/emi-calculator", label: "EMI Calculator" },
  { to: "/why-rupee-radar-ai", label: "Why Rupee Radar AI" },
  { to: "/download", label: "Download" },
];

export default function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-app-bg text-app-text">
      <header className="border-b border-app-border sticky top-0 z-20 bg-app-bg/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-lg font-bold flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
            <img src="/logo.png" alt="Rupee Radar AI" className="w-8 h-8 rounded-xl" />
            Rupee Radar AI
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {navLinks.map((link) => (
              <Link key={link.to} to={link.to} className="text-app-muted hover:text-app-text transition-colors">
                {link.label}
              </Link>
            ))}
            <Link
              to="/download"
              onClick={() => trackEvent("download_app_click", { location: "nav_desktop" })}
              className="bg-brand text-black px-4 py-2 rounded-full font-semibold hover:bg-brand-dark transition hover:scale-105 active:scale-95"
            >
              Get the app
            </Link>
          </nav>
          <div className="md:hidden flex items-center gap-2">
            <Link
              to="/download"
              onClick={() => { trackEvent("download_app_click", { location: "nav_mobile" }); setMobileMenuOpen(false); }}
              className="bg-brand text-black px-3 py-1.5 rounded-full text-sm font-semibold transition active:scale-95"
            >
              Get the app
            </Link>
            <button
              type="button"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="w-9 h-9 flex items-center justify-center rounded-full border border-app-border text-app-text active:scale-95 transition"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                <line
                  x1="2" y1="4.5" x2="16" y2="4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                  className="origin-center transition-transform duration-200"
                  style={mobileMenuOpen ? { transform: "translateY(4.5px) rotate(45deg)" } : undefined}
                />
                <line
                  x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                  className="transition-opacity duration-150"
                  style={mobileMenuOpen ? { opacity: 0 } : undefined}
                />
                <line
                  x1="2" y1="13.5" x2="16" y2="13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                  className="origin-center transition-transform duration-200"
                  style={mobileMenuOpen ? { transform: "translateY(-4.5px) rotate(-45deg)" } : undefined}
                />
              </svg>
            </button>
          </div>
        </div>
        {mobileMenuOpen && (
          <nav className="md:hidden border-t border-app-border px-6 py-4 flex flex-col gap-1 animate-fade-in-up">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className="text-app-muted hover:text-app-text transition-colors py-2.5 text-sm border-b border-app-border/50 last:border-b-0"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-app-border mt-16">
        <div className="max-w-6xl mx-auto px-6 py-8 text-sm text-app-muted flex flex-col sm:flex-row gap-4 justify-between">
          <span>© {new Date().getFullYear()} Rupee Radar AI</span>
          <div className="flex gap-4">
            <a href="/terms" className="hover:text-app-text transition-colors">Terms</a>
            <a href="/download" className="hover:text-app-text transition-colors">Download</a>
            <a href="/privacy" className="hover:text-app-text transition-colors">Privacy</a>
            <a href="/delete-account" className="hover:text-app-text transition-colors">Delete account</a>
            <a href="/support" className="hover:text-app-text transition-colors">Support</a>
            <a href="/feedback" className="hover:text-app-text transition-colors">Feedback</a>
            <a href="/changelog" className="hover:text-app-text transition-colors">What's New</a>
          </div>
        </div>
      </footer>

      <CookieConsentBanner />
    </div>
  );
}
