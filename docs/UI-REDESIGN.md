# Interface redesign — October 2026

The owner requested a project-wide redesign using the [Timescale reference on Refero](https://styles.refero.design/style/ae175f23-1ec7-47ea-9380-7bff7041028b), plus a public landing page with a Dashboard entry. This is implemented in the existing Next.js application; it does not publish or deploy the app.

## Routes and navigation

- `/` is now a public product introduction, rather than a redirect. It explains existing capabilities and the human maintenance handoff without querying operational records or presenting invented performance statistics. The line drawing is explicitly conceptual, not the confirmed WH-C model.
- **Dashboard** and the landing CTAs lead to `/machines`. Existing protected components send signed-out visitors to `/login`; signed-in users enter their authorized registry. The landing page remains available to signed-in users.
- The platform sidebar groups Workspace, Operations, Insights and Knowledge. The current route is identified visually and with `aria-current`. Machine overview is a separate destination from the registry. Email alerts remain available only in the existing authorized Technician/Head views.
- On mobile, navigation collapses behind a labeled button with `aria-expanded` and `aria-controls`. Selecting a route closes it. Escape closes it and returns focus to the trigger. The menu is in normal document flow, not a modal or focus trap. It is also available from the mobile assistant.
- The sidebar brand, Back to website link and login return link reach the public page. Login, Google OAuth, trusted role selection and sign-out behavior are retained.

## Visual system

`apps/web/app/design-system.css` defines the shared canvas, borders, type, navigation, controls, responsive layout and public-page composition. Existing global layouts remain in `globals.css`; their previous green/blue decorative palette has been neutralized, with shared tokens and targeted new component styling. Feature CSS modules were updated too, including notifications, approved documents, private previews, RCA and the chatbot. Existing error/warning distinctions and accompanying text remain useful exceptions to the brand palette.

The visual language uses a lightly ruled warm canvas, dark structural outlines, black action buttons, orange display emphasis and chartreuse spotlights. A locally authored SVG provides the landing diagram. Major feature panels use crisp offset shadows; dense operational tables retain softer border hierarchy for readability. Labels and controls have a more readable minimum type size. Chart series use dark/orange contrast while keeping their existing legends, data and meanings.

Geist and Geist Mono are self-hosted through `next/font/local`. The Latin variable font files originate from the installed pinned Next.js package; the Vercel SIL Open Font License is included beside them. No external font service is needed at runtime or build time. Interface text inherits Geist; technical labels/numerals use the mono family. Reduced-motion preferences disable smooth scrolling and animated effects; skip links and visible keyboard focus are included.

## Scope and verification

No database migration, permission expansion, role provisioning, operational record mutation, provider model change or maintenance-state change is part of this redesign. Synthetic process observations remain labeled; engineering approval remains human. New navigation does not bypass protected routes. The public page lists existing features rather than promising unimplemented telemetry or autonomous repair.

`tests/browser/redesign.spec.ts` covers public access without operational API reads, self-hosted fonts, dashboard authentication, signed-in re-entry, mobile menu/active route/Escape behavior, narrow layout and keyboard/reduced-motion behavior. Existing browser suites cover operational forms, role switching, work-order flow, imports, calendars, charts, documents, notifications and the assistant. Current executed evidence and any remaining limits are recorded in [VERIFICATION.md](VERIFICATION.md).

## MCP and shadcn refinement pass

The owner subsequently requested using the UI-design MCP in Downloads. The actual stdio server was used for live screen/component searches and full-image reads. [DESIGN_RESEARCH.md](../DESIGN_RESEARCH.md) records the references, extracted palettes/fonts, selected patterns, transport and image-converter limitations. These references inform layout and interaction; no third-party product artwork was copied into the app.

Added shadcn-style local Command/Dialog primitives using exact-pinned `cmdk` and Radix Dialog, expanding the existing Slot/CVA Button with explicit sizes and reusable Input, Textarea and Skeleton primitives. They use the project's current CSS tokens rather than overwriting the established stylesheet with a global initializer. `refinements.css` calms operational panel treatments, groups controls and improves compact-screen layouts while preserving the expressive landing/overview identity.

**Find a page** in the shared top bar opens a keyboard-accessible, focus-contained dialog with grouped destinations, task aliases, current-page context, empty-search guidance and Escape/close focus return. Ctrl/Command+K opens it outside editable fields or another open dialog; opening and closing it leaves unsaved report fields alone. The list follows the current server-derived role's existing navigation. It does not grant permissions or perform record actions; protected endpoints remain authoritative.

The work-order list now supports **Search loaded work orders** for titles, displayed WO references, full IDs, technician names and work type. Filtering is local to already authorized loaded records. The server's total counts/status filter remain unchanged. A visible scope note explains pagination; loading more includes additional records under the same search, and an empty match has a Clear search action. Search terms are not submitted to the API and no full-database search is claimed. Sign-in and report fields retain their existing validation, disabled state and retry behavior through shared controls. Initial workspace loading has clearly labeled, value-free skeletons with reduced-motion support.


## Current owner preference

The subsequent MaintainX-inspired experiment was reverted at the owner's request on 27 October 2026. The warm palette, conceptual line illustration, existing asset-registry entry and MCP/shadcn refinements described above are the retained frontend.


## Operational form dialogs — 28 October 2026

Operational entry and confirmation forms now open in a shared popup while the existing warm frontend remains in place. Lists and machine records remain the main page content; search/filter and chat/sign-in controls stay in context. Drafts and selected files survive dismissal/reopening on the same page, with pending-save protection, keyboard focus handling and mobile scrolling. [FORM-POPUPS.md](FORM-POPUPS.md) lists the forms, draft lifetime and unchanged authority/data boundaries.


## Multi-machine registration — 28 October 2026

Retained the restored warm interface. Asset registry now has Administrator-only Add machine, server search and paging. Registration and access use the shared native popup; a new machine gets a generic equipment illustration, machine-specific navigation and an explicit workbook-format boundary. Login/landing/shell copy describes machine workspaces rather than claiming every asset is WH-C. See MACHINE-REGISTRY.md.

## Content refinement and product video — 28 October 2026

The owner chose to retain yellow after reviewing an isolated red-accent comparison. Removed repetitive introductions, pilot scaffolding and setup/implementation jargon; source hashes/parser identifiers remain available through expandable details. Synthetic provenance, unknown data, validation and human approval limits stay visible where consequential. Registry editing and private current photos use the same popup/warm-card design. The original landing schematic is now replaced with a compact, original 30-second AI-assisted product motion demo with poster, real playback controls, descriptive captions and a collapsed transcript. It uses generated concept imagery plus illustrative interface scenes, rather than live operational records or a text-to-video model. See UI-CONTENT-CLEANUP.md, MACHINE-EDITING.md and LANDING-VIDEO.md.
