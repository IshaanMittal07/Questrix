import type { MetadataRoute } from "next";

/**
 * Only the sign-in page is public; everything else needs a session. The
 * longest match wins, so `/login` stays allowed under `Disallow: /`. The
 * proxy lets this file through unauthenticated (#110: Lighthouse SEO).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/login", disallow: "/" },
  };
}
