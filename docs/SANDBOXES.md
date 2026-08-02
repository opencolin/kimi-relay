# Token Factory Sandboxes (beta)

kimirelay can run commands — and whole harness sessions — inside
[Nebius Token Factory Sandboxes](https://tokenfactory.nebius.com/sandboxes/about):
disposable microVMs with network access, driven by the same `NEBIUS_API_KEY`
you already use for inference. The product is in beta behind an access
request; every kimirelay sandbox command maps a 401/403 to a message pointing
at the request form.

## Project header

Some Nebius accounts require a project on every Sandboxes call (the API
answers `400 Missing "Project" header` otherwise). Pass it per command with
`--project <id>` or once via `NEBIUS_PROJECT=<id>`; the id is shown in the
Token Factory console. Live-observed permission model: a key can hold the
`spawn` permission without `list`, so `kimirelay sandbox status` reports a
list-permission 403 as qualified success and the definitive check is
`kimirelay sandbox run -- echo ok`. A `403 Insufficient permissions: spawn`
means the key needs Sandboxes permissions granted for that project in the
console - it is not a beta-access problem.

## Commands

```sh
kimirelay sandbox status          # your key's exact Sandboxes permissions (via /whoami)
kimirelay sandbox run echo hello  # one shell command in a disposable sandbox
kimirelay sandbox run --image tag:ubuntu:latest --timeout 300 -- apt-get moo
kimirelay sandbox run --keep -- make build       # snapshot the filesystem on success
kimirelay sandbox run --fetch /work/report.md -- "make report"  # download artifacts after
kimirelay sandbox fetch <image-uuid> /work/out.txt --out out.txt
kimirelay sandbox prebake         # bake tooling into tag:kimirelay:prebaked
kimirelay sandbox advisory        # print the agent-instructions advisory block
kimirelay sandbox advisory --write  # append it to ~/.claude/CLAUDE.md + ~/.codex/AGENTS.md
```

## Artifacts (result images)

Every **non-disposable** run snapshots its full filesystem into an immutable
result image on success. `--keep` turns that on; `--fetch <path>` (implying
`--keep`) downloads files from the snapshot right after the run, and
`kimirelay sandbox fetch <image-uuid> <path>` pulls files from any past
result image. `klaude --sandbox --keep …` prints the result image UUID so a
remote session's outputs (the repo lives at `/work`) can be retrieved without
asking the agent to push. Untagged images are retained for 180 days.

## Prebaked images

`kimirelay sandbox prebake` runs the tooling install (kimirelay + Claude Code

- Codex CLIs) once in a non-disposable sandbox and tags the result image
  (default `kimirelay:prebaked`). Because every bootstrap install is
  `command -v`-guarded, later runs with `--image tag:kimirelay:prebaked` skip
  the ~1-minute cold bootstrap entirely:

```sh
kimirelay sandbox prebake
klaude --sandbox --image tag:kimirelay:prebaked -p "fix the failing test"
```

Re-run `prebake` whenever you want the baked tooling refreshed (the tag moves
to the new image).

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
- **Results live in the transcript by default.** Run with `--keep` to
  snapshot the sandbox filesystem into a result image and pull files out via
  `kimirelay sandbox fetch` (see Artifacts above); or ask the agent to push.
- **Cold bootstrap on the stock image.** Each `tag:ubuntu:latest` run
  installs tooling from scratch (~a minute); `kimirelay sandbox prebake`
  eliminates this (see Prebaked images above).
- **No true TTY, by API design.** The API has no PTY/attach/resize surface -
  all I/O is HTTP (stdin POSTs + an SSE event stream); even Nebius's own
  `contree shell` is a client-side line-mode REPL. Full-screen TUIs will not
  run remotely; headless tasks are the supported shape.

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
