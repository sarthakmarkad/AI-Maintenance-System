# Chatbot regression and live evaluation

Run normal tests before the opt-in provider evaluation. Test identities, PDFs, approvals and conversations must stay in the isolated database whose name ends in `_test`. Runtime Auth is never bypassed; only the Nest test application replaces its verifier. Existing operational conversations can be read to diagnose reported failures but must not be rewritten for tests.

| Area | Checks |
|---|---|
| Conversation | Typo greetings, capability questions, generic SOP definitions, math, Hindi explanation and writing without retrieval |
| Catalog | Current approved metadata, type filtering, complete scoped lists, empty catalog, no model/embedding calls, withdrawal redaction |
| Instructions | Both owner-reported requests, six distinct checklist concepts, retained training warning, exact citations and four-page coverage |
| Context | Document follow-up, general-topic switch, reference selection by title and trusted previous source IDs |
| Ambiguity | Multiple current references and unknown titles prompt clarification rather than guessing |
| Long documents | More than eight indexed passages disclose excerpts rather than promising all instructions |
| Grounding | Server-owned evidence IDs, rejection of mismatched/unknown selections, blank-template summary, exact contiguous quotes, numeric claims versus list numbering, source-ID limits, no invented operating limit, prompt override attempts |
| Failure recovery | Provider timeout/incomplete output, partial invalid quotes, retained verified points, semantic support rejection, labeled verbatim fallback |
| Lifecycle | Approval replacement/withdrawal, revoked access, immutable audit, no duplicate saved turn or paid call on a completed retry |
| UI | Safe Markdown headings, emphasis, nested lists, tables/code, old inline step layout, decimal preservation, HTML/image/unsafe-link exclusion, per-point citations, all role views, desktop/mobile, citation/source drawers, pagination/reload, keyboard focus, immediate composer clearing, preserved next drafts during delayed success/failure, stable original-message retries, retained draft on errors and explicit coverage/fallback labels |

Commands:

```sh
npm test
npm run test:db
npm run test:web -- tests/browser/rag.spec.ts
npm run typecheck
npm run test:ai:evaluate
```

The last command is explicit, potentially billed live acceptance. It uses the configured CommandCode model (currently DeepSeek V4.1 Flash), local Ollama embeddings, Poppler and pgvector with synthetic PDFs only. It does not automatically rerun failed paid cases. It exercises six isolated role identities and twenty bounded scenarios; no per-user quota bypass is added. Each case records success/failure, cited pages, omitted generated points and any degraded verbatim responses. General cases independently check that query embeddings did not run. Checklist cases check all six required concepts, not merely HTTP 200. The two reported requests must return generated ANSWERED summaries; verbatim fallbacks do not satisfy those two acceptance assertions.

The report is private/ignored at `.local/chatbot-evaluation.json`. Provider attempts record phase, elapsed time, finish status and returned token usage without credentials, raw prompts or provider bodies. Timed-out requests may have unreported upstream usage; the report does not imply those calls were unbilled. A degraded reference response is counted separately and visibly labeled in the application. It contains exact source text, never an unchecked generated answer.

Full indexed text is supplied for a selected short reference with at most eight passages. This means all text accepted by the indexer, not independently verified OCR, diagrams or complete understanding of every PDF object. Larger references use bounded retrieval and disclose excerpt coverage. General answers are model knowledge, and no live web/operational-record tools exist. Passing this finite suite does not guarantee correctness for every document, language or adversarial prompt.

Executed results and remaining limits belong in VERIFICATION.md. For a targeted rerun, set `CHATBOT_EVAL_CASES` to exact case names separated by `|`; the report goes to `.local/chatbot-evaluation-subset.json` and retains the full-run report. Fixture setup remains isolated and independent. For example:

```sh
CHATBOT_EVAL_CASES='unsupported-operating-limit-and-injection|contextual-exact-fact' npm run test:ai:evaluate
```

If a live case fails, retain its report, fix the cause, run the relevant deterministic regressions and repeat the bounded evaluation explicitly; do not erase failures by silently relaxing expected content.
