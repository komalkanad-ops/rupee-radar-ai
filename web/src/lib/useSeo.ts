import { useEffect } from "react";

interface SeoOptions {
  title: string;
  description: string;
  canonical?: string;
  robots?: string;
  jsonLd?: object;
}

// Hand-rolled instead of a Helmet-style library: this is a pure client-rendered SPA (no SSR), and
// react-helmet-async 3.0.0 was tried first but, verified empirically in a real browser (not just
// "should work per the docs"), its <Helmet> tags never actually applied in this Vite + React 18.3.1
// setup — title/meta stayed frozen at whatever index.html shipped, across every route. Rather than
// debug a third-party library's internals further, this direct DOM approach is small enough to
// verify and trust completely.
function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function useSeo(options: SeoOptions) {
  const jsonLdString = options.jsonLd ? JSON.stringify(options.jsonLd) : undefined;

  useEffect(() => {
    const prevTitle = document.title;
    document.title = options.title;

    upsertMeta("name", "description", options.description);
    upsertMeta("property", "og:title", options.title);
    upsertMeta("property", "og:description", options.description);
    upsertMeta("property", "og:url", options.canonical ?? window.location.href);
    upsertMeta("name", "twitter:title", options.title);
    upsertMeta("name", "twitter:description", options.description);
    upsertMeta("name", "robots", options.robots ?? "index, follow");

    let canonicalEl = document.querySelector('link[rel="canonical"]');
    if (!canonicalEl) {
      canonicalEl = document.createElement("link");
      canonicalEl.setAttribute("rel", "canonical");
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.setAttribute("href", options.canonical ?? window.location.href);

    let jsonLdEl: HTMLScriptElement | null = null;
    if (jsonLdString) {
      jsonLdEl = document.createElement("script");
      jsonLdEl.type = "application/ld+json";
      jsonLdEl.textContent = jsonLdString;
      document.head.appendChild(jsonLdEl);
    }

    return () => {
      document.title = prevTitle;
      if (jsonLdEl) jsonLdEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.title, options.description, options.canonical, options.robots, jsonLdString]);
}
