# Operational popup forms

The owner requested popup forms throughout the application on 28 October 2026. The existing warm interface is retained; this changes where people enter operational information, without changing permissions or workflow transitions.

## Where forms open

| Page | Popup forms |
| --- | --- |
| Work orders | Report an issue; assign/reassign; start; submit findings/RCA or completion; approve; return; close |
| Work-order evidence | Add a photo or document with its description |
| Maintenance calendar | Create a recurring plan; pause/resume a plan; release or skip an occurrence |
| Process patterns | Record a statistical review; explicitly assign an investigation |
| Manuals & SOPs | Upload a new draft or revision; approve or withdraw a reference |
| Production and readings | Workbook inspection, validation, acknowledgement and explicit import/source review |
| Email handoffs | Edit the current role's self-only email preference |

Search, filters, report date ranges, sign-in and the chatbot composer remain in their existing page context. The AI RCA editor is inside the technician's submission popup. Reading evidence remains available within a statistical-review popup so the head can consult it while entering a reason.

## Interaction and drafts

The shared `FormPopup` uses the browser's modal dialog with the project's existing typography, borders and colors. Opening makes the underlying page inert and locks page scrolling. The popup has a labeled heading, a scrollable body, visible close controls and explicit keyboard focus wrapping. Escape closes it and restores the initiating control when it still exists. Clicking the backdrop does not dismiss it.

Closed dialog content remains mounted. Text, selected files, frequency/priority choices and existing request keys survive closing and reopening on the same page. Drafts are not added to browser storage. Leaving the page, changing trusted role/record context, completing a successful operation or explicitly reloading a conflicting record can reset a draft as required by the existing workflow. No automatic draft submission occurs.

A pending save/upload disables dismissal and duplicate form controls. Request errors remain inside the open popup; the page recovery message returns after closing. A version conflict still blocks further actions until explicit reload. Closing does not bypass that requirement. Reference conflicts offer the existing library reload inside the popup; other conflict messages direct the user back to page recovery controls.

## Data and authority

Opening/closing does not create operational records, send an email or request an AI answer. Existing explicit submit/confirm buttons perform those actions with the same payloads, idempotency keys, version checks, machine scope and server authorization. Engineering authority still belongs to the trusted operational role; Administrator receives no additional rights.

Production provenance, excluded source rows, preview expiry and acknowledgements remain visible in the import popup. Synthetic readings/reviews remain explicitly synthetic; investigation assignment does not establish a breakdown. File storage limits, human approval, independent completion/restoration/review/closure times and immutable history remain unchanged.

Current executed checks and browser limits are recorded in [VERIFICATION.md](VERIFICATION.md).
