"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { analyticsEnabled, track } from "@/lib/analytics";

/**
 * Captures `$pageview` on first load and on every client-side route change. Manual rather
 * than the SDK's history patch, which double-fires on App Router navigations. The URL is
 * read from the location so the Pages base path is included, and its query string and
 * fragment are dropped: only the page is reported.
 */
function PageviewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    track("$pageview", { $current_url: window.location.origin + window.location.pathname });
  }, [pathname]);

  return null;
}

/** Renders nothing; the tracker is skipped without a key. */
export default function Analytics() {
  return analyticsEnabled ? <PageviewTracker /> : null;
}
