import { useState } from "react";

const STORAGE_KEY = "rr_cookie_consent";

// Forward-prep, not reactive to an actual need — this site has zero cookies/analytics/tracking
// today (confirmed by a full grep of web/src before writing this), so there's nothing to consent
// to yet. Built anyway per explicit product decision, so it's ready the moment analytics gets
// added. Any future tracking script must check localStorage.getItem(STORAGE_KEY) === "accepted"
// before loading — this banner alone doesn't gate anything.
export default function CookieConsentBanner() {
  const [choice, setChoice] = useState<string | null>(() => {
    if (typeof window === "undefined") return "accepted";
    return window.localStorage.getItem(STORAGE_KEY);
  });

  if (choice) return null;

  function decide(value: "accepted" | "declined") {
    window.localStorage.setItem(STORAGE_KEY, value);
    setChoice(value);
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-app-surface border-t border-app-border text-app-text z-50">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-app-muted">
          We don't use any tracking cookies today. If that changes, this is where you'll choose.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => decide("declined")}
            className="text-sm px-4 py-2 rounded-full border border-app-border hover:bg-white/5"
          >
            Decline
          </button>
          <button
            onClick={() => decide("accepted")}
            className="text-sm px-4 py-2 rounded-full bg-brand text-black font-semibold hover:bg-brand-dark"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
