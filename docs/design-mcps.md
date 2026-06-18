# Design MCP servers

This repo is configured with three MCP servers (see `.mcp.json`) to help with the
**design step** of building the web app — figuring out what the UI should look like,
generating components, and iterating on the look & feel.

> Scope: these are for the **web app** build (`npm run dev`). They are not tied to the
> Tauri desktop target.

## The servers

### `magic` — 21st.dev Magic
Generates polished React + Tailwind components from a plain-language description, and
can refine existing components.

- **component_builder** — describe a component, get production-ready JSX.
- **component_inspiration** — browse design ideas/variants before committing.
- **component_refiner** — paste an existing component to redesign/polish it.
- **logo_search** — drop in brand logos as SVG/JSX.

**Setup:** get a free API key from <https://21st.dev> → Console → API Keys, then expose
it to the session as the `MAGIC_API_KEY` environment variable. `.mcp.json` reads it via
`${MAGIC_API_KEY}` so the key is never committed.

### `shadcn` — shadcn/ui registry
Pulls accessible, well-designed primitives (command palette, dialogs, dropdowns) by
name. A good fit for this keyboard-first app.

### `playwright` — Playwright MCP
Screenshots and drives the running app so design changes can be reviewed against what
the UI actually looks like, then iterated on. Closes the design loop.

## Note on styling

NoteTaker currently uses hand-written CSS (no Tailwind). Magic and shadcn both assume
**Tailwind**. To use their output directly, add Tailwind to the web build; otherwise the
generated markup is used for ideas/structure and translated into the existing CSS
conventions.
