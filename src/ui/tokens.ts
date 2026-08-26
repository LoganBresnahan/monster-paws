/**
 * The token roster /design renders. Values are read from the live stylesheet,
 * never listed here — adding a token to globals.css without adding its name
 * here leaves it invisible on the style guide, which is the only drift possible.
 */
export const COLOR_TOKENS = [
  { name: "background", role: "page ground" },
  { name: "foreground", role: "body text" },
  { name: "muted", role: "secondary text" },
  { name: "card", role: "raised surfaces" },
  { name: "honey", role: "celebration, badges, highlights — never warnings" },
  { name: "honey-deep", role: "hover / borders on honey" },
  { name: "leaf", role: "primary actions" },
  { name: "leaf-deep", role: "hover on leaf" },
  { name: "paw", role: "borders, illustration lines" },
] as const;

export const TYPE_SCALE = [
  { cls: "text-4xl font-bold", label: "display" },
  { cls: "text-3xl font-bold", label: "h1" },
  { cls: "text-xl font-bold", label: "h2" },
  { cls: "text-lg", label: "lead" },
  { cls: "text-base", label: "body" },
  { cls: "text-sm text-muted", label: "small / muted" },
  { cls: "font-mono text-sm", label: "mono" },
] as const;
