import { FormEvent, useEffect, useState } from "react";
import { api, apiPost } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { useSeo } from "../lib/useSeo";

// Versioned filename dodges Hostinger's ~1h CDN cache on static assets — always resolves to the
// current build once its /app-version row exists. Falls back to the stable name before that loads.
const STABLE_APK_URL = "/rupee-radar-ai.apk";
const apkUrlFor = (versionName?: string) =>
  versionName ? `/rupee-radar-ai-${versionName}.apk` : STABLE_APK_URL;

// Read the real download size from the APK's Content-Length rather than hardcoding it (the build
// size drifts a MB or so each release). A HEAD request is tiny; if it fails we just omit the size.
const formatMb = (bytes: number) => `${(bytes / 1_000_000).toFixed(0)} MB`;

interface LatestVersion {
  latestStable: { versionName: string; versionCode: number; releaseNotes: string; createdAt: string } | null;
  latestBeta: { versionName: string; versionCode: number; releaseNotes: string; createdAt: string } | null;
}

// The last few builds are kept on the site itself (web/public/rupee-radar-ai-<v>.apk), listed in
// /apk-versions.json (newest first, written by scripts/publish-apk.sh). The full history lives on
// the GitHub `apk-archive` release but is deliberately NOT surfaced here yet — see PREVIOUS_LIMIT.
const APK_VERSIONS_MANIFEST = "/apk-versions.json";
const PREVIOUS_LIMIT = 3;

type Brand =
  | "samsung"
  | "xiaomi"
  | "oneplus"
  | "vivo"
  | "pixel"
  | "motorola"
  | "other";

const BRAND_LABELS: Record<Brand, string> = {
  samsung: "Samsung (One UI)",
  xiaomi: "Xiaomi / Redmi / POCO (MIUI / HyperOS)",
  oneplus: "OnePlus / Oppo / Realme (OxygenOS / ColorOS)",
  vivo: "Vivo / iQOO (Funtouch OS / OriginOS)",
  pixel: "Google Pixel (stock Android)",
  motorola: "Motorola / Nothing / Lava / others",
  other: "I'm not sure",
};

/** Manufacturer-specific extra steps, on top of the common flow. */
const BRAND_STEPS: Record<Brand, { title: string; steps: string[] }> = {
  samsung: {
    title: "On Samsung (One UI)",
    steps: [
      "When you open the downloaded file, a box appears: “For your security, your phone isn't allowed to install unknown apps from this source.” Tap **Settings**.",
      "Turn on **Allow from this source** for the app you downloaded with (usually **Chrome** or **My Files**), then tap **back**.",
      "Tap **Install**. If you see **“Blocked by Play Protect”**, tap **Install anyway** (or **More details → Install anyway**).",
    ],
  },
  xiaomi: {
    title: "On Xiaomi / Redmi / POCO (MIUI / HyperOS)",
    steps: [
      "Open the downloaded file. Grant **Install unknown apps** / **Allow from this source** to **Chrome** (or **Mi Browser** / **File Manager**) when asked.",
      "MIUI runs a quick security scan (“Verifying…”). Wait for it to finish, then tap **Install** → **Install anyway**.",
      "If the Install button is greyed out or the install is blocked: open the **Security** app → **Settings** (gear icon) → turn **off** **“Scan apps before installing”**, then try again.",
      "Brand-new Xiaomi phones sometimes block sideloading for the first day. If nothing works, **turn Wi-Fi and mobile data off** for the moment you tap **Install**, then turn them back on.",
    ],
  },
  oneplus: {
    title: "On OnePlus / Oppo / Realme (OxygenOS / ColorOS)",
    steps: [
      "Open the downloaded file. When prompted, tap **Settings** and turn on **Allow from this source** for your browser.",
      "ColorOS / OxygenOS may ask you to enter your **lock-screen PIN or password** to confirm — this is normal.",
      "Tap **Install**. If a “safety check” or Play Protect warning appears, choose **Install anyway**.",
    ],
  },
  vivo: {
    title: "On Vivo / iQOO (Funtouch OS / OriginOS)",
    steps: [
      "Open the downloaded file and tap **Settings** → turn on **Allow install** / **Install unknown apps** for your browser.",
      "If install is still blocked, go to **Settings → More settings → Permissions & privacy** (or the **i Manager** app) and turn **off** **“Install via external sources verification”** / **“Internet apps installation”**.",
      "Tap **Install** → **Install anyway** if warned.",
    ],
  },
  pixel: {
    title: "On Google Pixel (stock Android)",
    steps: [
      "Open the downloaded file. Tap **Settings** on the prompt, turn on **Allow from this source**, then tap **back**.",
      "Tap **Install**.",
      "If Play Protect says the app wasn't scanned, tap **Install anyway** (and **Don't send** if asked).",
    ],
  },
  motorola: {
    title: "On Motorola / Nothing / Lava / most other phones",
    steps: [
      "Open the downloaded file. Tap **Settings** on the prompt and turn on **Allow from this source** for your browser.",
      "Tap **back**, then **Install**.",
      "If a Play Protect warning appears, tap **Install anyway**.",
    ],
  },
  other: {
    title: "If you're not sure which phone you have",
    steps: [
      "Open the downloaded **rupee-radar-ai.apk** file (tap the download notification, or open **Files → Downloads**).",
      "Android will say it can't install from this source → tap **Settings** → turn on **Allow from this source** (or **Install unknown apps**) for the app you're installing from.",
      "Go **back** and tap **Install**. If your phone warns the app is unverified, choose **Install anyway**.",
    ],
  },
};

/** Renders **bold** markers inside a plain string. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="text-app-text font-semibold">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function Download() {
  useSeo({
    title: "Download Rupee Radar AI (Android APK)",
    description:
      "Download and install the Rupee Radar AI Android app. Step-by-step install instructions for Samsung, Xiaomi, OnePlus, Vivo, Pixel and more.",
    canonical: "https://rupeeradarai.com/download",
  });

  const [version, setVersion] = useState<LatestVersion | null>(null);
  const [brand, setBrand] = useState<Brand>("samsung");

  const [apkSize, setApkSize] = useState<string | null>(null);
  const [manifest, setManifest] = useState<string[] | null>(null);

  const [betaEmail, setBetaEmail] = useState("");
  const [betaLoading, setBetaLoading] = useState(false);
  const [betaError, setBetaError] = useState<string | null>(null);
  const [betaSubmitted, setBetaSubmitted] = useState(false);

  async function submitBetaRequest(e: FormEvent) {
    e.preventDefault();
    if (!betaEmail.trim() || betaLoading) return;
    setBetaLoading(true);
    setBetaError(null);
    try {
      await apiPost("/beta-tester-requests", { email: betaEmail.trim() });
      setBetaSubmitted(true);
      trackEvent("play_beta_request_submit", { source: "download_page" });
    } catch {
      setBetaError("Couldn't submit that — check the email and try again.");
    } finally {
      setBetaLoading(false);
    }
  }

  useEffect(() => {
    api<LatestVersion>("/app-version/latest?platform=android")
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  useEffect(() => {
    fetch(APK_VERSIONS_MANIFEST)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((v: unknown) => setManifest(Array.isArray(v) ? (v as string[]) : []))
      .catch(() => setManifest([]));
  }, []);

  const stable = version?.latestStable ?? version?.latestBeta ?? null;
  // The 3 builds before the current one, all served straight from the site.
  const previousVersions = (manifest ?? [])
    .filter((v) => v !== stable?.versionName)
    .slice(0, PREVIOUS_LIMIT);
  const brandInfo = BRAND_STEPS[brand];

  useEffect(() => {
    const url = apkUrlFor(stable?.versionName);
    fetch(url, { method: "HEAD" })
      .then((r) => {
        const len = Number(r.headers.get("content-length"));
        setApkSize(len > 0 ? formatMb(len) : null);
      })
      .catch(() => setApkSize(null));
  }, [stable?.versionName]);

  const sizeLabel = apkSize ?? "~11 MB";

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold mb-3">Download Rupee Radar AI</h1>
      <p className="text-app-muted mb-8">
        The Android app is currently installed directly (not yet on the Play Store). It's quick —
        download the file below, then follow the steps for your phone.
      </p>

      {/* Download card */}
      <div className="rounded-2xl border border-app-border bg-app-surface p-6 mb-10">
        <a
          href={apkUrlFor(stable?.versionName)}
          download
          onClick={() => trackEvent("apk_download", { source: "download_page", manufacturer: brand, version: stable?.versionName })}
          className="block w-full text-center rounded-xl bg-brand text-black font-bold text-lg py-4 hover:opacity-90 transition-opacity"
        >
          Download the Rupee Radar AI App
        </a>
        <p className="text-sm text-app-muted mt-3 text-center">
          {stable ? (
            <>
              <strong className="text-app-text">Version {stable.versionName}</strong> · Android 8.0
              and up · {sizeLabel}
            </>
          ) : (
            <>Android 8.0 and up · {sizeLabel}</>
          )}
        </p>
        <p className="text-xs text-app-muted mt-1 text-center">
          This link always serves the latest version.
          {previousVersions.length > 0 && (
            <>
              {" "}Need an older build? See{" "}
              <a href="#previous-versions" className="underline hover:text-app-text">
                Previous versions
              </a>{" "}
              below.
            </>
          )}
        </p>
        {stable?.releaseNotes && (
          <p className="text-sm text-app-muted mt-4 border-t border-app-border pt-4">
            <strong className="text-app-text">What's new:</strong> {stable.releaseNotes}
          </p>
        )}
      </div>

      {/* Google Play beta invite */}
      <div className="rounded-2xl border border-app-border bg-app-surface p-6 mb-10">
        <h2 className="font-semibold text-app-text mb-2">Rupee Radar AI is now in beta testing on Google Play</h2>
        <p className="text-sm text-app-muted mb-4">
          We're testing the Play Store version with a small group before it opens up to everyone.
          Want to help test it? Submit your Google account email below — once we've added it in
          Play Console, use the "Join the Google Play beta" link to accept the invite and install
          from the Play Store.
        </p>

        {betaSubmitted ? (
          <p className="text-sm text-app-text bg-app-bg border border-app-border rounded-lg px-4 py-3 mb-4">
            Thanks — we'll add that email to the tester list soon.
          </p>
        ) : (
          <form onSubmit={submitBetaRequest} className="flex flex-col sm:flex-row gap-3 mb-2">
            <input
              type="email"
              required
              value={betaEmail}
              onChange={(e) => setBetaEmail(e.target.value)}
              placeholder="you@gmail.com"
              className="flex-1 rounded-lg border border-app-border bg-app-bg text-app-text px-3 py-2.5"
            />
            <button
              type="submit"
              disabled={betaLoading}
              className="rounded-lg bg-brand text-black font-semibold px-5 py-2.5 hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {betaLoading ? "Submitting…" : "Request access"}
            </button>
          </form>
        )}
        {betaError && <p className="text-sm text-danger mb-3">{betaError}</p>}

        <a
          href="https://play.google.com/apps/internaltest/4701129163907111016"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackEvent("play_beta_invite_click", { source: "download_page" })}
          className="inline-block rounded-xl border border-brand text-brand font-semibold px-5 py-3 mt-2 hover:bg-brand hover:text-black transition-colors"
        >
          Join the Google Play beta
        </a>
        <p className="text-xs text-app-muted mt-3">
          Rupee Radar AI will be available to everyone on the Play Store soon — this page will
          link straight to it the moment that happens.
        </p>
      </div>

      {/* Previous versions — the last few builds, served straight from the site */}
      {previousVersions.length > 0 && (
        <div id="previous-versions" className="rounded-2xl border border-app-border bg-app-surface p-6 mb-10">
          <h2 className="font-semibold text-app-text">Previous versions</h2>
          <p className="text-sm text-app-muted mt-2 mb-1">
            Older builds are provided as-is. Install the same way as the current version.
          </p>
          <ul className="divide-y divide-app-border">
            {previousVersions.map((v) => (
              <li key={v} className="flex items-center justify-between py-3">
                <a
                  href={apkUrlFor(v)}
                  download
                  onClick={() =>
                    trackEvent("apk_download", { source: "download_page_archive", version: v })
                  }
                  className="font-medium text-app-text hover:text-brand"
                >
                  Version {v}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Common steps */}
      <h2 className="text-xl font-bold mb-3">How to install</h2>
      <ol className="list-decimal list-inside space-y-3 text-app-muted mb-8">
        <li>
          <Rich text="Tap **Download the Rupee Radar AI App** above. The file **rupee-radar-ai.apk** saves to your **Downloads**." />
        </li>
        <li>
          <Rich text="**Open the file** — tap the download notification, or open the **Files** / **My Files** app and go to **Downloads**." />
        </li>
        <li>
          <Rich text="Your phone will say it **can't install apps from this source**. That's expected for any app outside the Play Store — the next step turns it on, just for this one app you're installing from." />
        </li>
        <li>
          <Rich text="Follow your phone's exact steps below, then tap **Install** and **Open**." />
        </li>
      </ol>

      {/* Brand selector */}
      <div className="rounded-2xl border border-app-border bg-app-surface p-6">
        <label htmlFor="brand" className="block text-sm font-semibold text-app-text mb-2">
          Which phone do you have?
        </label>
        <select
          id="brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value as Brand)}
          className="w-full rounded-lg border border-app-border bg-app-bg text-app-text px-3 py-2.5 mb-5"
        >
          {(Object.keys(BRAND_LABELS) as Brand[]).map((b) => (
            <option key={b} value={b}>
              {BRAND_LABELS[b]}
            </option>
          ))}
        </select>

        <h3 className="text-lg font-bold mb-3">{brandInfo.title}</h3>
        <ol className="list-decimal list-inside space-y-3 text-app-muted">
          {brandInfo.steps.map((s, i) => (
            <li key={i}>
              <Rich text={s} />
            </li>
          ))}
        </ol>
      </div>

      {/* Play Protect — the harder block, distinct from the routine "unknown sources" prompt above */}
      <div className="rounded-2xl border border-app-border bg-app-surface p-6 mt-8">
        <h3 className="text-lg font-bold mb-3">"Play Protect blocked this app" — what to do</h3>
        <p className="text-sm text-app-muted mb-3">
          Because Rupee Radar AI isn't on the Play Store yet, Google Play Protect scans it fresh on
          your phone and — since it hasn't seen many installs of this exact file yet — can show a
          stronger warning than the usual "unknown sources" prompt, sometimes without an obvious
          "Install anyway" button. This happens to every new app distributed outside the Play
          Store; it isn't specific to this one. Here's how to get past it:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-sm text-app-muted mb-3">
          <li>
            <Rich text="If you see a warning screen, look for **“More details”** — tapping it usually reveals an **“Install anyway”** option even when the first screen doesn't show one." />
          </li>
          <li>
            <Rich text="If there's genuinely no override: go to **Settings → Security & privacy → More security & privacy → Google Play Protect** (naming varies slightly by phone), tap the **gear icon**, and turn **off** **“Scan apps with Play Protect.”** Install the app, then you can turn scanning back on." />
          </li>
          <li>
            <Rich text="This is a one-time thing per install — once the app is installed, Play Protect goes back to scanning everything else on your phone normally." />
          </li>
        </ol>
        <p className="text-xs text-app-muted">
          Rupee Radar AI is now in beta testing on Google Play (see above), which should reduce
          this warning for everyone over time as more installs happen through Play — it's not
          something a single app update can fix instantly. If you'd rather wait for the full Play
          Store release, we'll update this page the moment it's open to everyone.
        </p>
      </div>

      <div className="mt-8 text-sm text-app-muted space-y-2">
        <p>
          <strong className="text-app-text">Is this safe?</strong> Yes. The “unknown apps”
          warning appears for every app installed outside the Play Store, not because anything is
          wrong. You can turn the permission back off after installing.
        </p>
        <p>
          <strong className="text-app-text">Updates:</strong> come back to this page and download
          again — the app also tells you in-app when a newer version is available.
        </p>
        <p>
          Trouble installing? Email{" "}
          <a href="mailto:support@rupeeradarai.com" className="text-brand hover:underline">
            support@rupeeradarai.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
