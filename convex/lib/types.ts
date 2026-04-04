export interface ExtractedContent {
  title: string;
  author: string | null;
  publication_name: string;
  sender_email: string | null;
  issue_date: string | null;
  content_html: string;
  summary: string;
  images: string[];
}

export interface DesignProfile {
  color_primary: string;
  color_secondary: string;
  color_accent: string;
  font_mood:
    | "serif-formal"
    | "serif-casual"
    | "sans-formal"
    | "sans-casual"
    | "mono-technical"
    | "mixed-editorial";
  layout_style:
    | "longform-essay"
    | "digest-links"
    | "mixed-sections"
    | "image-heavy";
  has_dividers: boolean;
  has_pullquotes: boolean;
  has_callout_boxes: boolean;
}
