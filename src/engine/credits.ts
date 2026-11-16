import type { Formula } from "./formula/types";

export const UNVERIFIED_LABEL = "unverified";

/** The stored sentinel for an unknown author is the Swedish word "okänd" (project rule, kept as data); people see "unknown". */
export const displayCreditName = (name: string): string => (name === "okänd" ? "unknown" : name);

export interface CreditLine {
  text: string;
  /** Set for sources that have a web link. */
  href?: string;
  verified: boolean;
}

/** One line per author, ready to show on screen. Unverified names are marked. */
export function authorLines(f: Formula): CreditLine[] {
  return f.credits.map((c) => ({
    text: c.role ? `${displayCreditName(c.name)} – ${c.role}` : displayCreditName(c.name),
    verified: c.status === "verified",
  }));
}

export function sourceLines(f: Formula): CreditLine[] {
  return f.sources.map((s) => ({
    text: s.url ?? s.reference ?? "",
    ...(s.url ? { href: s.url } : {}),
    verified: s.status === "verified",
  }));
}

/** Short text for the screen: "Mandelbulb – Daniel White (unverified), …". */
export function creditHeadline(f: Formula): string {
  const names = f.credits.map((c) => (c.status === "verified" ? displayCreditName(c.name) : `${displayCreditName(c.name)} (${UNVERIFIED_LABEL})`));
  return `${f.name} – ${names.join(", ")}`;
}

/** True when anything in the credits still needs checking by a person. */
export function hasUnverifiedCredits(f: Formula): boolean {
  return !f.reviewed || [...f.credits, ...f.sources].some((x) => x.status !== "verified");
}
