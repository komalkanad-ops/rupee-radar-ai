import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Sun,
  Moon,
  LayoutDashboard,
  CreditCard,
  Landmark,
  Gift,
  MapPinned,
  ClipboardCheck,
  Users,
  Bell,
  Link2,
  LogOut,
  Repeat,
  Trophy,
  Tag,
  Coins,
  Inbox,
  MessageSquare,
  Smartphone,
  Flag,
  Megaphone,
  ScrollText,
  Activity,
  History,
  BarChart3,
  ShieldCheck,
  MousePointerClick,
  Bug,
  KeyRound,
  HeartPulse,
  Images,
  Menu,
  X,
} from "lucide-react";
import { clearToken, getRole } from "../lib/api";
import { applyTheme, getStoredTheme, type Theme } from "../lib/theme";

const navGroups = [
  {
    label: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Catalog",
    items: [
      { to: "/cards", label: "Credit Cards", icon: CreditCard },
      { to: "/banks", label: "Banks", icon: Landmark },
      { to: "/portals", label: "Redemption Portals", icon: Gift },
      { to: "/merchant-recommendations", label: "Merchant Mapping", icon: MapPinned },
      { to: "/subscription-providers", label: "Subscription Providers", icon: Repeat },
      { to: "/challenges", label: "Challenges & Badges", icon: Trophy },
      { to: "/merchant-offers", label: "Merchant Offers", icon: Tag },
      { to: "/vouchers", label: "Vouchers", icon: Coins },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/corrections", label: "Corrections Queue", icon: ClipboardCheck },
      { to: "/redemptions", label: "Redemption Queue", icon: Inbox },
      { to: "/feedback", label: "Feedback", icon: MessageSquare },
      { to: "/bug-reports", label: "Bug Reports", icon: Bug },
      { to: "/users", label: "Users", icon: Users },
      { to: "/push", label: "Push Notifications", icon: Bell },
    ],
  },
  {
    label: "Config",
    items: [
      { to: "/links", label: "App Links", icon: Link2 },
      { to: "/app-versions", label: "App Versions", icon: Smartphone },
      { to: "/feature-flags", label: "Feature Flags", icon: Flag },
      { to: "/announcements", label: "Announcements", icon: Megaphone },
      { to: "/login-bypass", label: "Login Bypass", icon: KeyRound },
      { to: "/changelog", label: "Changelog", icon: History },
      { to: "/site-screenshots", label: "Site Screenshots", icon: Images },
      // UX-only hint, not a real permission boundary — requireRole on the backend is what
      // actually blocks a non-SUPER_ADMIN from using this page, filtered out below.
      { to: "/admin-users", label: "Admin Users", icon: ShieldCheck, superAdminOnly: true },
    ],
  },
  {
    label: "Observability",
    items: [
      { to: "/monitoring", label: "Monitoring", icon: HeartPulse },
      { to: "/logs", label: "Event Logs", icon: ScrollText },
      { to: "/mesh-usage", label: "Mesh API Usage", icon: Activity },
      { to: "/analytics", label: "Website Analytics", icon: BarChart3 },
      { to: "/app-adoption", label: "App Adoption", icon: Smartphone },
      { to: "/feature-usage", label: "User Activity", icon: MousePointerClick },
    ],
  },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const role = getRole();
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !("superAdminOnly" in item) || role === "SUPER_ADMIN"),
    }))
    .filter((group) => group.items.length > 0);

  // Close the mobile drawer on navigation so a tap-through doesn't leave it covering the page.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  const sidebar = (
    <div className="h-full bg-brand-dark text-white flex flex-col">
      <div className="px-6 py-5 text-lg font-semibold border-b border-white/10 flex items-center justify-between">
        <div>
          Rupee Radar AI
          <div className="text-xs font-normal text-white/60">Admin Console</div>
        </div>
        <button className="md:hidden text-white/70 hover:text-white" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
          <X size={20} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {visibleGroups.map((group) => (
          <div key={group.label}>
            <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                      isActive ? "bg-white/15" : "hover:bg-white/10"
                    }`
                  }
                >
                  <item.icon size={16} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={toggleTheme}
        className="mx-3 mt-3 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left hover:bg-white/10"
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
      <button
        onClick={() => {
          clearToken();
          navigate("/login");
        }}
        className="mx-3 mb-3 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left hover:bg-white/10"
      >
        <LogOut size={16} />
        Log out
      </button>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop: fixed sidebar. Below md: a hamburger + slide-in drawer. */}
      <aside className="hidden md:flex md:w-64 md:shrink-0">{sidebar}</aside>

      {drawerOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setDrawerOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 md:hidden shadow-xl">{sidebar}</aside>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="text-slate-600">
            <Menu size={22} />
          </button>
          <span className="font-semibold text-brand-dark">Rupee Radar AI Admin</span>
        </header>
        <main className="flex-1 min-w-0 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
