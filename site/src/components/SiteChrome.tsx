import { Link } from "@tanstack/react-router";

export const githubUrl = "https://github.com/opencolin/kimi-relay";
export const docsUrl = "https://github.com/opencolin/kimi-relay/blob/main/README.md";
export const nebiusApiKeysUrl = "https://tokenfactory.nebius.com/?modals=create-api-key";
export const llmsUrl = "/llms.txt";
export const freeCreditsUrl = "https://dev.nebius.com/builders";

export function SiteNav() {
  return (
    <>
      <a
        href={freeCreditsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mx-[calc(50%-50vw)] flex items-center justify-center gap-2 border-b border-line bg-lime/10 px-6 py-2 text-center text-[13px] font-medium text-lime transition hover:bg-lime/15"
      >
        🎁 New: $25 in Token Factory credits + $25 in Tavily credits for new accounts — claim yours
        <ArrowUpRight />
      </a>
      <header className="flex items-center gap-3 py-5">
        <a href="/" className="flex items-center gap-2.5">
          <BrandMark />
          <span className="flex items-baseline gap-1.5">
            <span className="text-[15.5px] font-semibold tracking-tight text-ink">Kimi.Guide</span>
          </span>
        </a>
        <nav className="ml-auto flex items-center gap-1 text-[14px] font-medium text-muted">
          <Link
            className="hidden rounded-lg px-3 py-2 transition hover:bg-code hover:text-ink sm:block"
            to="/showcase"
          >
            Showcase
          </Link>
          <a
            className="hidden rounded-lg px-3 py-2 transition hover:bg-code hover:text-ink sm:block"
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Docs
          </a>
          <a
            className="hidden rounded-lg px-3 py-2 transition hover:bg-code hover:text-ink sm:block"
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <a
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-violet px-3.5 py-2 text-[13.5px] font-semibold text-white shadow-[0_1px_2px_rgba(10,10,10,.14),0_8px_20px_-8px_rgba(106,92,243,.7)] transition hover:brightness-[1.06] active:scale-[.98]"
            href={nebiusApiKeysUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get API key
            <ArrowUpRight />
          </a>
        </nav>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-4 flex flex-col gap-4 border-t border-line py-8 text-[13px] text-muted sm:flex-row sm:items-center">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="font-semibold text-ink">Kimi.Guide</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:ml-auto">
        <Link className="transition hover:text-ink" to="/showcase">
          Showcase
        </Link>
        <a
          className="transition hover:text-ink"
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Docs
        </a>
        <a
          className="transition hover:text-ink"
          href={githubUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        <a
          className="transition hover:text-ink"
          href={llmsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          llms.txt
        </a>
        <a
          className="transition hover:text-ink"
          href={nebiusApiKeysUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Nebius keys
        </a>
        <span className="text-faint">
          MIT licensed · a friendly fork of{" "}
          <a
            className="underline decoration-faint/40 underline-offset-2 transition hover:text-ink"
            href="https://github.com/shivaylamba/nebius-tf-relay"
            target="_blank"
            rel="noopener noreferrer"
          >
            nebius-tf-relay
          </a>
        </span>
      </div>
    </footer>
  );
}

export function BrandMark() {
  return (
    <span className="relative flex size-8 items-center justify-center rounded-[9px] bg-surface ring-1 ring-white/10">
      <span className="absolute inset-0 rounded-[9px] bg-[radial-gradient(120%_120%_at_20%_0%,rgba(198,241,53,.4)_0%,rgba(198,241,53,0)_55%)]" />
      <PiMarkWhite />
    </span>
  );
}

function PiMarkWhite() {
  return (
    <svg className="relative size-[18px]" viewBox="0 0 800 800" aria-hidden="true">
      <path
        fill="#c6f135"
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path fill="#ffffff" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

export function ArrowUpRight() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 17L17 7M17 7H8M17 7v9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
