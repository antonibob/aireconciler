import { useEffect, useMemo, useState } from "react";
import { reconcile, formatCents, Flag, SUSPENSE_GL, CardTieOut } from "../engine/index.js";
import { suggestGlCodes, GlSuggestion } from "../model/index.js";
import {
  DEMO_TRANSACTIONS,
  DEMO_STATEMENT_TOTALS,
  DEMO_GST_HISTORY,
  demoCode,
  GL_ACCOUNTS,
} from "./demo.js";
import "./App.css";

const SEVERITY_ORDER: Record<Flag["severity"], number> = {
  error: 0,
  warn: 1,
  info: 2,
};

export function App() {
  const [apiKey, setApiKey] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [suggestions, setSuggestions] = useState<GlSuggestion[]>([]);
  const [modelNote, setModelNote] = useState<string>("");

  const result = useMemo(
    () =>
      reconcile({
        transactions: DEMO_TRANSACTIONS,
        statementTotals: DEMO_STATEMENT_TOTALS,
        gstHistoryMonths: DEMO_GST_HISTORY,
        code: demoCode,
        statementAmountDueCents: 53900, // coded sum (suspense row excluded)
      }),
    [],
  );

  useEffect(() => {
    setModelNote(
      apiKey
        ? "Key set — Draft codes will call OpenRouter."
        : "No API key — Draft codes is disabled. Bring your own cheap key in settings.",
    );
  }, [apiKey]);

  const suspenseRows = useMemo(
    () => result.rows.filter((r) => r.glCode === SUSPENSE_GL).map((r) => r.transaction),
    [result],
  );

  const sortedFlags = useMemo(
    () => [...result.flags].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]),
    [result],
  );

  const draft = async () => {
    if (!apiKey || suspenseRows.length === 0) return;
    setDrafting(true);
    const out = await suggestGlCodes(suspenseRows, GL_ACCOUNTS, {
      apiKey,
      model: "deepseek/deepseek-v3-0724",
    });
    setSuggestions(out);
    setDrafting(false);
  };

  return (
    <div className="app">
      <div className="header">
        <span className="title">AI Closer</span>
        <span className={`badge ${result.passed ? "passed" : "failed"}`}>
          {result.passed ? "Reconciled" : "Needs review"}
        </span>
      </div>
      <div className="subtitle">Deterministic engine · BYO-key draft layer</div>

      <div className="card">
        <h3>Variance (must be $0.00)</h3>
        <div className="variance">
          <span className={`num ${result.varianceCents === 0 ? "ok" : "bad"}`}>
            {formatCents(result.varianceCents)}
          </span>
          <span className="label">Amount due − coded</span>
        </div>
      </div>

      <div className="card">
        <h3>Per-card tie-out</h3>
        {result.cardTieOuts.map((t) => (
          <TieOutRow key={t.last4} t={t} />
        ))}
      </div>

      <div className="card">
        <h3>Flags ({sortedFlags.length})</h3>
        {sortedFlags.map((f, i) => (
          <div key={i} className={`flag ${f.severity}`}>
            <span className="dot" />
            <span className="msg">{f.message}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Draft coding ({suspenseRows.length} open)</h3>
        {suspenseRows.length === 0 ? (
          <div className="note">No suspense rows — nothing to draft.</div>
        ) : (
          <>
            {suggestions.map((s, i) => (
              <div key={i} className="row">
                <span className="k">{s.transaction.description}</span>
                <span className="ok">
                  {s.glCode ?? "unresolved"} · {s.confidence}
                </span>
              </div>
            ))}
            <button className="btn" onClick={draft} disabled={!apiKey || drafting}>
              {drafting ? "Drafting…" : "Draft GL codes"}
            </button>
            <div className="note">{modelNote}</div>
          </>
        )}
      </div>

      <div className="card">
        <h3>Settings</h3>
        <div className="field">
          <label>OpenRouter API key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-or-…"
          />
        </div>
        <button
          className="btn secondary"
          onClick={() => window.open("https://openrouter.ai/settings/keys", "_blank")}
        >
          Get a key
        </button>
        <a
          href="https://github.com/antonio-clair/office-ai-closer"
          className="note"
          style={{ display: "block", marginTop: 10 }}
        >
          View source on GitHub
        </a>
      </div>
    </div>
  );
}

function TieOutRow({ t }: { t: CardTieOut }) {
  return (
    <div className="row">
      <span className="k">
        {t.last4} · {t.holder}
      </span>
      <span className={t.deltaCents === 0 ? "ok" : "bad"}>{formatCents(t.statementNetCents)}</span>
    </div>
  );
}