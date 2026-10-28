# UI refinement research

## Request and method

The owner requested using the local `Downloads/ui-design-mcp` to refine the existing Maintenance UI/UX, with shadcn permitted. Read its bundled `ui-design` skill and used the actual MCP server over its documented stdio transport. No global connector configuration was changed. The cache and research media are ignored under `.local/ui-refinement/`; no operational records or project source were sent to reference providers.

The cold dashboard lookup exceeded its first 60-second client deadline. Reused a private consistent copy of the existing reference metadata cache and a bounded 120-second client deadline. The subsequent live dashboard search returned four web references with no fallback notes. Component search returned three patterns with no notes. Full-image reads used MCP `get_image`. Its optional Sharp converter was blocked by macOS code-signing policy, so the tool served original JPEGs; those were inspected without changing system protections or the downloaded MCP installation. Cached and live provenance remain distinct below.

## Studied references

| Reference | Provenance | Extracted palette / fonts | Pattern adopted |
| --- | --- | --- | --- |
| [Navan admin dashboard](https://images.refero.design/screenshots/navan.com/desktop/bf8d8987-b8c0-44e3-85dd-fe8f27798ac8/0.jpg) | Existing MCP reference metadata, retrieved again with `get_image`; live search also returned the Navan manager dashboard | `#28282a`, `#9f9ca7`, `#f8f8f8`, `#833cbc`, `#6a6973`; Larsseit, NVN, Neue Haas Grotesk Text | Keep organizational/navigation context separate from the primary workspace. Group destinations and give the current task visual priority. |
| [Zendesk dashboard library](https://images.refero.design/screenshots/zendesk.com/desktop/8d541438-a210-4434-a2b8-cd00cb21eedb/0.jpg) | Live MCP dashboard search and full-image read | `#eeefef`, `#58656b`, `#3475af`, `#437b7d`, `#53afd8`; San Francisco, Lucida Grande | Search belongs beside list filters; empty results should explain scope and offer recovery. Do not copy the reference's untranslated empty-state token. |
| [Resend metrics](https://images.refero.design/screenshots/resend.com/desktop/12775b1a-1153-44ef-981e-a52cb26c5174/0.jpg) | Existing MCP reference metadata and full-image read | `#a4a09f`, `#5c565a`, `#ececec`, `#262527`, `#040404`; Inter, ABC Favorit | Use calm panel borders, strong data hierarchy and small contextual labels. Distinguish metrics from actions without heavy decoration. |
| [Delphi insights](https://images.refero.design/screenshots/delphi.ai/desktop/b59fe85e-a967-4305-a31d-a5d6df54e7a1/0.jpg) | Live MCP dashboard search; full-image read from the resulting cache | `#fbfbfb`, `#cacaca`, `#323733`, `#70706f`, `#b13c19`; no fonts supplied | Secondary detail belongs in a focused, labeled dialog while the underlying workspace remains recognizable. Adopt this for page finding rather than changing a maintenance record. |

Component search also returned VIDEOASK search/empty-state examples and Simple App Shipper's navigation bar. These are supporting interaction references; the web-product screens drive the operational layout.

## Maintenance design decisions

The existing owner-selected Timescale language remains the identity: warm paper `#f7f7f2`, ink `#191917`, muted `#64645d`, borders `#d7d7ce`, orange `#ff5b29`, chartreuse `#f5ff80`, with locally bundled Geist/Geist Mono. Reference-product colors and logos are research metadata, not a new brand or imported product assets.

1. Add an accessible **Find a page** command dialog to the shared shell. It searches existing navigation destinations, supports keyboard selection and escape/focus return, and exposes only current-role destinations. It does not search records or execute maintenance actions.
2. Put a clearly scoped **Search loaded work orders** field beside the existing server status filter. Match only visible authorized records, retain server totals/pagination, explain that unloaded records are excluded, and offer clear-search recovery.
3. Expand the existing shadcn-style Button and use reusable Input/Textarea primitives in sign-in and issue reporting. Add a Radix-backed shadcn-style Dialog and cmdk command primitives for reliable focus/keyboard behavior, adapted to existing CSS tokens rather than running an overwrite-style global initializer.
4. Reduce decorative competition within operational screens, improve control grouping and list-card hierarchy, and keep the expressive blueprint treatment on the landing/overview. Retain all synthetic-data labels, role guidance and evidence warnings.
5. Give initial workspace loading a neutral structural skeleton without fabricated values. Keep explicit loading text, reduced-motion support and current error recovery.

The user's refinement request already authorizes these changes, so the skill's approval checkpoint does not require a second permission request. No commit, publication or deployment is included. Shadcn sources consulted: [Radix Command](https://ui.shadcn.com/docs/components/radix/command), [Radix Dialog](https://ui.shadcn.com/docs/components/radix/dialog), and the official [registry Command implementation](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/command.tsx).

Executed verification and remaining limits belong in `docs/VERIFICATION.md`.
