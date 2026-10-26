"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  Copy,
  Check,
  History,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  X,
  Wrench,
  FileText,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { components } from "@maintenance/api-client";
import { api, apiBlob, ApiError, type Machine, type Me } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { ChatReply, formatInlineSteps } from "./chat-reply";
import { errorNames } from "./document-chat-errors";
import styles from "./document-assistant.module.css";
type Status = components["schemas"]["DocumentAiStatusDto"];
type Turn = components["schemas"]["DocumentChatTurnDto"];
type Chats = components["schemas"]["DocumentChatListDto"];
type Detail = components["schemas"]["DocumentChatDetailDto"];
type Receipt = components["schemas"]["DocumentChatReceiptDto"];
type Panel =
  | { kind: "knowledge" }
  | { kind: "sources"; turnId: string; sourceId?: string };
const starters = [
  {
    icon: Wrench,
    title: "Explain a procedure",
    text: "Walk me through the inspection procedure in the approved SOP.",
  },
  {
    icon: Sparkles,
    title: "Explain a concept",
    text: "What is preventive maintenance? Explain it simply.",
  },
  {
    icon: BookOpen,
    title: "Understand a manual",
    text: "Summarize the key points in the approved machine manual.",
  },
];
export function DocumentAssistant({
  machine,
  user,
  token,
}: {
  machine: Machine;
  user: Me;
  token: string;
}) {
  const base = `/machines/${encodeURIComponent(machine.code)}/assistant`,
    router = useRouter(),
    params = useSearchParams(),
    chatId = params.get("chat"),
    { expire } = useAuth();
  const [overlay, setOverlay] = useState(false);
  const panelNode = useRef<HTMLElement>(null),
    historyNode = useRef<HTMLElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<Status | null>(null),
    [chats, setChats] = useState<Chats>({ items: [], nextCursor: null }),
    [turns, setTurns] = useState<Turn[]>([]),
    [before, setBefore] = useState<number | null>(null),
    [total, setTotal] = useState(0);
  const [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [chatLoading, setChatLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState<string | null>(null),
    [failed, setFailed] = useState(false),
    [panel, setPanel] = useState<Panel | null>(null),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyHidden, setHistoryHidden] = useState(false),
    [attempt, setAttempt] = useState(0),
    [copied, setCopied] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null),
    input = useRef<HTMLTextAreaElement>(null),
    messages = useRef<HTMLDivElement>(null),
    panelTitle = useRef<HTMLHeadingElement>(null),
    loaded = useRef<{ id: string; token: string } | null>(null),
    request = useRef<{ payload: string; id: string } | null>(null),
    sending = useRef(false),
    draftRevision = useRef(0),
    copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowed = !!status?.configured;
  async function failure(e: unknown) {
    if (e instanceof ApiError && e.status === 401) {
      setTurns([]);
      setChats({ items: [], nextCursor: null });
      setPanel(null);
      await expire();
      router.replace("/login?reason=expired");
      return;
    }
    if (e instanceof ApiError && [403, 404].includes(e.status)) {
      setTurns([]);
      setChats({ items: [], nextCursor: null });
      setStatus(null);
      setPanel(null);
      loaded.current = null;
    }
    if (e instanceof ApiError && e.status === 409) {
      loaded.current = null;
      setPanel(null);
      setTurns([]);
      setAttempt((x) => x + 1);
    }
    setError(
      e instanceof Error
        ? e.message
        : "The assistant couldn’t complete that request. Please try again.",
    );
  }
  useEffect(
    () => () => {
      operation.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    Promise.all([
      api<Status>(base + "/status", token, c.signal),
      api<Chats>(base + "/chats", token, c.signal),
    ])
      .then(([s, list]) => {
        if (!c.signal.aborted) {
          setStatus(s);
          setChats(list);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setLoading(false);
          void failure(e);
        }
      });
    return () => c.abort();
    // Requests never resubmit a message automatically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, token, attempt, user.role, user.userId]);
  useEffect(() => {
    if (!chatId) {
      setChatLoading(false);
      setTurns([]);

      setTotal(0);
      setBefore(null);
      loaded.current = null;
      return;
    }
    if (loaded.current?.id === chatId && loaded.current.token === token) return;
    const c = new AbortController();
    setChatLoading(true);
    setTurns([]);
    setPanel(null);
    api<Detail>(base + `/chats/${encodeURIComponent(chatId)}`, token, c.signal)
      .then((d) => {
        if (!c.signal.aborted) {
          loaded.current = { id: d.id, token };
          setTurns(d.turns);

          setTotal(d.total);
          setBefore(d.before);
          setChatLoading(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setChatLoading(false);
          void failure(e);
        }
      });
    return () => c.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, base, token, attempt]);
  useEffect(() => {
    if (messages.current)
      messages.current.scrollTo({
        top: messages.current.scrollHeight,
        behavior: "smooth",
      });
  }, [pending, turns.at(-1)?.id]);
  useEffect(() => {
    const media = window.matchMedia("(max-width:1250px)");
    const update = () => {
      setOverlay(media.matches);
      if (window.innerWidth > 760) setHistoryOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (panel) panelTitle.current?.focus();
    else if (historyOpen)
      historyNode.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (returnFocus.current?.isConnected) {
      returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [panel, historyOpen]);
  function modalKeys(
    e: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  ) {
    if (e.key === "Escape") {
      if (panel) {
        e.preventDefault();
        setPanel(null);
      } else if (historyOpen) {
        e.preventDefault();
        setHistoryOpen(false);
      }
      return;
    }
    const node =
      panel && overlay
        ? panelNode.current
        : historyOpen
          ? historyNode.current
          : null;
    if (e.key !== "Tab" || !node) return;
    const focusable = Array.from(
      node.querySelectorAll<HTMLElement>(
        "button:not([disabled]),a[href],summary,textarea:not([disabled])",
      ),
    ).filter((e) => e.offsetParent !== null);
    const first = focusable[0],
      last = focusable.at(-1);
    if (!first) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    if (!panel && !historyOpen) return;
    const handler = (e: KeyboardEvent) => modalKeys(e);
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [panel, historyOpen, overlay]);
  async function refreshChats(signal: AbortSignal) {
    try {
      const list = await api<Chats>(base + "/chats", token, signal);
      if (!signal.aborted) setChats(list);
    } catch (e) {
      if (!signal.aborted) await failure(e);
    }
  }
  function newChat() {
    if (busy) return;
    loaded.current = null;
    request.current = null;
    setTurns([]);
    setDraft("");
    setPending(null);
    setFailed(false);
    setError("");
    setPanel(null);
    setTotal(0);
    setBefore(null);

    setHistoryOpen(false);
    window.history.replaceState(null, "", base);
    input.current?.focus();
  }
  function openChat(id: string) {
    if (busy) return;
    setHistoryOpen(false);
    setDraft("");
    setPending(null);
    setFailed(false);
    setError("");
    request.current = null;
    window.history.replaceState(null, "", base + `?chat=${id}`);
  }
  async function send(e?: FormEvent, retry = false) {
    e?.preventDefault();
    const question = retry ? pending : draft.trim();
    if (
      sending.current ||
      busy ||
      loading ||
      !question ||
      !allowed ||
      chatLoading ||
      total >= 60
    )
      return;
    const payload =
      retry && request.current
        ? request.current.payload
        : JSON.stringify({ question, ...(chatId ? { chatId } : {}) });
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    sending.current = true;
    const revision = draftRevision.current;
    // A retry owns the failed message, independently of the next draft.
    if (!retry || draft.trim() === question) setDraft("");
    const c = new AbortController();
    operation.current = c;
    setBusy(true);
    setError("");
    setNotice("");
    setFailed(false);
    setPending(question);
    try {
      const result = await api<Receipt>(
        base + "/chat",
        token,
        c.signal,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...JSON.parse(payload),
            requestId: request.current.id,
          }),
        },
        180000,
      );
      if (c.signal.aborted) return;
      loaded.current = { id: result.chatId, token };
      setTurns((t) => [
        ...t.filter((t) => t.id !== result.turn.id),
        result.turn,
      ]);
      setTotal(result.turn.ordinal);

      setPending(null);
      request.current = null;
      if (!chatId)
        window.history.replaceState(null, "", base + `?chat=${result.chatId}`);
      await refreshChats(c.signal);
      input.current?.focus();
    } catch (e) {
      if (!c.signal.aborted) {
        setFailed(true);
        // Recover the sent text only when the user has not begun another draft.
        if (draftRevision.current === revision)
          setDraft((current) => current || question);
        await failure(e);
      }
    } finally {
      sending.current = false;
      if (!c.signal.aborted) setBusy(false);
    }
  }
  async function loadEarlier() {
    if (!chatId || !before || busy) return;
    const c = new AbortController();
    operation.current = c;
    setBusy(true);
    try {
      const d = await api<Detail>(
        base + `/chats/${chatId}?before=${before}`,
        token,
        c.signal,
      );
      if (!c.signal.aborted) {
        setTurns((old) => [
          ...d.turns,
          ...old.filter((t) => !d.turns.some((n) => n.id === t.id)),
        ]);
        setBefore(d.before);
      }
    } catch (e) {
      if (!c.signal.aborted) await failure(e);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  async function moreChats() {
    if (!chats.nextCursor || busy) return;
    const c = new AbortController();
    operation.current = c;
    setBusy(true);
    try {
      const more = await api<Chats>(
        base + `/chats?before=${chats.nextCursor}`,
        token,
        c.signal,
      );
      if (!c.signal.aborted)
        setChats((old) => ({
          items: [
            ...old.items,
            ...more.items.filter((x) => !old.items.some((o) => o.id === x.id)),
          ],
          nextCursor: more.nextCursor,
        }));
    } catch (e) {
      if (!c.signal.aborted) await failure(e);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  async function retryIndex(id: string) {
    if (busy) return;
    const c = new AbortController();
    operation.current = c;
    setBusy(true);
    setError("");
    try {
      await api(base + `/indexes/${id}/retry`, token, c.signal, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!c.signal.aborted) {
        setNotice("The reference is queued. Refresh sources shortly.");
        setAttempt((x) => x + 1);
      }
    } catch (e) {
      if (!c.signal.aborted) await failure(e);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  async function download(s: Turn["answer"]["sources"][number]) {
    if (busy) return;
    const c = new AbortController();
    operation.current = c;
    setBusy(true);
    setError("");
    try {
      const blob = await apiBlob(
        `/machines/${machine.code}/documents/${s.documentId}/versions/${s.fileId}/download?version=${s.documentVersion}`,
        token,
        c.signal,
      );
      if (c.signal.aborted) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = s.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!c.signal.aborted) await failure(e);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  async function copy(turn: Turn) {
    try {
      await navigator.clipboard.writeText(
        turn.answer.statements.length
          ? turn.answer.statements
              .map((s) => `- ${formatInlineSteps(s.text)}`)
              .join("\n\n")
          : formatInlineSteps(turn.answer.message),
      );
      setCopied(turn.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      setNotice(
        "Copy is unavailable in this browser. You can select the reply text instead.",
      );
    }
  }
  const sourceTurn =
    panel?.kind === "sources" ? turns.find((t) => t.id === panel.turnId) : null;
  return (
    <section
      className={`${styles.chat} ${historyHidden ? styles.historyHidden : ""}`}
      aria-label="Maintenance chatbot"
      onClickCapture={(e) => {
        if (!panel && !historyOpen) {
          const button = (e.target as Element).closest<HTMLButtonElement>(
            "button",
          );
          if (button) returnFocus.current = button;
        }
      }}
    >
      {historyOpen && (
        <button
          className={styles.scrim}
          aria-label="Close conversation history"
          onClick={() => setHistoryOpen(false)}
        />
      )}
      <aside
        className={`${styles.history} ${historyOpen ? styles.historyVisible : ""}`}
        aria-label="Conversation history"
        role={historyOpen ? "dialog" : undefined}
        aria-modal={historyOpen || undefined}
        ref={historyNode}
        inert={!!panel && overlay}
      >
        <div className={styles.historyHead}>
          <span>
            <MessageSquare size={16} /> Your conversations
          </span>
          <button
            aria-label="Close conversation history"
            className={styles.mobileOnly}
            onClick={() => setHistoryOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button className={styles.newChat} onClick={newChat} disabled={busy}>
          <Plus size={17} />
          New chat
        </button>
        <span className={styles.sectionLabel}>RECENT</span>
        <div className={styles.chatList}>
          {chats.items.map((c) => (
            <button
              key={c.id}
              title={c.title}
              aria-current={c.id === chatId ? "page" : undefined}
              disabled={busy}
              onClick={() => openChat(c.id)}
            >
              <MessageSquare size={14} />
              <span>{c.title}</span>
            </button>
          ))}
          {!chats.items.length && !loading && (
            <p>Your conversations will appear here.</p>
          )}
          {chats.nextCursor && (
            <button onClick={() => void moreChats()} disabled={busy}>
              Load more conversations
            </button>
          )}
        </div>
        <div className={styles.historyFoot}>
          <span className={styles.privateDot} />
          <span>Private to you and your active role</span>
        </div>
      </aside>
      <div className={styles.main} inert={historyOpen || (!!panel && overlay)}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button
              className={styles.mobileOnly}
              aria-label="Show conversation history"
              onClick={() => setHistoryOpen(true)}
            >
              <History size={19} />
            </button>
            <button
              className={styles.desktopOnly}
              aria-label={
                historyHidden
                  ? "Show conversation history"
                  : "Hide conversation history"
              }
              onClick={() => setHistoryHidden((x) => !x)}
            >
              {historyHidden ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </button>
            <span className={styles.avatar}>
              <Sparkles size={19} />
            </span>
            <div>
              <h1>Maintenance assistant</h1>
              <p>
                {machine.code} <span>·</span> Manuals &amp; SOPs
              </p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              title="New chat"
              aria-label="New chat"
              disabled={busy}
              onClick={newChat}
            >
              <Plus size={18} />
            </button>
            <button
              aria-label="Knowledge sources"
              className={`${styles.knowledgeButton} ${panel?.kind === "knowledge" ? styles.selected : ""}`}
              onClick={() =>
                setPanel((p) =>
                  p?.kind === "knowledge" ? null : { kind: "knowledge" },
                )
              }
            >
              <BookOpen size={16} />
              <span>Knowledge</span>
              <span className={styles.knowledgeCount}>
                {status?.ready ?? 0}
              </span>
            </button>
          </div>
        </header>
        <div className={styles.messages} ref={messages}>
          {loading && (
            <p role="status" className={styles.loading}>
              Connecting to your approved references…
            </p>
          )}
          {chatLoading ? (
            <p role="status" className={styles.loading}>
              Opening conversation…
            </p>
          ) : !turns.length && !pending ? (
            <div className={styles.welcome}>
              <div className={styles.welcomeMark}>
                <Sparkles size={29} strokeWidth={1.4} />
              </div>
              <span className={styles.eyebrow}>
                YOUR KNOWLEDGE, WITHIN REACH
              </span>
              <h2>
                How can I help
                <br />
                with {machine.code} today?
              </h2>
              <p>
                Ask anything, explore an idea, or get help with a procedure.
                <br className={styles.desktopOnly} /> I’ll check your manuals
                and SOPs when needed.
              </p>
              <div className={styles.starters}>
                {starters.map((s) => (
                  <button
                    key={s.title}
                    onClick={() => {
                      setDraft(s.text);
                      input.current?.focus();
                    }}
                    disabled={!allowed || busy}
                  >
                    <s.icon size={20} strokeWidth={1.5} />
                    <strong>{s.title}</strong>
                    <span>{s.text}</span>
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
              <span className={styles.grounded}>
                <span className={styles.privateDot} />
                {status?.ready
                  ? `${status.ready} approved ${status.ready === 1 ? "reference" : "references"} ready`
                  : "Your approved knowledge, all in one place"}
              </span>
            </div>
          ) : (
            <div
              className={styles.transcript}
              aria-label="Conversation messages"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {before && (
                <button
                  className={styles.earlier}
                  onClick={() => void loadEarlier()}
                  disabled={busy}
                >
                  <ChevronDown size={14} />
                  Load earlier messages
                </button>
              )}
              {turns.map((t) => (
                <div key={t.id} className={styles.turn}>
                  <div className={styles.userRow}>
                    <div className={styles.userBubble}>{t.question}</div>
                  </div>
                  <article
                    className={styles.assistantRow}
                    aria-label={`Assistant reply ${t.ordinal}`}
                  >
                    <span className={styles.smallAvatar}>
                      <Sparkles size={16} />
                    </span>
                    <div className={styles.reply}>
                      <div className={styles.replyName}>
                        Maintenance assistant <span>·</span>{" "}
                        <small>
                          {new Intl.DateTimeFormat("en-IN", {
                            timeZone: "Asia/Kolkata",
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(t.at))}{" "}
                          IST
                        </small>
                      </div>
                      {t.answer.status === "GENERAL_ANSWER" && (
                        <small className={styles.responseMode}>
                          General knowledge
                        </small>
                      )}
                      {t.answer.status === "REFERENCE_EXCERPTS" && (
                        <p className={styles.notice}>{t.answer.message}</p>
                      )}
                      {t.answer.status === "SOURCE_CHANGED" && (
                        <span className={styles.sourceChanged}>
                          Reference updated
                        </span>
                      )}
                      {t.answer.status === "CONFLICTING_SOURCES" && (
                        <strong className={styles.conflict}>
                          These references disagree. Check with your Maintenance
                          head.
                        </strong>
                      )}
                      {t.answer.statements.length ? (
                        <ul className={styles.answerPoints}>
                          {t.answer.statements.map((s, i) => (
                            <li key={i}>
                              <ChatReply
                                text={s.text}
                                citations={s.citations.map((c, j) => (
                                  <button
                                    key={j}
                                    className={styles.citation}
                                    aria-label={`Source ${c.sourceId.slice(1)} for reply ${t.ordinal}`}
                                    onClick={() =>
                                      setPanel({
                                        kind: "sources",
                                        turnId: t.id,
                                        sourceId: c.sourceId,
                                      })
                                    }
                                  >
                                    {c.sourceId.slice(1)}
                                  </button>
                                ))}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ChatReply text={t.answer.message} />
                      )}
                      {!!t.answer.coverage.omittedStatements && (
                        <small className={styles.partial}>
                          Some draft statements failed source checks and were
                          omitted. View the reference for the complete
                          instructions.
                        </small>
                      )}
                      {t.answer.coverage.scope &&
                        ["ANSWERED", "REFERENCE_EXCERPTS"].includes(
                          t.answer.status,
                        ) && (
                          <small className={styles.partial}>
                            {t.answer.coverage.scope ===
                            "FULL_INDEXED_REFERENCE"
                              ? "Source coverage: all indexed text of this reference."
                              : "This summary covers retrieved excerpts, not every instruction in the document."}
                            {t.answer.coverage.pages?.length
                              ? ` Pages: ${t.answer.coverage.pages.join(", ")}.`
                              : ""}
                          </small>
                        )}
                      {t.answer.coverage.ready < t.answer.coverage.approved &&
                        t.answer.status === "ANSWERED" && (
                          <small className={styles.partial}>
                            Some approved references are still getting ready.
                          </small>
                        )}
                      <div className={styles.replyActions}>
                        {t.answer.sources.length > 0 && (
                          <button
                            onClick={() =>
                              setPanel({ kind: "sources", turnId: t.id })
                            }
                          >
                            <BookOpen size={14} />
                            View {t.answer.sources.length}{" "}
                            {t.answer.sources.length === 1
                              ? "source"
                              : "sources"}
                          </button>
                        )}
                        <button
                          aria-label={
                            copied === t.id ? "Reply copied" : "Copy reply"
                          }
                          onClick={() => void copy(t)}
                        >
                          {copied === t.id ? (
                            <Check size={14} />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>
                  </article>
                </div>
              ))}
            </div>
          )}
          {pending && (
            <div className={styles.transcript}>
              <div className={styles.userRow}>
                <div className={styles.userBubble}>{pending}</div>
              </div>
              {busy ? (
                <div className={styles.thinking} role="status">
                  <span className={styles.smallAvatar}>
                    <Sparkles size={16} />
                  </span>
                  <span>
                    Thinking
                    <span className={styles.dots}>…</span>
                  </span>
                </div>
              ) : failed ? (
                <div className={styles.failed}>
                  <span>This message wasn’t completed.</span>
                  <button
                    disabled={!allowed}
                    onClick={() => void send(undefined, true)}
                  >
                    Try again
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className={styles.composerWrap}>
          {error && (
            <div className={styles.error} role="alert">
              {error}
              {!status && (
                <button onClick={() => setAttempt((x) => x + 1)}>
                  Reconnect
                </button>
              )}
            </div>
          )}
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
          {!loading && status && !allowed && (
            <div className={styles.availability}>
              The assistant isn’t connected yet. Contact your administrator.
              <Link href={`/machines/${machine.code}/documents`}>
                Open library
              </Link>
            </div>
          )}
          {!loading && status?.configured && status.ready === 0 && (
            <p className={styles.notice}>
              General chat is ready.{" "}
              {status.approved === 0
                ? "Document answers need an approved manual or SOP."
                : "Document references are still getting ready."}
            </p>
          )}
          {total >= 60 && (
            <div className={styles.availability}>
              This conversation is full. Start a new chat to continue.
              <button onClick={newChat}>New chat</button>
            </div>
          )}
          <form onSubmit={send} className={styles.composer}>
            <label htmlFor="chat-message" className={styles.srOnly}>
              Message the maintenance assistant
            </label>
            <textarea
              ref={input}
              id="chat-message"
              rows={2}
              maxLength={1000}
              value={draft}
              disabled={chatLoading}
              placeholder={
                turns.length ? "Ask a follow-up question…" : "Ask me anything…"
              }
              onChange={(e) => {
                draftRevision.current++;
                setDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className={styles.composerBottom}>
              <span>
                <BookOpen size={13} />
                References when needed
              </span>
              <button
                type="submit"
                aria-label="Send message"
                disabled={
                  busy ||
                  loading ||
                  chatLoading ||
                  !allowed ||
                  !draft.trim() ||
                  total >= 60
                }
              >
                <ArrowUp size={19} />
              </button>
            </div>
          </form>
          <p className={styles.disclaimer}>
            AI can make mistakes. Verify procedures before use.{" "}
            <span>Enter to send · Shift + Enter for a new line</span>
          </p>
        </div>
      </div>
      {panel && (
        <>
          <button
            className={styles.panelScrim}
            aria-label="Close source panel"
            onClick={() => setPanel(null)}
          />
          <aside
            className={styles.panel}
            ref={panelNode}
            role={overlay ? "dialog" : "complementary"}
            aria-modal={overlay ? true : undefined}
            aria-label={
              panel.kind === "knowledge" ? "Knowledge sources" : "Reply sources"
            }
          >
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.sectionLabel}>
                  {panel.kind === "knowledge"
                    ? "YOUR KNOWLEDGE"
                    : "SUPPORTING REFERENCES"}
                </span>
                <h2 tabIndex={-1} ref={panelTitle}>
                  {panel.kind === "knowledge"
                    ? "Knowledge sources"
                    : "Sources for this reply"}
                </h2>
              </div>
              <button
                aria-label="Close source panel"
                onClick={() => setPanel(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className={styles.panelBody}>
              {panel.kind === "knowledge" ? (
                <>
                  <p>
                    Only currently approved manuals and SOPs are used to answer
                    your questions.
                  </p>
                  <div className={styles.sourceSummary}>
                    <strong>
                      {status?.ready ?? 0}
                      <span> / {status?.approved ?? 0}</span>
                    </strong>
                    <span>approved references ready</span>
                    <button
                      aria-label="Refresh sources"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        loaded.current = null;
                        setAttempt((x) => x + 1);
                      }}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                  {!status?.items.length ? (
                    <p>No approved references yet.</p>
                  ) : (
                    status.items.map((s) => (
                      <div key={s.fileId} className={styles.knowledgeCard}>
                        <FileText size={20} />
                        <div>
                          <h3>{s.title}</h3>
                          <p>
                            Version {s.fileNumber}
                            {s.pages
                              ? ` · ${s.pages} ${s.pages === 1 ? "page" : "pages"}`
                              : ""}
                          </p>
                          <span
                            className={
                              s.status === "READY"
                                ? styles.ready
                                : styles.waiting
                            }
                          >
                            {s.status === "READY"
                              ? "Ready to use"
                              : s.status === "FAILED"
                                ? "Needs attention"
                                : "Getting ready"}
                          </span>
                          {s.error && (
                            <p>
                              {errorNames[s.error] ??
                                "This reference couldn’t be prepared. Please contact your administrator."}
                            </p>
                          )}
                          {status.canManage &&
                            s.indexId &&
                            ["FAILED", "INACTIVE"].includes(s.status) && (
                              <button
                                className={styles.textButton}
                                disabled={busy}
                                onClick={() => void retryIndex(s.indexId!)}
                              >
                                Retry preparation
                              </button>
                            )}
                        </div>
                      </div>
                    ))
                  )}
                  <Link
                    className={styles.libraryLink}
                    href={`/machines/${machine.code}/documents`}
                  >
                    <BookOpen size={16} />
                    Open manuals &amp; SOPs
                  </Link>
                  <p className={styles.privacy}>
                    Your question, recent conversation and selected passages are
                    sent to{" "}
                    {status?.provider === "commandcode"
                      ? "CommandCode"
                      : "the configured AI provider"}
                    . Document indexing stays on this computer. Conversations
                    are saved privately for your active role.
                  </p>
                </>
              ) : (
                sourceTurn?.answer.sources.map((s) => (
                  <article
                    key={s.id}
                    className={`${styles.sourceCard} ${panel.sourceId === s.id ? styles.activeSource : ""}`}
                  >
                    <span className={styles.sourceNumber}>{s.id.slice(1)}</span>
                    <h3>{s.title}</h3>
                    <p>
                      Approved version {s.fileNumber} · Page {s.page}
                    </p>
                    {[
                      ...new Set(
                        sourceTurn.answer.statements.flatMap((t) =>
                          t.citations
                            .filter((c) => c.sourceId === s.id)
                            .map((c) => c.quote),
                        ),
                      ),
                    ].map((q, i) => (
                      <blockquote key={i}>{q}</blockquote>
                    ))}
                    <details>
                      <summary>Full retrieved passage</summary>
                      <p>{s.text}</p>
                    </details>
                    <button
                      className={styles.download}
                      disabled={busy}
                      onClick={() => void download(s)}
                    >
                      <Download size={14} />
                      Download source PDF
                    </button>
                  </article>
                ))
              )}
            </div>
          </aside>
        </>
      )}
    </section>
  );
}
