# Private work-order photos and documents — milestone 8

## Purpose and workflow

Work-order detail now has **Photos & documents**. Files support human reports and findings; uploading a file does not confirm a fault, diagnose a cause, submit findings or approve work. The same feature applies to breakdown, planned and investigation orders.

| Active role / stage | Attachment activity |
|---|---|
| Reporting Operator, REPORTED | Save the report first, then upload observation photos or reports before assignment |
| Assigned Technician, IN_PROGRESS | Start work, add inspection/work evidence, then submit findings through the existing workflow |
| Maintenance head | Read/download evidence before assignment or engineering review; return submitted work with a reason if more evidence is needed |
| Supervisor | Read/download evidence before closing approved work |
| Management / Administrator | Read/download within existing machine and organization scope; no upload or engineering authority |

Only the reporting operator or currently assigned technician can upload in the corresponding stage. Other operators/technicians may read with machine access but cannot add evidence to somebody else's report/assignment. ASSIGNED work must be started before technician upload. AWAITING_REVIEW, APPROVED and CLOSED stages accept no new files. Returning to IN_PROGRESS lets the assigned technician add evidence and resubmit. All previous files stay readable after return, reassignment and closure.

These are bounded pilot choices, not reconstructed authoritative SRS requirements. The single pilot account must select its explicitly granted Operator or Technician view for the respective action; Administrator permissions do not combine with those views. Separate real-person acceptance remains pending.

## Supported files and UI

- JPEG (`.jpg` / `.jpeg`), PNG (`.png`) and PDF (`.pdf`) only.
- One file per upload; non-empty and at most **5 MiB** (the UI says 5 MB).
- At most **20 files per work order**, across all stages/uploaders.
- A required, trimmed 3–1,000-character description explains the evidence.
- Filename limited to 160 characters; path, header/control and bidirectional formatting characters are rejected. Extension, supplied MIME and file-type envelope must agree. Generic/absent MIME is allowed only when bytes and extension identify an allowed type.
- List shows filename, description, type/size, uploader name and acting role, IST upload time and work-order version. Upload receipt time is not the time the photo was taken or the inspection was performed.
- File/description/retry key survive a failed request on the current form. Success reloads the latest work order/history. Stale updates require explicit reload; no automatic retry against a new version.
- JPEG/PNG photos have **View** beside **Download**. View opens an accessible in-app photo dialog with loading, retry and decode-error states; Escape or Close returns to the photo button. The browser fetches through the existing authenticated endpoint, renders only raster photo bytes in an image element and releases its temporary object URL on close/retry/unmount. Closing a pending preview aborts it. Opening a preview does not save a file to disk or change work-order evidence/version.
- PDFs retain their download action. All files still use authenticated `application/octet-stream` download responses with `Content-Disposition: attachment`, `nosniff`, no-store and a sandbox CSP. No inline PDF/HTML frame, public file URL, token in a URL or new preview endpoint is introduced. View checks the same live scope as Download; expiry follows the shared sign-in flow.
- No replacement/deletion endpoint. The original file and upload metadata are immutable; correcting evidence requires another clearly described upload. A future controlled redaction/retention process needs its own design.

File signature/envelope checks are not full format validation, antivirus scanning, content disarm or proof of authenticity. No OCR, EXIF-derived observation time, AI analysis, engineering judgment or synthetic/authentic classification is inferred from attachments. Deployment beyond this trusted pilot requires agreed scanning, retention, quotas and backup/storage operations.

## Persistence, permissions and atomicity

Attachment bytes are stored privately as PostgreSQL `bytea` in `maintenance.WorkOrderAttachment`, alongside immutable metadata. This deliberately uses the existing private operational database for the bounded local pilot instead of introducing cloud credentials, a public bucket, local filesystem uploads or an incomplete two-system commit. No Supabase Storage bucket, service-role key, frontend secret, new account or browser database grant is introduced. Original production/readings workbooks are still not retained by the app; their import behavior is unchanged.

The API's existing verified Supabase identity and transactional trusted membership/role/machine checks protect uploads, detail metadata and photo previews/downloads. Operators/technicians require explicit machine access. Attachment IDs are additionally scoped to both the parent work order and machine/organization; another same-code organization cannot read them. Permissions are rechecked for every download; revocation therefore does not depend on expiry of a public/signed object URL. Database-owner and runtime service credentials remain trusted infrastructure; ordinary users have no direct table access.

One transaction:

1. Rechecks trusted access, serializes attachment retries for this scoped order and finds the parent.
2. Returns an exact existing receipt for the same uploader/request UUID and normalized content/acting-role fingerprint. Changed reuse conflicts. A successful retry may return its original evidence after the work advances or is reassigned, provided the actor still has current scoped access and the same active role; it adds nothing.
3. For a new upload, checks current role/ownership/stage, expected version and count limit.
4. Compares-and-updates the order version and update time, retaining its stage and every operational field.
5. Appends an `ATTACH` event, immutable bytes/metadata and `WORK_ORDER_ATTACH` audit event. Any failure rolls everything back.

A concurrent assignment, submission or upload can win only one expected version. The other request must reload, so a head/technician cannot unknowingly advance a version that omits new evidence. Existing work-order actions remain unchanged.

Metadata retains SHA-256, byte count, uploader/name/role snapshot, upload instant, stage and event version. SQL enforces byte count/hash, media/type bounds, organization-scoped parent/uploader relations, event linkage and immutable update/delete protection. A same-stage work-order version bump changes only version/update time and requires a matching attachment by commit. An insert trigger locks/checks the parent and enforces the 20-file limit and matching actor/stage/version/event. Runtime grants add attachment INSERT only, with existing private SELECT; no UPDATE/DELETE is granted.

Metadata responses explicitly select no byte content. Detail lists are bounded by the enforced 20-file limit. Upload multipart limits are one file/three fields/four parts, with bounded text fields. An API-process gate allows at most four concurrent attachment uploads total and two per authenticated identity (429 with retry guidance); it is not a distributed quota. The browser disables workflow mutations during an upload and releases busy state on unmount.

A work order can retain at most 100 MiB of attachment payload in this first delivery. PostgreSQL bytes increase database and backup size. Larger/deployed installations should move behind a reviewed private object-storage design with quarantine/scanning, orphan/retry reconciliation, retention and verified restore procedures. Neither this delivery nor existing Auth setup constitutes hosted operational deployment or disaster-recovery acceptance.

## REST contract

All endpoints require verified Auth; see OpenAPI 0.8.0 and generated response types.

- `GET /api/machines/:code/work-orders/:id`: existing detail plus `attachments`, `canUploadAttachment`, `attachmentLimit`, `attachmentMaxBytes`.
- `POST /api/machines/:code/work-orders/:orderId/attachments`: multipart `file`, UUID `requestId`, integer `version`, `description`. Returns `{attachment, alreadyUploaded}`. Unknown fields are rejected.
- `GET /api/machines/:code/work-orders/:orderId/attachments/:id/download`: scoped authenticated bytes, always a download.

400 means invalid fields/type, 401 expired/missing authentication, 403 wrong role/ownership/stage or revoked workspace, 404 inaccessible record/machine/file, 409 stale version/changed retry/count limit, 413 too large, 429 concurrent-upload gate, 503 unavailable dependency. An upload failure does not erase the form. Download expiry follows the existing sign-in flow.

Migration: `202610230013_work_order_attachments`. Apply migration and narrow grants, then regenerate Prisma/client contracts. See VERIFICATION.md for executed tests and limits. Test uploads and incidents belong only in the isolated `_test` database and browser fixtures.
