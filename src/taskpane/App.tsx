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
  let formulas: Array<Array<unknown>> = [];
  try {
    await exl.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load?.("address,values,formulas");
      await ctx.sync();
      selAddr = (range as unknown as RangeInfo).address || "";
      sel = (range as unknown as RangeInfo).values || [];
      formulas = (range as unknown as { formulas: Array<Array<unknown>> }).formulas || [];
    });
  } catch {
    /* selection read failed; continue without it */
  }
  // Serialize the selection compactly for the prompt. When a cell holds a
  // formula, show the FORMULA (not just the value) so the model sees the
  // relationship. A cell that is a plain value shows its value.
  const sample = sel.slice(0, 12).map((row, ri) =>
    row.map((v, ci) => {
      const f = formulas[ri]?.[ci];
      return f !== undefined && typeof f === "string" && (f as string).startsWith("=")
        ? String(f)
        : String(v ?? "");
    }).join(" | "),
  );
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
  const [undo, setUndo] = useState<{ address: string; values: Array<Array<unknown>> } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  /** Does the prompt ask to produce values to apply into the sheet? */
  const wantsApply = (t: string) =>
    /\b(fill|apply|compute|calculate|extract|list|every row|per row|column of|populate|generate a column|calculate.*for each)\b/i.test(t);

  /** Does the prompt ask to write/set/place a value into the sheet? */
  const wantsWrite = (t: string) =>
    /\b(put|set|write|place|type|enter|insert|fill in)\b.*\b(cell|selected|range|this|there|sheet)\b|\b(put|write)\b.*\b(number|value|\d)\b/i.test(t);

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

        if (wantsApply(text) || wantsWrite(text)) {
          const res = await chatCompletionArray(baseHistory, {
            apiKey: config.apiKey,
            model: config.model,
          });
          // If the model produced rows (a value or a table), write them directly.
          if (res.rows && res.rows.length > 0) {
            const shown = wantsWrite(text)
              ? `Writing to the selected cell…`
              : `Ready: ${res.rows.length} row(s) × ${res.rows[0]?.length ?? 1} col(s).\n\nPreview:\n${res.rows.slice(0, 5).map((r) => "  " + r.join(" | ")).join("\n")}`;
            setMessages((m) => [...m, { role: "assistant", text: shown, error: !res.ok, rows: res.rows ?? undefined }]);
            await autoApply(res.rows);
          } else {
            setMessages((m) => [...m, { role: "assistant", text: res.content, error: !res.ok, rows: res.rows ?? undefined }]);
          }
        } else {
          const res = await chatCompletion(baseHistory, {
            apiKey: config.apiKey,
            model: config.model,
          });
          setMessages((m) => [...m, { role: "assistant", text: res.content, error: !res.ok, }]);
          // If it produced a bare formula (starts with =), write it directly too.
          const trimmed = res.content.replace(/```/g, "").trim();
          if (window.Excel && trimmed.startsWith("=")) {
            await autoApply(undefined, trimmed);
          }
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

  /** Write a rect (rows) into the selected range, snapshotting prior cells for undo. Returns true on success, false if no Excel host. */
  const writeRectToSelection = async (rows: Array<Array<string | number>>, note: string): Promise<boolean> => {
    if (!window.Excel) {
      setMessages((m) => [...m, { role: "assistant", text: "I'm not inside an Excel host (running as a web demo), so I can't write to the sheet.", error: true }]);
      return false;
    }
    const clean = rows.filter((r) => r.some((v) => v !== "" && v !== null && v !== undefined));
    if (clean.length === 0) return false;
    try {
      // Actually write now, snapshotting prior values for undo right before overwrite.
      await (window.Excel as unknown as {
        run(cb: (ctx: { workbook: { getSelectedRange(): RangeInfo & { getResizedRange(dr: number, dc: number): RangeInfo } }; sync(): Promise<unknown> }) => Promise<void> | void): Promise<unknown>;
      }).run(async (ctx) => {
        const anchor = ctx.workbook.getSelectedRange();
        const h = clean.length;
        const w = clean[0]?.length ?? 1;
        const dest = anchor.getResizedRange(h - 1, w - 1);
        // Snapshot prior formulas+address for undo right before overwrite.
        dest.load?.("address,formulas");
        await ctx.sync();
        const prior = (dest as unknown as { formulas: Array<Array<unknown>> }).formulas;
        const addr = (dest as unknown as { address: string }).address ?? anchor.address ?? "(selected)";
        setUndo({ address: addr, values: prior });
        // Build the write. Cells that are formulas (start with =) go through
        // .formulas so they STAY live formulas; plain values go through .values.
        const valueRows: Array<Array<string | number>> = [];
        const formulaRows: Array<Array<string>> = [];
        for (const r of clean) {
          const vrow = new Array(w).fill(null);
          const frow = new Array(w).fill(null);
          r.forEach((v, i) => {
            if (i < w) {
              if (typeof v === "string" && v.startsWith("=")) {
                frow[i] = v;
              } else {
                vrow[i] = v;
              }
            }
          });
          valueRows.push(vrow);
          formulaRows.push(frow);
        }
        dest.values = valueRows;
        dest.formulas = formulaRows;
        await ctx.sync();
      });
      // Verify by reading back what was written (never report a write that didn't land).
      let verified = "";
      try {
        await (window.Excel as unknown as {
          run(cb: (ctx: { workbook: { getSelectedRange(): RangeInfo & { getResizedRange(dr: number, dc: number): RangeInfo } }; sync(): Promise<unknown> }) => Promise<void> | void): Promise<unknown>;
        }).run(async (ctx) => {
          const anchor = ctx.workbook.getSelectedRange();
          const dest = anchor.getResizedRange(clean.length - 1, (clean[0]?.length ?? 1) - 1);
          dest.load?.("address,formulas");
          await ctx.sync();
          const got = (dest as unknown as { formulas: Array<Array<unknown>> }).formulas?.[0]?.[0];
          verified = ` (read-back: ${JSON.stringify(got)})`;
        });
      } catch {
        verified = "";
      }
      setMessages((m) => [...m, { role: "assistant", text: `✓ ${note}${verified}`, }]);
      return true;
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `Couldn't write: ${err instanceof Error ? err.message : String(err)}`, error: true }]);
      return false;
    }
  };

  /** Let the user revert the last direct write. */
  const undoLast = async () => {
    if (!undo) return;
    if (!window.Excel) return;
    try {
      await (window.Excel as unknown as {
        run(cb: (ctx: { workbook: { getRange(address: string): { values: unknown } }; sync(): Promise<unknown> }) => Promise<void> | void): Promise<unknown>;
      }).run(async (ctx) => {
        ctx.workbook.getRange(undo.address).values = undo.values;
        await ctx.sync();
      });
      setUndo(null);
      setMessages((m) => [...m, { role: "assistant", text: "↩ Reverted the last change.", }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "assistant", text: `Undo failed: ${err instanceof Error ? err.message : String(err)}`, error: true }]);
    }
  };

  /** Apply the last assistant reply directly to the sheet (auto, no button). */
  const autoApply = async (rows?: Array<Array<string | number>> | null, text?: string) => {
    if (rows && rows.length > 0) {
      await writeRectToSelection(rows, `Applied ${rows.length} row(s) to your selection.`);
    } else if (text) {
      const val = text.replace(/```/g, "").trim();
      if (val) await writeRectToSelection([[val]], "Wrote to your selected cell.");
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
        <sup className={`status-dot ${config.apiKey ? "on" : ""}`} title={config.apiKey ? "Connected" : "Add API key"} />
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
        {undo && (
          <button className="btn undo-btn" onClick={undoLast} disabled={busy} title="Revert the last change I made to your sheet">
            ↩ Undo last change
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