# Design MCP — Magic (21st.dev)

NoteTaker uses the [**Magic MCP**](https://21st.dev/magic) server to help with the
**design step**: turning a plain-English description of a UI ("a calm, focused
note row with a timestamp chip on the left") into real, polished React + CSS
components you can drop into `src/`. It pulls from a large library of
production-grade component patterns, so the output tends to look and feel
*human* — sensible spacing, hover/focus states, transitions — instead of the
flat boilerplate an LLM writes from scratch.

## What it's good for here

- **Componenting from a description** — "build a transcript drawer cue row" and
  get a styled component back, matched to React + TypeScript.
- **Design ideas / variations** — ask for 2–3 looks for the same element and
  compare before committing.
- **Polish passes** — take an existing plain component and ask Magic to restyle
  it (micro-interactions, empty states, dark/light theming).
- **Logos / icons** — Magic can also fetch SVG logos and icons.

It complements (does not replace) the keyboard-first, minimal aesthetic the app
already has — treat its output as a starting draft you refine, not final code.

## One-time setup

1. **Get an API key** — sign in at <https://21st.dev/magic/console> and create a
   key (free tier available).
2. **Expose it to Claude Code as `MAGIC_API_KEY`.** The key is a secret — it is
   read from your environment, never committed. Pick whichever fits how you run
   Claude Code:

   - **Claude Code on the web:** add `MAGIC_API_KEY` as an environment variable
     on the environment (Settings → Environment variables).
   - **Local shell:** add to your shell profile:
     ```bash
     export MAGIC_API_KEY="your-key-here"
     ```

3. **Restart Claude Code** so it picks up `.mcp.json` and the env var. On first
   load it will ask you to approve the project MCP server — approve `magic`.

The server itself is declared in `.mcp.json` at the repo root and runs on demand
via `npx`, so there is nothing to install.

## Using it

Once it's running, just ask in natural language, e.g.:

> "Use Magic to design a polished empty-state for the maps library — friendly,
> a little playful, with a 'Create your first map' call to action."

Claude will call the Magic tool, show you the generated component, and you can
have it wired into `src/` and themed to match the app's tokens.
