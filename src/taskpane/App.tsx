import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchToolCapableModels,
  type ChatMessage,
  type ModelOption,
} from "../model/client.js";
import { SYSTEM_PROMPT } from "../model/tools.js";
import { createExecutor, type PendingWrite } from "../office/executor.js";
import {
  applyWrite,
  excelHost,
  isInExcel,
  revertWrite,
  type AppliedWrite,
} from "../office/excelHost.js";
import { getProcedure, listProcedures, proceduresMenu } from "../procedures/store.js";
import { runAgent, trimHistory, type AgentEvent } from "./agent.js";
import { Markdown } from "./markdown.js";
import { Procedures } from "./Procedures.js";
import { Diagnostics } from "./Diagnostics.js";
import "./App.css";

const STORAGE_KEY = "ai-closer-config";
const FALLBACK_MODEL = "anthropic/claude-3.5-sonnet";

interface Config {
  apiKey: string;
  model: string;
}

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Config>;
      return {
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        model: typeof parsed.model === "string" && parsed.model ? parsed.model : FALLBACK_MODEL,
      };
    }
  } catch {
    /* corrupt or unavailable storage is not worth failing the pane over */
  }
  return { apiKey: "", model: FALLBACK_MODEL };
}

function saveConfig(c: Config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/** What the user sees. Distinct from the model-facing message list. */
type Entry =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "tool"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { kind: "error"; id: string; text: string }
  | {
      kind: "write";
      id: string;
      write: PendingWrite;
      status: "pending" | "applied" | "reverted" | "rejected";
      applied?: AppliedWrite;
      error?: string;
    };

const TOOL_LABELS: Record<string, string> = {
  get_sheet_context: "Inspecting the sheet",
  list_sheets: "Listing sheets",
  load_procedure: "Loading procedure",
  read_range: "Reading",
  reconcile_columns: "Reconciling",
  find_duplicates: "Checking for duplicates",
  propose_write: "Preparing a change",
  create_table: "Creating a table",
};

function toolLabel(name: string, args: Record<string, unknown>): string {
  const base = TOOL_LABELS[name] ?? name;
  if (name === "load_procedure" && typeof args.name === "string") return `${base}: ${args.name}`;
  const addr = typeof args.address === "string" ? args.address : null;
  return addr ? `${base} ${addr}` : base;
}

let idSeq = 0;
const nextId = () => `e${++idSeq}`;

function cellText(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Before/after grid for a staged change. */
function WriteDiff({ entry, onAccept, onReject, onRevert }: {
  entry: Extract<Entry, { kind: "write" }>;
  onAccept: () => void;
  onReject: () => void;
  onRevert: () => void;
}) {
  const { write, status } = entry;
  const preview = write.values.slice(0, 8);
  return (
    <div className={`write-card ${status}`}>
      <div className="write-head">
        <span className="write-note">{write.note}</span>
        <span className="write-addr">{write.address}</span>
      </div>
      <div className="md-table-wrap">
        <table className="md-table diff-table">
          <tbody>
            {preview.map((row, ri) => (
              <tr key={ri}>
                {row.map((v, ci) => {
                  const was = cellText(write.before[ri]?.[ci]);
                  const now = cellText(v);
                  return (
                    <td key={ci} className={was !== now ? "changed" : undefined}>
                      {was && was !== now && <span className="was">{was}</span>}
                      <span className="now">{now}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {write.values.length > preview.length && (
        <div className="write-more">+{write.values.length - preview.length} more row(s)</div>
      )}
      {entry.error && <div className="write-error">{entry.error}</div>}
      {status === "pending" && (
        <div className="write-actions">
          <button className="btn primary" onClick={onAccept}>Apply to sheet</button>
          <button className="btn ghost" onClick={onReject}>Discard</button>
        </div>
      )}
      {status === "applied" && (
        <div className="write-actions">
          <span className="write-state">Applied</span>
          <button className="btn ghost" onClick={onRevert}>Undo</button>
        </div>
      )}
      {status === "reverted" && <div className="write-state">Reverted</div>}
      {status === "rejected" && <div className="write-state">Discarded — sheet unchanged</div>}
    </div>
  );
}

export function App() {
  const [config, setConfig] = useState<Config>(loadConfig);
  const [apiKeyDraft, setApiKeyDraft] = useState(config.apiKey);
  const [modelDraft, setModelDraft] = useState(config.model);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!config.apiKey);
  const [procsOpen, setProcsOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [spend, setSpend] = useState(0);

  // The model-facing transcript, kept separately from what we render.
  const convo = useRef<ChatMessage[]>([{ role: "system", content: SYSTEM_PROMPT }]);
  const abort = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, busy]);

  const push = useCallback((e: Entry) => setEntries((xs) => [...xs, e]), []);
  const patch = useCallback((id: string, fn: (e: Entry) => Entry) => {
    setEntries((xs) => xs.map((e) => (e.id === id ? fn(e) : e)));
  }, []);

  // Which key we have already tried, so a failed fetch is not retried forever.
  const modelsTriedFor = useRef<string | null>(null);

  /** Pull the model catalogue so the picker only offers models that can
   *  actually drive tools. A stale hardcoded slug 404s every request, which
   *  is indistinguishable from the add-in being broken. */
  const refreshModels = useCallback(async (key: string) => {
    modelsTriedFor.current = key;
    setLoadingModels(true);
    setModelsError(null);
    const res = await fetchToolCapableModels({ apiKey: key });
    setLoadingModels(false);
    if (!res.ok) {
      setModelsError(res.error ?? "Could not load models.");
      return;
    }
    setModels(res.models);
  }, []);

  // Load the catalogue once when settings first open. Changing the key
  // refreshes it on blur, not on every keystroke.
  useEffect(() => {
    if (settingsOpen && modelsTriedFor.current === null) {
      void refreshModels(apiKeyDraft);
    }
  }, [settingsOpen, apiKeyDraft, refreshModels]);

  const refreshIfKeyChanged = () => {
    if (modelsTriedFor.current !== apiKeyDraft) void refreshModels(apiKeyDraft);
  };

  const acceptWrite = useCallback(
    async (id: string, write: PendingWrite) => {
      try {
        const applied = await applyWrite(write);
        patch(id, (e) => (e.kind === "write" ? { ...e, status: "applied", applied } : e));
      } catch (err) {
        patch(id, (e) =>
          e.kind === "write"
            ? { ...e, error: err instanceof Error ? err.message : String(err) }
            : e,
        );
      }
    },
    [patch],
  );

  const revert = useCallback(
    async (id: string, applied?: AppliedWrite) => {
      if (!applied) return;
      try {
        await revertWrite(applied);
        patch(id, (e) => (e.kind === "write" ? { ...e, status: "reverted" } : e));
      } catch (err) {
        patch(id, (e) =>
          e.kind === "write"
            ? { ...e, error: err instanceof Error ? err.message : String(err) }
            : e,
        );
      }
    },
    [patch],
  );

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || busy) return;
      if (!config.apiKey) {
        setSettingsOpen(true);
        return;
      }
      setInput("");
      push({ kind: "user", id: nextId(), text: prompt });
      setBusy(true);

      const controller = new AbortController();
      abort.current = controller;

      // One streaming bubble per assistant turn; tool cards land between turns.
      let bubbleId: string | null = null;
      const ensureBubble = () => {
        if (bubbleId === null) {
          bubbleId = nextId();
          push({ kind: "assistant", id: bubbleId, text: "", streaming: true });
        }
        return bubbleId;
      };

      const toolEntryIds = new Map<string, string>();

      const onEvent = (ev: AgentEvent) => {
        switch (ev.type) {
          case "text": {
            const id = ensureBubble();
            patch(id, (e) => (e.kind === "assistant" ? { ...e, text: e.text + ev.delta } : e));
            break;
          }
          case "tool_start": {
            // Close the current bubble; anything after the tool is a new turn.
            if (bubbleId) {
              const done = bubbleId;
              patch(done, (e) => (e.kind === "assistant" ? { ...e, streaming: false } : e));
              bubbleId = null;
            }
            const id = nextId();
            toolEntryIds.set(ev.call.id, id);
            push({ kind: "tool", id, label: toolLabel(ev.call.name, ev.call.args), status: "running" });
            break;
          }
          case "tool_end": {
            const id = toolEntryIds.get(ev.call.id);
            if (!id) break;
            const payload = ev.result.content as { error?: string } | undefined;
            patch(id, (e) =>
              e.kind === "tool"
                ? {
                    ...e,
                    status: ev.result.isError ? "error" : "done",
                    detail: ev.result.isError ? payload?.error : undefined,
                  }
                : e,
            );
            break;
          }
          case "turn_end": {
            if (bubbleId) {
              patch(bubbleId, (e) => (e.kind === "assistant" ? { ...e, streaming: false } : e));
            } else if (ev.content) {
              push({ kind: "assistant", id: nextId(), text: ev.content, streaming: false });
            }
            break;
          }
          case "error": {
            if (bubbleId) {
              patch(bubbleId, (e) => (e.kind === "assistant" ? { ...e, streaming: false } : e));
              bubbleId = null;
            }
            push({ kind: "error", id: nextId(), text: ev.message });
            break;
          }
        }
      };

      const execute = createExecutor({
        host: excelHost,
        stageWrite: (write) => push({ kind: "write", id: nextId(), write, status: "pending" }),
        getProcedure,
        listProcedures,
      });

      // Rebuild the system turn each send so a procedure written a moment ago
      // is already on the menu.
      const system: ChatMessage = {
        role: "system",
        content: SYSTEM_PROMPT + proceduresMenu(listProcedures()),
      };
      convo.current = trimHistory([
        system,
        ...convo.current.filter((m) => m.role !== "system"),
        { role: "user", content: prompt },
      ]);

      const outcome = await runAgent({
        messages: convo.current,
        cfg: { apiKey: config.apiKey, model: config.model, signal: controller.signal },
        execute,
        onEvent,
      });

      convo.current = trimHistory(outcome.messages);
      setSpend((s) => s + outcome.totalCost);
      abort.current = null;
      setBusy(false);
    },
    [busy, config, push, patch],
  );

  const stop = () => abort.current?.abort();

  const applySettings = () => {
    const next = { apiKey: apiKeyDraft.trim(), model: modelDraft.trim() || FALLBACK_MODEL };
    setConfig(next);
    saveConfig(next);
    setSettingsOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  return (
    <div className="chat-app">
      <div className="chat-header">
        <span className="chat-title">AI Closer</span>
        <span className={`status-dot ${config.apiKey ? "on" : ""}`} title={config.apiKey ? "Key set" : "No API key"} />
        <span className="chat-subtitle">{config.model}</span>
        {spend > 0 && <span className="spend">${spend.toFixed(4)}</span>}
        <button
          className="icon-btn"
          onClick={() => { setProcsOpen((o) => !o); setSettingsOpen(false); setDiagOpen(false); }}
          title="Procedures — how this firm does a job"
        >
          ☰
        </button>
        <button
          className="icon-btn"
          onClick={() => { setSettingsOpen((o) => !o); setProcsOpen(false); setDiagOpen(false); }}
          title="Settings"
        >
          ⚙
        </button>
        <button
          className="icon-btn"
          onClick={() => { setDiagOpen((o) => !o); setProcsOpen(false); setSettingsOpen(false); }}
          title="Self-check — verify the Excel connection"
        >
          ⚕
        </button>
      </div>

      {!isInExcel() && (
        <div className="host-warning">
          Not running inside Excel — sheet tools are unavailable in this preview.
        </div>
      )}

      {procsOpen && <Procedures onClose={() => setProcsOpen(false)} />}

      {diagOpen && <Diagnostics onClose={() => setDiagOpen(false)} />}

      {settingsOpen && (
        <div className="settings">
          <label className="field">
            <span>OpenRouter API key</span>
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              onBlur={refreshIfKeyChanged}
              placeholder="sk-or-…"
            />
          </label>
          <label className="field">
            <span>
              Model{" "}
              <span className="field-hint">
                {loadingModels ? "loading…" : `${models.length} tool-capable`}
              </span>
            </span>
            <input
              list="or-models"
              value={modelDraft}
              onChange={(e) => setModelDraft(e.target.value)}
              placeholder="provider/model-id"
            />
            <datalist id="or-models">
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </datalist>
          </label>
          {modelsError && (
            <div className="settings-error">
              {modelsError}{" "}
              <button className="link-btn" onClick={() => void refreshModels(apiKeyDraft)}>
                Retry
              </button>
            </div>
          )}
          <p className="settings-note">
            Only models that support tool calling are listed — AI Closer drives the sheet through
            tools, so a model without them cannot work. Your key goes straight to OpenRouter; there
            is no server in between.
          </p>
          <div className="settings-actions">
            <button className="btn primary" onClick={applySettings}>Save</button>
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Get a key</a>
          </div>
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {entries.length === 0 && (
          <div className="empty">
            <p className="empty-title">Reconciliation copilot</p>
            <p>Select your data and ask. Every number comes from the deterministic engine, and nothing reaches the sheet without your approval.</p>
            <ul>
              <li>Reconcile the GL column against the bank column</li>
              <li>Any duplicate payments in this range?</li>
              <li>Why doesn't this tie out?</li>
            </ul>
          </div>
        )}
        {entries.map((e) => {
          switch (e.kind) {
            case "user":
              return <div className="bubble user" key={e.id}><div className="bubble-text">{e.text}</div></div>;
            case "assistant":
              return (
                <div className="bubble assistant" key={e.id}>
                  <div className="bubble-text">
                    <Markdown text={e.text} />
                    {e.streaming && <span className="caret" />}
                  </div>
                </div>
              );
            case "tool":
              return (
                <div className={`tool-card ${e.status}`} key={e.id}>
                  <span className="tool-icon">{e.status === "running" ? "◐" : e.status === "done" ? "✓" : "!"}</span>
                  <span className="tool-label">{e.label}</span>
                  {e.detail && <span className="tool-detail">{e.detail}</span>}
                </div>
              );
            case "write":
              return (
                <WriteDiff
                  key={e.id}
                  entry={e}
                  onAccept={() => void acceptWrite(e.id, e.write)}
                  onReject={() => patch(e.id, (x) => (x.kind === "write" ? { ...x, status: "rejected" } : x))}
                  onRevert={() => void revert(e.id, e.applied)}
                />
              );
            case "error":
              return <div className="bubble error" key={e.id}><div className="bubble-text">{e.text}</div></div>;
          }
        })}
      </div>

      <div className="chat-input-wrap">
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={config.apiKey ? "Ask AI Closer…" : "Add your OpenRouter key to start"}
        />
        {busy ? (
          <button className="send-btn stop" onClick={stop} title="Stop">■</button>
        ) : (
          <button className="send-btn" onClick={() => void send(input)} disabled={!config.apiKey} title="Send">➤</button>
        )}
      </div>
    </div>
  );
}
