export type TextBlock = { text: string; where?: string };
export type LinkItem = { text: string; href: string; where?: string };
export type ImageItem = {
  alt: string;
  hash: string | null;
  src: string;
  error?: string;
};

export type ContentModel = {
  texts: TextBlock[];
  links: LinkItem[];
  images: ImageItem[];
};

export type LayoutBox = {
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type MismatchKind =
  | "text_missing"
  | "text_extra"
  | "text_changed"
  | "link_missing"
  | "link_extra"
  | "link_changed"
  | "image_missing"
  | "image_extra"
  | "image_changed"
  | "image_error"
  | "layout_missing"
  | "layout_extra"
  | "layout_changed";

export type Mismatch = {
  kind: MismatchKind;
  index?: number;
  oldValue?: string;
  newValue?: string;
  oldWhere?: string;
  newWhere?: string;
  detail?: string;
};

export type PageStatus = "pass" | "fail" | "error";

export type PageResult = {
  oldPath: string;
  newPath: string;
  status: PageStatus;
  mismatches: Mismatch[];
  errorReason?: string;
};

export type FetchResult =
  | { ok: true; status: number; html: string }
  | { ok: false; status: number; html?: string; error: string };

export type ExtractResult =
  | { ok: true; model: ContentModel }
  | { ok: false; error: string };

export type MappingPair = { oldPath: string; newPath: string };
