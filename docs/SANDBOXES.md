# Token Factory Sandboxes (beta)

kimirelay can run commands — and whole harness sessions — inside
[Nebius Token Factory Sandboxes](https://tokenfactory.nebius.com/sandboxes/about):
disposable microVMs with network access, driven by the same `NEBIUS_API_KEY`
you already use for inference. The product is in beta behind an access
request; every kimirelay sandbox command maps a 401/403 to a message pointing
at the request form.

## Commands

```sh
kimirelay sandbox status          # does your key have Sandboxes access?
kimirelay sandbox run echo hello  # one shell command in a disposable sandbox
kimirelay sandbox run --image tag:ubuntu:latest --timeout 300 -- apt-get moo
kimirelay sandbox advisory        # print the agent-instructions advisory block
kimirelay sandbox advisory --write  # append it to ~/.claude/CLAUDE.md + ~/.codex/AGENTS.md
```

## Remote harness sessions

```sh
klaude --sandbox -p "fix the failing test and commit"
kodex --sandbox exec "add input validation to the signup form"
```

What happens: the wrapper spawns a disposable, networked instance, bootstraps
it (installs kimirelay via the public one-liner plus the agent CLI), clones
your repository's **pushed** state (`origin` + current branch), and runs the
harness headlessly with your passthrough args. Output streams back as the
operation progresses; the sandbox is disposable and vanishes afterwards.

Honest limitations of this first pass:

- **Headless only.** The beta API surface we build on (instance spawn +
  operation polling) does not carry an interactive TTY, so pass a task
  (`-p` / `exec ...`), not an interactive session.
- **Pushed state only.** The sandbox clones `origin`; local uncommitted
  changes do not travel. The CLI says so at launch. Private repositories work
  only if the clone URL embeds credentials the sandbox can use.
- **Results live in the transcript.** The agent's commits stay inside the
  disposable sandbox unless the task itself pushes them (e.g. ask the agent
  to push a branch). Artifact download via the inspect API is a planned
  follow-up.
- **Cold bootstrap.** Each run installs tooling from scratch (~a minute).
  Prebaked images via the Sandboxes image-import API are the obvious
  optimization once access is settled.

## Advisory block

`kimirelay sandbox advisory --write` appends a marked, idempotent block to
`~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` steering agents to prefer
sandboxes for risky commands. Steering only — the `--sandbox` wrapper is the
enforcement boundary.

## API notes

Client: `packages/cli/src/lib/sandbox/contree.ts` against
`https://api.tokenfactory.nebius.com/sandboxes` (`POST /v1/instances`,
`GET /v1/operations/{id}`; Bearer auth). Beta limits per the docs: 50
simultaneous operations, checkpoint images retained 180 days. The operation
payload shape is normalized defensively (`normalizeOperation`) because the
beta surface is still settling.
