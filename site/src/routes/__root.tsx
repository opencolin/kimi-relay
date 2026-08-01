/// <reference types="vite/client" />
import type { ReactNode } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: "Kimi Relay - Connect Claude Code, Codex, OpenCode & Pi Code to Kimi K3",
      },
      {
        name: "description",
        content:
          "A local relay that connects Claude Code, Codex, OpenCode, and Pi Code to Kimi K3 and other open models on Nebius Token Factory - short commands, zero edits to your real tool config.",
      },
      { property: "og:title", content: "Kimi Relay" },
      {
        property: "og:description",
        content:
          "Connect your coding agents to Kimi K3 on Nebius Token Factory. One install, four harnesses, config-free.",
      },
      { property: "og:image", content: "/nebius-token-factory.png" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Kimi Relay" },
      { name: "twitter:image", content: "/nebius-token-factory.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/nebius-token-factory.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/nebius-token-factory.png" },
      { rel: "llms-txt", href: "/llms.txt" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
