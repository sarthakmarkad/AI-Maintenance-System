# Conversational AI with selective document retrieval — current setup, 26 October 2026

The WH-C **AI assistant** chatbot (`/machines/WH-C/assistant`) now uses **CommandCode DeepSeek V4.1 Flash for conversation, answers and support checks**, **local Nomic embeddings through Ollama**, and private **Supabase PostgreSQL/pgvector** storage. On 26 October the existing local records/vectors were copied and verified without reindexing; new persistence uses the hosted database. Direct OpenAI is no longer required for the configured pilot. The earlier OpenAI-only setup, its HTTP 429 limitation and GLM acceptance are historical; current-model results and limits are recorded in VERIFICATION.md.

General conversation is answered from model knowledge; document-specific answers remain advisory assistance, not engineering approval, automatic fault diagnosis or a work-order writer. Exact WH-C model remains unknown. Limits are bounded pilot choices, not reconstructed authoritative SRS requirements.

## Workflow and roles

1. Administrator or Maintenance head uploads a readable PDF draft in **Manuals & SOPs**. Upload alone does not make it searchable.
2. Only the active Maintenance head reviews/approves a revision. Approval also queues its embedding profile atomically; indexing success is independent of the human approval decision.
3. The worker extracts page-aware text, creates local embeddings and commits complete private vector indexes. Existing current approvals are discovered automatically, including after a profile change. The Knowledge drawer shows queued/processing/ready/failed states and an explicit refresh control.
4. Any of the six authorized active roles starts a private conversation and asks a question or a follow-up. General questions go directly to DeepSeek and do not use query embeddings or passage retrieval. Specific SOP/manual or local-equipment questions use the current-approved RAG pipeline: embed locally, retrieve scoped passages, answer with DeepSeek and check support in a separate model call.
5. General replies carry a **General knowledge** label and no document citations. Document replies carry supported statements, exact quotations, approved reference title/file revision and PDF page citations. Source PDF download remains authenticated through the library. No public links or browser database/provider credentials are created.
6. Head/Admin can retry failed indexing. Only the head can approve/withdraw references. Neither role receives new engineering authority from AI.

| Active role | Ask / current-approved index status | Retry indexing | Library upload | Approve / withdraw |
|---|---|---|---|---|
| Operator, Technician, Supervisor, Management | Yes, within existing trusted scope | No | No | No |
| Administrator | Yes | Yes | Yes | No |
| Maintenance head | Yes | Yes | Yes | Yes |

Operator/Technician still require machine grants. Roles are never combined. New drafts preserve the previous current approval. Replacement approval immediately excludes old vectors, even while the replacement is indexing. Withdrawal never restores older approvals. A source replacement/withdrawal during generation discards the answer with 409; grant revocation also denies delivery. Later changes cannot erase text already rendered, so answers identify themselves as a point-in-time result and advise refreshing after changes. Existing library version checks apply to PDF downloads.

## Configuration and normal startup

Backend-only root `.env` (ignored; mode 0600 locally):

```dotenv
DOCUMENT_AI_PROVIDER=commandcode
COMMANDCODE_API_KEY=<private CommandCode API key>
COMMANDCODE_MODEL=deepseek/deepseek-v4.1-flash
COMMANDCODE_BASE_URL=https://api.commandcode.ai/provider/v1
DOCUMENT_AI_ENABLED=true
```

The production adapter restricts CommandCode calls to that exact HTTPS endpoint and a reviewed model allowlist (`deepseek/deepseek-v4.1-flash`, or explicitly selected legacy `z-ai/glm-5.3-flash`). DeepSeek is the default; it does not accept arbitrary browser endpoints. Explicit `commandcode` selection fails closed without its key and never silently uses an OpenAI key. When no provider is explicitly selected, a configured CommandCode key takes precedence. `DOCUMENT_AI_ENABLED=false` pauses indexing/questions while retaining library operation and saved evidence.

On this Mac, Ollama 0.40.7 and `nomic-embed-text:v1.5` were installed and tested. First setup on another Mac:

```sh
brew install ollama poppler
npm run ai:setup
```

The setup command starts a temporary local daemon if necessary and downloads the approximately 274 MB model if absent. It does not upload company documents. For normal use:

```sh
npm run dev
```

`npm run dev` now starts API, web and the local embedding helper. The helper starts Ollama on `127.0.0.1:11434` when needed, reuses an existing local daemon, and shuts down only a daemon it started. Its child environment contains PATH/HOME/local Ollama settings, **not application database/Auth/provider credentials**. Cloud inference is disabled on the managed daemon. It reports a missing binary/model with a setup instruction. No login-start service was installed.

General API readiness does not assert AI quota or model readiness. A missing/offline/mismatched embedding model yields a safe explicit error for document retrieval, never a cloud embedding fallback. General chat can continue without ready documents or an online local embedding service, provided the configured answer provider is available. Temporary local-service failure uses bounded job retries; permanent model/digest errors require administration. Restart after backend environment changes.

## Local embeddings and retained vector compatibility

- Model: **nomic-embed-text:v1.5**, native **768 dimensions**, model manifest SHA-256 `0a109f422b47e3a30ba2b10eca18548e944e8a23073ee3f3e947efcf3c45e59f`.
- The adapter checks the installed model digest before each embedding operation. A deliberately reviewed `LOCAL_EMBEDDING_DIGEST` override changes the profile; an unexpected model replacement is rejected.
- Nomic's required `search_document:` and `search_query:` prefixes distinguish indexed passages from questions. Inputs are not silently truncated (`truncate:false`). Ollama runs at a fixed loopback endpoint; no CommandCode/OpenAI key is sent to it.
- Existing immutable storage uses `vector(1536)`. Native 768-dimensional vectors are **zero-padded to 1,536** to preserve that storage/evidence without rewriting historical rows. Padding preserves cosine similarity within this profile; it does not create extra semantic dimensions and costs extra storage. Old OpenAI vectors remain retained but are never compared with Nomic vectors.
- A distinct profile binds model digest, native/padded dimensions, task prefixes, extractor and chunker. Existing approved files receive a new index automatically. No database migration or chunk/history rewrite was needed for this provider switch. Changing only the answer model between GLM and DeepSeek leaves the embedding profile unchanged, so it does not trigger reindexing or rewrite saved conversations.

## Retrieval, answer checks and privacy

Poppler `pdfinfo`/`pdftotext` receive bytes on stdin with no application credentials. Page mapping is checked. Maximums: 200 pages, 500,000 extracted characters, 500 passages, 1,200 characters per passage with 180-character overlap. Passages stay within a page. Extraction has a ten-second cap per subprocess. Scans/very short unreadable text return `OCR_REQUIRED`; encrypted PDFs fail. This is not OCR, malware scanning, diagram understanding or reliable table reading. English retrieval is the current model baseline; multilingual engineering acceptance is unverified.

Short selected-reference summaries load all indexed text in page/ordinal order when it fits within eight passages; this avoids silently dropping a fourth section and does not require a query embedding. The eight-passage bound covers indexed text only, not reliable OCR/diagram interpretation. Ambiguous multi-reference summaries ask for a title. Catalog questions read current approved library metadata, with manual/SOP type filters, rather than inferring the library contents from retrieved passages.

For point questions and longer references, exact pgvector cosine and PostgreSQL lexical ranks are combined with reciprocal rank fusion: at most 24 candidates per rank, 48 combined, then six passages/three per document for point questions, or up to eight for an excerpt summary. Cosine at least 0.25 or a lexical match admits a candidate. These are uncalibrated pilot heuristics, not confidence scores. Large-corpus ANN/performance tuning remains future work.

DeepSeek is called through CommandCode `/chat/completions` with a strict JSON schema request and the same schema in the system instructions, no tools, required `x-cmd-zdr: 1`, and no unstructured fallback. Server-side validation still rejects missing/extra fields even if the provider ignores the format hint; malformed output is never repaired into an accepted answer. If privacy routing is unavailable the call fails rather than removing that header. Source/question text is treated as untrusted data. Retrieved passages, the current question and bounded prior conversation context are sent for answering; the support check also receives the proposed answer. Context includes the first turn and latest three turns, deduplicated, with each prior answer capped at 1,000 characters and its GENERAL/DOCUMENTS mode. Changed-source replies contribute only their redaction notice. The conversation/routing call receives this bounded history and the question, without retrieving source passages; history may itself contain prior document-derived text. It either returns a general reply or requests document lookup. Prior replies help resolve references and are never treated as evidence; current-source and citation checks run again for every document question. Text and citations from replies whose approvals have changed are excluded from context. Full PDFs, unrelated passages, local vectors, keys, operational work orders and authentic production data are not part of these requests. The provider/account contract still governs privacy; this implementation does not independently audit upstream retention.

In document mode, every statement needs a known source ID and exact normalized substring quote. The provider now selects source/quote IDs from a server-generated evidence catalog instead of regenerating quotation text. Each catalog entry is an exact contiguous substring of one retrieved immutable chunk (about 500 characters, split at sentence/word boundaries); unknown IDs and source/quote mismatches fail closed. The server expands selected IDs into original text before the same numeric, exact-substring and semantic support checks. This avoids model-generated ellipses or shortened blank form fields without accepting fabricated quotations. Existing stored answers and index profiles remain unchanged; new replies carry policy `approved-documents-v3`. Numeric claims must occur in the cited quotes. Conflicts require multiple cited source IDs. A separate model call checks entailment, question relevance and retained sample/training qualifications. Unsupported output abstains. These checks reduce unsupported answers but **do not guarantee accuracy or defeat every prompt injection**. A source can itself be wrong. Training samples never establish verified operating limits, and synthetic observations never establish authentic faults.

Document answers have a 3,072-token cap, or 6,144 for instruction/summary requests. DeepSeek general conversation/routing and support checks each have a 4,096-token cap because reasoning shares that allowance; the explicit legacy GLM selection retains 2,048/1,536 respectively. Up to twelve concise cited statements allow complete short checklists. The document generation timeout is sixty seconds; other model phases have forty-five-second caps. DeepSeek requests use `reasoning_effort:low` to bound reasoning overhead rather than using its default high effort; the explicit legacy GLM selection receives no DeepSeek-only option. DeepSeek may still consume reasoning tokens within these budgets; incomplete/truncated replies are rejected. These are maximum budgets, not promised consumption. No model switch or hidden paid retry is used to complete a question. The browser chat timeout is three minutes to cover a possible routing call followed by answer/support checks; closing it does not guarantee cancellation of an already-sent provider call.

When summary statements contain malformed quotations (such as ellipses substituted for blank fields), each statement is checked independently. Only statements with valid exact citations/numbers survive, and the retained set must still pass semantic verification. Omitted points are explicitly disclosed; ordinary fact answers and conflicting-source results retain their strict full validation. Numeric list prefixes are presentation and do not bypass checks on operational values in the text.

If a summary cannot be generated/verified or a provider call times out/truncates, available reference passages can be returned verbatim as **REFERENCE_EXCERPTS**. The UI explicitly says this is not a generated summary, retains page citations, and discloses full-indexed-text versus excerpt coverage. No invalid model prose is shown, no additional paid retry is made, and final access/approval/audit checks still run. This is a degraded reading path, not a claim that the requested summary succeeded. Missing evidence cannot become invented equipment guidance. Document generation records policy `approved-documents-v3`; existing conversation evidence remains unchanged, and the embedding profile is unchanged, so no reindex is needed. Safe reason codes in replies/audit distinguish retrieval absence, rejected citations/numbers, semantic rejection and provider failure without logging private content.

Interactive limits: two concurrent questions per API process, one per user, ten attempts/user/ten minutes. These are not distributed quotas/billing controls. Conversations are persisted privately as described below. The separate generation audit retains question hash, selected provider/model/profile/policy, source chunk IDs and result status; raw questions and checked answers are stored only in the scoped chat tables. Provider bodies and credentials are not logged.

## Conversational experience and saved history

The former single-question form is replaced by a full-page **Maintenance assistant**: a private conversation sidebar, starter suggestions, user/assistant messages, follow-up composer, processing indicator, copy control and compact numbered citations. A source drawer opens exact quotes, page/revision metadata and the supporting passage; the Knowledge drawer carries reference readiness and administrative indexing controls. Mobile uses history/source drawers with keyboard focus handling. Replies use readable paragraphs, headings, emphasis, numbered or bulleted lists, bounded code blocks and horizontally scrollable comparison tables. The renderer uses `react-markdown` and `remark-gfm`; raw HTML and remote images are excluded, and only HTTP/HTTPS links are clickable. Trusted citation controls stay attached to their checked points. A shared conservative formatter separates a complete consecutive inline numbered sequence in new general replies and the display/copy of older replies, preserving words, decimal values and existing Markdown/code layout. Existing saved turns are not rewritten. Simple greetings stay concise; new process overviews are prompted to use a short introduction and a numbered list. Enter sends; Shift+Enter adds a line. Sending clears the composer immediately and displays the question as a pending message. The user can type the next draft while waiting; success/failure cannot overwrite that new draft. A failed message remains separately retryable with its original request ID; its text is restored only when the user has not edited the composer. A synchronous send guard blocks duplicate submissions. Suggestions prefill a question and never trigger a paid request by themselves.

Conversations belong to one **organization, machine, actual user and active trusted role**. Other staff, including administrators, cannot browse another user's chats through these endpoints. The same pilot identity switching roles gets separate history. A saved URL restores a conversation after reload. Clicking New chat creates no database record until the first successful message. Recent lists and earlier messages are paginated, and one conversation is capped at 60 replies. Titles use the first question. Owner-only removal from saved history is implemented through a separate immutable archival receipt; original turns remain retained. Rename, permanent deletion and automatic expiry are not implemented. See RECORD-REMOVAL.md. Raw questions, checked answers and cited passages are retained in the private operational database, so document content entered into a chat is covered by that database's access and backup policies. There is no browser-persistent transcript cache or analytics export.

General conversation now uses DeepSeek, including informal/typo greetings such as “hiii”, capability questions, general definitions, writing and conceptual follow-ups. It does not perform embedding/vector/text retrieval or claim document citations. The UI permits it when the approved corpus is empty, queued or failed. Direct catalog/explicit summary requests bypass classification where their intent is clear. A strict model response otherwise chooses GENERAL with a bounded reply or DOCUMENTS. Any draft text returned alongside DOCUMENTS is discarded before the approved retrieval path runs; it is never delivered as an ungrounded answer. Malformed mode/shape or an empty GENERAL reply fails explicitly. Explicit local-reference/equipment requests also have a server routing guard. Document follow-ups stay grounded, while a new general topic can switch back. Routing uses current topic/mode, rather than treating every follow-up as a document question. Machine-specific limits/procedures cannot be supplied as unverified general knowledge. General answers are not citation/support-verified, may be wrong and have no live web or operational-data tools.

A normal general exchange uses one provider call. Explicit reference requests bypass classification and use the existing RAG answer/support calls; less explicit document requests can add one routing call before retrieval. Retrieval failure or insufficient approved evidence never silently falls back to general knowledge for that document question. A completed saved retry avoids all further provider calls; an overlapping unfinished same-user request may return 429 and can be retried explicitly. There is no open-web search, general engineering diagnosis, work-order action or unchecked token streaming. Document replies appear after citation/support checks finish; general replies appear after the validated conversational response completes. The conversation UI follows familiar thread/history/source interactions illustrated by [Intercom Fin](https://www.intercom.com/help/en/articles/11433030-conversational-fin-experience) and [Perplexity](https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search), using this project's own styling.

On every saved-chat read, replaced/withdrawn approvals redact the affected reply and its citations with SOURCE_CHANGED. A newer unapproved draft alone does not invalidate the current approved answer. The stored evidence remains immutable. Text already rendered or copied cannot be recalled; reopening/refreshing checks it again. Existing role revocation checks apply before returning history or saving a reply.

Messages have browser-generated request UUIDs with server fingerprints. Exact retries return the original receipt without another model call once saved; changed payloads conflict. Final append, conversation version and protected audit commit atomically under owner/document locks, with a fresh approval/access check. Competing updates reject stale versions. Errors retain the unsent question and require explicit retry. There is no automatic paid retry. Concurrent requests across API instances can still make redundant model calls before one wins the final version check; durable pre-generation reservations/distributed billing limits remain future work. New messages also have a per-process 60/minute/user limit, in addition to the existing model-call limits.

## Persistence and operations

Migration 017's existing private index/chunk tables and narrow grants remain. Migrations 018/019 add scoped DocumentChat/DocumentChatTurn tables, immutable turn/history constraints, version/count checks and deferred protected chat audit. Runtime can insert chats/turns and update only conversation version/updatedAt; ownership, title, prior messages and answers cannot be edited/deleted. One `(fileId,profile)` job is queued using conflict-safe insertion. The worker discovers up to 20 missing current approvals and claims one job per 30-second tick with `FOR UPDATE SKIP LOCKED`. A ten-minute lease supports restart recovery; exhausted attempts stop explicitly after three. Local embeddings use batches of 16, a four-minute overall budget and 30-second request caps. Network/transient failures have bounded backoff, with explicit head/admin retry after final failure.

Source hash/current approval are rechecked before processing and final publication under the library lifecycle lock. All chunks, READY metadata and protected audit commit together. A changed lease cannot publish over its replacement. Constraints retain scoped relations, source identity/hash, immutable chunks and complete READY counts. Runtime cannot delete chunks or edit READY/source evidence. Access and approvals are rechecked after answer generation and after waiting for the final lifecycle lock; generation audit must commit before delivery.

The local worker/API and Ollama must remain running; database hosting does not deploy them. Operational records, PDF/photo bytes, chats and vectors now reside in the private Supabase `maintenance` schema. Owners can inspect `DocumentRagIndex` and `DocumentRagChunk.embedding` in the dashboard's Table Editor/SQL Editor; browser clients still use authenticated NestJS endpoints. The old local vector viewer is stopped and its pre-cutover snapshot is obsolete. See [SUPABASE-MIGRATION.md](SUPABASE-MIGRATION.md) for access, transfer evidence, rollback and administration. Ongoing hosted backup/restore acceptance, distributed worker deployment, organization quotas and scanning remain separate work.

## API and reproducible checks

All routes require verified bearer Auth and trusted selected-role enforcement:

- `GET /api/machines/:code/assistant/status`: selected provider/embedding model, configuration flag, approved/ready counts, current approved indexing states and role capabilities. No credentials/text.
- `GET .../chats?before=<chat UUID>`: the caller's active-role conversations, 20 per page.
- `GET .../chats/:id?before=<ordinal>`: 20 saved turns with current approval checks; foreign ownership is 404.
- `POST .../chat`: strict `{question,requestId,chatId?}`, 1–1,000 trimmed characters; server-owned follow-up context, selective GENERAL_ANSWER/document response and duplicate-safe saved receipt. Browser-authored history is rejected.
- `POST .../ask`: retained compatibility endpoint, strict `{question}`, 3–1,000 trimmed characters. Answer/insufficient/conflict/no-approved/indexing-required states carry coverage and server-derived cited source metadata.
- `POST .../indexes/:id/retry`: strict `{}`; head/admin, current file/profile only, duplicate-safe state/audit.

401 follows reauthentication; revoked scope returns 403/404; source changes return 409 and discard the answer; interactive limits return 429; safe provider/local-service failures return 503. No runtime identity bypass is added.

Normal automated suites use provider doubles only in tests. The explicit, potentially billed live check is:

```sh
npm run test:ai:live
```

`tests/live/document-ai.mjs` enforces matching `_test` database URLs, creates synthetic test identities/documents only there, and exercises the reported greeting/capability prompts without approved documents, general-topic transitions without embeddings, and real upload → approval → Poppler → local embeddings → pgvector retrieval → configured-model answer/support → saved multi-turn chat → idempotent retry → private history → insufficient evidence → withdrawal/redacted history. Only test Auth verification is replaced; real stored role/scope checks and real providers are used. Unexpected provider URLs, including OpenAI, are rejected by the test. It never runs as part of normal tests/CI and never writes operational test documents. Results/usage are written privately under `.local/`.

The broader opt-in `npm run test:ai:evaluate` suite is described in [CHATBOT-TESTING.md](CHATBOT-TESTING.md). It checks checklist content, citations, ambiguity and degraded outcomes rather than only HTTP status. Full current evidence is in VERIFICATION.md. Live model results are sample acceptance, not a comprehensive engineering accuracy benchmark. Provider/data terms, model updates and production dependencies still require continuing review.

Sources: [CommandCode API](https://commandcode.ai/docs/provider), [DeepSeek V4.1 Flash model](https://commandcode.ai/models/deepseek-v4-1-flash), [DeepSeek thinking/effort parameters](https://api-docs.deepseek.com/guides/thinking_mode/), [Ollama embedding API](https://docs.ollama.com/api/embed), [Nomic model/prefix instructions](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5), [pgvector](https://github.com/pgvector/pgvector).


## Multi-machine scope — 28 October 2026

The generic maintenance workspace now supports Administrator-registered organization machines under the existing trusted role/machine grants. WH-C remains the validated workbook/process-data pilot; WH-B stays reference-only. Work-order handoffs, email links and newly captured AI RCA machine identity use the selected machine; approved documents and RAG retrieval retain machine-ID isolation. Existing immutable records/payloads are retained unchanged. See [MACHINE-REGISTRY.md](MACHINE-REGISTRY.md).
