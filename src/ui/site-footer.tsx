import Link from "next/link";
import { CONTACT_EMAIL, SOURCE_URL } from "@/ui/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-paw/20 px-6 py-8 text-sm text-muted">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p>
          © {new Date().getFullYear()} Monster Paws · Under construction
        </p>
        <nav aria-label="Site" className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-foreground">
            Contact: <span className="font-medium text-foreground">{CONTACT_EMAIL}</span>
          </a>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            Source on GitHub
          </a>
          {/* `/design` 404s in production (ADR-0016), so a link to it must never render there. */}
          {process.env.NODE_ENV !== "production" && (
            <Link href="/design" className="underline hover:text-foreground">
              Design
            </Link>
          )}
        </nav>
      </div>
    </footer>
  );
}
