import { useEffect, useState } from "react";
import { api } from "../lib/api";
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

// Every past release is attached to the GitHub `apk-archive` release on the public repo. The
// "Previous versions" list below is rendered live from its assets — so this repo only ever carries
// the single current APK (no growing archive folder, no separate subdomain).
const ARCHIVE_RELEASE_API =
  "https://api.github.com/repos/komalkanad-ops/rupee-radar-ai/releases/tags/apk-archive";
const ARCHIVE_RELEASE_PAGE =
  "https://github.com/komalkanad-ops/rupee-radar-ai/releases/tag/apk-archive";

interface ArchiveApk {
  version: string;
  url: string;
  size: number;
}

// Descending semver-ish compare on "1.0.43" style strings.
function cmpVersionDesc(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

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
  const [archive, setArchive] = useState<ArchiveApk[] | null>(null);
  const [archiveFailed, setArchiveFailed] = useState(false);

  useEffect(() => {
    api<LatestVersion>("/app-version/latest?platform=android")
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  useEffect(() => {
    fetch(ARCHIVE_RELEASE_API)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rel: { assets?: { name: string; browser_download_url: string; size: number }[] }) => {
        const apks = (rel.assets ?? [])
          .filter((a) => a.name.endsWith(".apk"))
          .map((a) => ({
            version: a.name.replace(/^rupee-radar-ai-/, "").replace(/\.apk$/, ""),
            url: a.browser_download_url,
            size: a.size,
          }))
          .sort((a, b) => cmpVersionDesc(a.version, b.version));
        setArchive(apks);
      })
      .catch(() => setArchiveFailed(true));
  }, []);

  const stable = version?.latestStable ?? version?.latestBeta ?? null;
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
          This link always serves the latest version. Need an older build? See{" "}
          <a href="#previous-versions" className="underline hover:text-app-text">
            Previous versions
          </a>{" "}
          below.
        </p>
        {stable?.releaseNotes && (
          <p className="text-sm text-app-muted mt-4 border-t border-app-border pt-4">
            <strong className="text-app-text">What's new:</strong> {stable.releaseNotes}
          </p>
        )}
      </div>

      {/* Previous versions — rendered live from the GitHub apk-archive release */}
      <details id="previous-versions" className="rounded-2xl border border-app-border bg-app-surface p-6 mb-10">
        <summary className="cursor-pointer font-semibold text-app-text select-none">
          Previous versions
        </summary>
        {archiveFailed ? (
          <p className="text-sm text-app-muted mt-4">
            Couldn't load the list right now —{" "}
            <a href={ARCHIVE_RELEASE_PAGE} className="underline hover:text-app-text" target="_blank" rel="noreferrer">
              see every version on GitHub
            </a>
            .
          </p>
        ) : !archive ? (
          <p className="text-sm text-app-muted mt-4">Loading…</p>
        ) : (
          <>
            <p className="text-sm text-app-muted mt-3 mb-1">
              Older builds are provided as-is. Install the same way as the current version.
            </p>
            <ul className="divide-y divide-app-border">
              {archive
                .filter((v) => v.version !== stable?.versionName)
                .map((v) => (
                  <li key={v.version} className="flex items-center justify-between py-3">
                    <a
                      href={v.url}
                      download
                      onClick={() =>
                        trackEvent("apk_download", {
                          source: "download_page_archive",
                          version: v.version,
                        })
                      }
                      className="font-medium text-app-text hover:text-brand"
                    >
                      Version {v.version}
                    </a>
                    <span className="text-xs text-app-muted">{formatMb(v.size)}</span>
                  </li>
                ))}
            </ul>
          </>
        )}
      </details>

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
