import { useCallback, useEffect, useRef, useState } from "react";
import { chatCompletion, chatCompletionArray, ChatMessage, ModelRow } from "../model/index.js";
import { RangeInfo } from "./index.js";
import "./App.css";

/** Pull the selected range + a header/data sample so the model can write
 * correct references. Returns null when not in an Excel host. */
export async function gatherSheetContext(): Promise<{
  selectionAddress: string;
  selection: Array<Array<unknown>>;
  usedSample: string;
} | null> {
  const exl = window.Excel;
  if (!exl) return null;
  let selAddr = "";
  let sel: Array<Array<unknown>> = [];
  try {
    await exl.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load?.("address,values");
      await ctx.sync();
      selAddr = (range as unknown as RangeInfo).address || "";
      sel = (range as unknown as RangeInfo).values || [];
    });
  } catch {
    /* selection read failed; continue without it */
  }
  // Serialize the selection compactly for the prompt.
  const sample = sel.slice(0, 12).map((r) => r.join(" | "));
  return {
    selectionAddress: selAddr,
    selection: sel,
    usedSample: sample.length ? sample.join("\n") : "(empty selection)",
  };
}

const STORAGE_KEY = "ai-closer-config";

/** Curated valid OpenRouter model slugs — cheap picks that actually exist. */
const MODEL_PRESETS = [
  "deepseek/deepseek-v4-flash-0731",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-v3-0724",
  "deepseek/deepseek-reasoner",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash",
  "meta-llama/llama-3.3-70b-instruct",
  "mistralai/mistral-small-latest",
  "qwen/qwen-2.5-72b-instruct",
];

interface Config {
  apiKey: string;
  model: string;
}

function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Config;
  } catch {
    /* ignore */
  }
  return { apiKey: "", model: "deepseek/deepseek-v4-flash-0731" };
}

function saveConfig(c: Config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

interface UIMessage {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  /** Parsed multi-cell rows the model produced, if any. */
  rows?: ModelRow[] | null;
}

export function App() {
  const [config, setConfig] = useState<Config>(loadConfig);
  const [apiKeyDraft, setApiKeyDraft] = useState(config.apiKey);
  const [modelDraft, setModelDraft] = useState(config.model);
  const [messages, setMessages] = useState<UIMessage[]>([
    {
      role: "assistant",
      text: "Hi — I'm AI Closer, a Copilot-style assistant living in your spreadsheet. Ask me to write a formula, explain a reconciliation, or draft a journal entry.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  /** Does the prompt ask to produce values to apply into the sheet? */
  const wantsApply = (t: string) =>
    /\b(fill|apply|compute|calculate|extract|list|every row|per row|column of|populate|generate a column|calculate.*for each)\b/i.test(t);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      if (!config.apiKey) {
        setSettingsOpen(true);
        return;
      }
      setInput("");
      setMessages((m) => [...m, { role: "user", text }]);
      setBusy(true);
      try {
        const sheetCtx = await gatherSheetContext();
        const sysMsg: ChatMessage = {
          role: "system",
          content:
            "You are a concise, helpful assistant inside an Excel add-in. Plain text, short. " +
            "If the user selects a cell/range, a sheet context is provided as [SHEET CONTEXT]. " +
            "Write correct cell references. If asked to build a formula, output JUST the formula " +
            "starting with =, no prose, so it can be inserted into the active cell.",
        };
        const ctxMsg: ChatMessage | null = sheetCtx
          ? {
              role: "user",
              content: `[SHEET CONTEXT] Active selection: ${sheetCtx.selectionAddress}\nSelected data:\n${sheetCtx.usedSample}`,
            }
          : null;
        const prior = messages
          .filter((m) => m.role === "user" || (m.role === "assistant" && !m.error))
          .map((m) => ({ role: m.role, content: m.text }));
        const baseHistory: ChatMessage[] = [
          sysMsg,
          ...(ctxMsg ? [ctxMsg] : []),
          ...prior.map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: text },
        ];

        if (wantsApply(text)) {
          const res = await chatCompletionArray(baseHistory, {
            apiKey: config.apiKey,
            model: config.model,
          });
          // Prepend a hint that a ready-to-apply table was generated (if rows).
          const shown = res.rows
            ? `Ready to apply ${res.rows.length} row(s) × ${res.rows[0]?.length ?? 1} col(s) to your selection. Select the top-left cell, then hit "Apply to selection".\n\nPreview:\n${res.rows
                .slice(0, 5)
                .map((r) => "  " + r.join(" | "))
                .join("\n")}`
            : res.content;
          setMessages((m) => [
            ...m,
            { role: "assistant", text: shown, error: !res.ok, rows: res.rows },
          ]);
        } else {
          const res = await chatCompletion(baseHistory, {
            apiKey: config.apiKey,
            model: config.model,
          });
          setMessages((m) => [
            ...m,
            { role: "assistant", text: res.content, error: !res.ok },
          ]);
        }
      } catch (err) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
            error: true,
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, config, messages],
  );

  const applySettings = () => {
    const next = { apiKey: apiKeyDraft.trim(), model: modelDraft.trim() || "deepseek/deepseek-v4-flash-0731" };
    setConfig(next);
    saveConfig(next);
    setSettingsOpen(false);
  };

  /** Apply the last assistant's multi-cell rows into the selected top-left cell. */
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.error);
  const applyToSelection = async () => {
    const rows = lastAssistant?.rows;
    if (!rows || rows.length === 0) return;
    const exl = window.Excel;
    if (!exl) {
      setMessages((m) => [...m, { role: "assistant", text: "No Excel host (web demo) — can't apply to the sheet.", error: true }]);
      return;
    }
    try {
      // Drop trailing empty rows.
      const clean = rows.filter((r) => r.some((v) => v !== "" && v !== null && v !== undefined));
      await (window.Excel as unknown as {
        run(cb: (ctx: { workbook: { getSelectedRange(): RangeInfo & { getResizedRange(dr: number, dc: number): RangeInfo } }; sync(): Promise<unknown> }) => Promise<void> | void): Promise<unknown>;
      }).run(async (ctx) => {
        const anchor = ctx.workbook.getSelectedRange();
        const h = clean.length;
        const w = clean[0]?.length ?? 1;
        const dest = anchor.getResizedRange(h - 1, w - 1);
        dest.values = clean.map((r) => {
          // pad/truncate to width
          const row = new Array(w).fill(null);
          r.forEach((v, i) => {
            if (i < w) row[i] = v;
          });
          return row;
        });
        await ctx.sync();
      });
      setMessages((m) => [...m, { role: "assistant", text: `Applied ${clean.length} row(s) starting at the selected cell.`, }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `Couldn't apply: ${err instanceof Error ? err.message : String(err)}`, error: true }]);
    }
  };

  const writeToActiveCell = async () => {
    if (!lastAssistant) return;
    const exl = window.Excel;
    if (!exl) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "I'm not inside an Excel host (running as a web demo), so I can't write to a cell. Run this as an add-in to write formulas.", error: true },
      ]);
      return;
    }
    try {
      // Strip backtick fences; keep a leading "=" so a formula lands cleanly.
      const write = lastAssistant.text.replace(/```/g, "").trim();
      await (window.Excel as unknown as {
        run(cb: (ctx: { workbook: { getSelectedRange(): RangeInfo }; sync(): Promise<unknown> }) => Promise<void> | void): Promise<unknown>;
      }).run(async (ctx) => {
        // Write into the SELECTED range (top-left cell), so the user controls
        // where output lands by selecting a cell first.
        const range = ctx.workbook.getSelectedRange();
        range.values = [[write]];
        await ctx.sync();
      });
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Wrote "${write.slice(0, 60)}" to the selected cell.`, },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Couldn't write to the cell: ${err instanceof Error ? err.message : String(err)}`, error: true },
      ]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="chat-app">
      <div className="chat-header">
        <span className="chat-title">AI Closer</span>
        <span className="chat-subtitle">{config.model}</span>
        <button className="icon-btn" onClick={() => setSettingsOpen((o) => !o)} title="Settings">
          ⚙
        </button>
      </div>

      {settingsOpen && (
        <div className="settings">
          <label className="field">
            <span>OpenRouter API key</span>
            <input
              type="password"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              placeholder="sk-or-…"
            />
          </label>
          <label className="field">
            <span>Model</span>
            <select
              value={MODEL_PRESETS.includes(modelDraft) ? modelDraft : "__custom__"}
              onChange={(e) => setModelDraft(e.target.value)}
              className="model-select"
            >
              {MODEL_PRESETS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__custom__">Custom model…</option>
            </select>
            {!MODEL_PRESETS.includes(modelDraft) && (
              <input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                placeholder="provider/model-id"
                className="model-custom"
              />
            )}
          </label>
          <div className="settings-actions">
            <button className="btn" onClick={applySettings}>
              Save
            </button>
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">
              Get a key
            </a>
          </div>
        </div>
      )}

      <div className="chat-scroll" ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}${m.error ? " error" : ""}`}>
            <pre className="bubble-text">{m.text}</pre>
          </div>
        ))}
        {busy && (
          <div className="bubble assistant">
            <pre className="bubble-text typing">…</pre>
          </div>
        )}
      </div>

      <div className="chat-input-wrap">
        {!config.apiKey && (
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            Add your API key to start
          </button>
        )}
        {lastAssistant && lastAssistant.rows && lastAssistant.rows.length > 0 && (
          <button className="btn apply-btn" onClick={applyToSelection} disabled={busy}>
            ↧ Apply ({lastAssistant.rows.length} rows) to selection
          </button>
        )}
        {lastAssistant && !lastAssistant.rows?.length && (
          <button className="btn insert-btn" onClick={writeToActiveCell} disabled={busy}>
            ↧ Insert to cell
          </button>
        )}
        <textarea
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder={config.apiKey ? "Ask AI Closer…" : "Add API key above"}
        />
        <button className="send-btn" onClick={() => send(input)} disabled={busy || !config.apiKey}>
          ➤
        </button>
      </div>
    </div>
  );
}