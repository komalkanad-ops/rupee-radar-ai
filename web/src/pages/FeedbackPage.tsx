import { FormEvent, useState } from "react";
import { apiPost } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { useSeo } from "../lib/useSeo";

export default function FeedbackPage() {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useSeo({
    title: "Feedback — Rupee Radar AI",
    description: "Tell us what's working, what's missing, or what's broken in Rupee Radar AI.",
    canonical: "https://rupeeradarai.com/feedback",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await apiPost("/feedback", { message: message.trim(), email: email.trim() || undefined, rating: rating ?? undefined });
      trackEvent("feedback_submitted");
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? "Could not submit feedback — try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto px-6 py-20 text-center">
        <h1 className="text-2xl font-bold mb-3">Thanks — got it.</h1>
        <p className="text-app-muted">
          We read every submission. If you're a Rupee Radar AI app user, sign in there and share
          feedback from Settings instead — app feedback earns you 100 reward coins.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-2">Feedback</h1>
      <p className="text-app-muted mb-8">
        Tell us what's working, what's missing, or what's broken. We read every one of these.
        Already using the app? Submit feedback from Settings there instead — it earns you 100 reward coins.
      </p>

      <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-app-text mb-2">How would you rate your experience?</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? null : n)}
                className={`text-2xl leading-none ${rating != null && n <= rating ? "text-amber-400" : "text-app-border"}`}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-app-text mb-1">Your feedback</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            required
            className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
            placeholder="What's on your mind?"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-app-text mb-1">
            Email <span className="text-app-muted font-normal">(optional, if you'd like a reply)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text"
          />
        </div>

        <button
          type="submit"
          disabled={!message.trim() || loading}
          className="bg-brand text-black px-5 py-2.5 rounded-full font-semibold hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send feedback"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </div>
  );
}
