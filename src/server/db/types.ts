export type BioPageTheme = {
  preset?: string; // named preset id, e.g. "minimal", "midnight"
  accentColor?: string; // hex, used for buttons/links
  buttonStyle?: "rounded" | "pill" | "sharp" | "outline";
  background?: {
    type: "solid" | "gradient";
    color?: string; // solid background
    from?: string; // gradient start
    to?: string; // gradient end
  };
  font?: string; // named font key
};

export type BioSocialLink = {
  platform: string; // twitter, instagram, tiktok, youtube, github, linkedin, website, ...
  url: string;
};

// Reserved team slugs that cannot be used
export const RESERVED_TEAM_SLUGS = [
  "www",
  "api",
  "app",
  "admin",
  "dashboard",
  "mail",
  "smtp",
  "ftp",
  "ssh",
  "support",
  "help",
  "docs",
  "blog",
  "status",
  "cdn",
  "static",
  "assets",
  "img",
  "images",
  "js",
  "css",
  "fonts",
  "media",
  "download",
  "downloads",
  "login",
  "signin",
  "signup",
  "register",
  "auth",
  "oauth",
  "sso",
  "account",
  "accounts",
  "billing",
  "payment",
  "payments",
  "checkout",
  "subscribe",
  "subscription",
  "pricing",
  "terms",
  "privacy",
  "legal",
  "security",
  "abuse",
  "spam",
  "report",
  "null",
  "undefined",
  "test",
  "testing",
  "dev",
  "development",
  "staging",
  "prod",
  "production",
  "demo",
  "example",
  "sample",
];
