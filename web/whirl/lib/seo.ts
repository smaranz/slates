import type { Metadata } from "next";

import { SITE_NAME } from "@whirl/lib/site";

export { SITE_NAME, SITE_URL } from "@whirl/lib/site";
export const DEFAULT_TITLE =
  "Whirl — The AI chat app that actually cares about you";
export const DEFAULT_DESCRIPTION =
  "An AI chat app with memory that actually cares about you. Chat across the best models, create living documents and visualizations, and pick up right where you left off.";
export const OG_IMAGE_PATH = "/whirl-og.png";

export type SocialImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
};

export function publicPageMetadata({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  image,
}: {
  title: string;
  description?: string;
  path: string;
  /** A card of the page's own; the site-wide one otherwise. */
  image?: SocialImage;
}): Metadata {
  const card: SocialImage = image ?? {
    url: OG_IMAGE_PATH,
    width: 1200,
    height: 630,
    alt: title,
  };
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: SITE_NAME,
      title,
      description,
      url: path,
      images: [card],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: card.url, alt: card.alt }],
    },
  };
}
