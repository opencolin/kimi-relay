import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, githubUrl, SiteFooter, SiteNav } from "../components/SiteChrome";

type ShowcaseProject = {
  name: string;
  description: string;
  url: string;
  author: string;
  emoji: string;
  tags: string[];
};

const submitUrl = `${githubUrl}/new/main/site/src/showcase/projects`;
const howToUrl = `${githubUrl}/blob/main/site/src/showcase/README.md`;

const modules = import.meta.glob("../showcase/projects/*.json", {
  eager: true,
}) as Record<string, { default: ShowcaseProject }>;

const projects = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

export const Route = createFileRoute("/showcase")({
  head: () => ({
    meta: [
      { title: "Showcase - Built with Kimi K3 | Kimi.Guide" },
      {
        name: "description",
        content:
          "Community projects built with Kimi K3: coding agents, inference servers, research tools, benchmarks, and kernels. Submit yours with a pull request.",
      },
    ],
  }),
  component: Showcase,
});

function Showcase() {
  return (
    <div className="theme-dark min-h-screen">
      {/* subtle top glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_100%_at_50%_-10%,rgba(198,241,53,.08)_0%,rgba(7,12,25,0)_70%)]"
      />

      <div className="mx-auto max-w-[1120px] px-6 max-[520px]:px-4">
        <SiteNav />

        {/* HEADER */}
        <section className="pt-14 pb-4 text-center max-[520px]:pt-10">
          <span className="inline-flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-violet uppercase">
            <span className="size-1.5 rounded-full bg-lime" />
            Showcase
          </span>
          <h1 className="mx-auto mt-4 max-w-[760px] text-balance text-[clamp(32px,5.6vw,52px)] font-semibold leading-[1.06] tracking-[-0.02em] text-ink">
            Built with{" "}
            <span className="relative whitespace-nowrap">
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-1 h-[9px] rounded-full bg-lime/40"
              />
              <span className="relative">Kimi K3</span>
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] text-pretty text-[17px] leading-relaxed text-muted">
            Coding agents, inference servers, research tools, benchmarks, and kernels from the
            community. Your project belongs here too.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href={submitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-lime px-4 py-2.5 text-[13.5px] font-semibold text-surface transition hover:brightness-[1.03] active:scale-[.98]"
            >
              Submit your project
              <ArrowUpRight />
            </a>
            <a
              href={howToUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-white/[.04] px-4 py-2.5 text-[13.5px] font-medium text-muted transition hover:border-faint hover:text-ink"
            >
              How it works
            </a>
          </div>
          <p className="mt-3 text-[12.5px] text-faint">
            One JSON file, one pull request — see the folder README.
          </p>
        </section>

        {/* GRID */}
        <section className="mt-10 mb-6">
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col rounded-2xl border border-line-strong bg-canvas p-6 transition hover:border-faint hover:shadow-[0_1px_2px_rgba(10,10,10,.04),0_16px_40px_-24px_rgba(10,15,30,.28)]"
              >
                <div className="flex items-start justify-between">
                  <span className="relative flex size-11 items-center justify-center overflow-hidden rounded-xl border border-line-strong bg-code text-[22px]">
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-[radial-gradient(120%_120%_at_20%_0%,rgba(198,241,53,.14)_0%,rgba(198,241,53,0)_60%)]"
                    />
                    <span className="relative">{p.emoji}</span>
                  </span>
                  <span className="mt-1 text-faint opacity-0 transition group-hover:opacity-100">
                    <ArrowUpRight />
                  </span>
                </div>
                <div className="mt-4 flex items-baseline gap-2.5">
                  <h2 className="text-[17px] font-semibold text-ink">{p.name}</h2>
                  <span className="truncate font-mono text-[12.5px] text-faint">{p.author}</span>
                </div>
                <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">
                  {p.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-white/[.05] px-2.5 py-1 font-mono text-[11.5px] text-muted ring-1 ring-white/10"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </a>
            ))}
          </div>

          {/* submit card at the end of the grid */}
          <div className="mt-3.5">
            <a
              href={submitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-8 text-[14.5px] font-medium text-faint transition hover:border-faint hover:text-ink"
            >
              <span className="flex size-8 items-center justify-center rounded-lg border border-line-strong bg-code text-[16px] transition group-hover:border-faint">
                +
              </span>
              Built something with Kimi? Add it to the showcase with a PR.
            </a>
          </div>
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
