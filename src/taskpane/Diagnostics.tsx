/**
 * The self-check panel.
 *
 * Nothing in the Office.js layer is covered by the test suite, so this is the
 * only thing that proves it works against a real host. It reports each step as
 * it completes rather than at the end, because the failure mode worth seeing is
 * "which step hung", not just "which step failed".
 */

import { useState } from "react";
import {
  runDiagnostics,
  summarizeChecks,
  verdict,
  verdictTone,
  type Check,
} from "../office/diagnostics.js";
import { isInExcel } from "../office/excelHost.js";

const ICON: Record<Check["status"], string> = { pass: "✓", fail: "✕", skip: "–" };

export function Diagnostics({ onClose }: { onClose: () => void }) {
  const [checks, setChecks] = useState<Check[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const run = async () => {
    setChecks([]);
    setDone(false);
    setRunning(true);
    try {
      await runDiagnostics((c) => setChecks((xs) => [...xs, c]));
    } catch (err) {
      setChecks((xs) => [
        ...xs,
        {
          name: "Self-check",
          status: "fail",
          detail: `The run itself failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    } finally {
      setRunning(false);
      setDone(true);
    }
  };

  const summary = summarizeChecks(checks);

  return (
    <div className="settings">
      <p className="settings-note">
        Exercises every path that touches Excel — cross-sheet reads, mixed literal and formula
        writes, undo, and the whole-column guard. All of it happens in a scratch worksheet that is
        deleted afterwards; your data is never written to.
      </p>

      {!isInExcel() && (
        <div className="settings-error">
          Not running inside Excel. Sideload the add-in and open this from the task pane.
        </div>
      )}

      <ul className="check-list">
        {checks.map((c, i) => (
          <li key={i} className={`check ${c.status}`}>
            <div className="check-row">
              <span className="check-icon">{ICON[c.status]}</span>
              <span className="check-name">{c.name}</span>
            </div>
            <div className="check-detail">{c.detail}</div>
          </li>
        ))}
        {running && (
          <li className="check running">
            <div className="check-row">
              <span className="check-icon">◐</span>
              <span className="check-name">Running…</span>
            </div>
          </li>
        )}
      </ul>

      {done && checks.length > 0 && <div className={`check-summary ${verdictTone(summary)}`}>{verdict(summary)}</div>}

      <div className="settings-actions">
        <button className="btn primary" onClick={() => void run()} disabled={running}>
          {running ? "Running…" : checks.length ? "Run again" : "Run self-check"}
        </button>
        <button className="btn ghost" onClick={onClose} disabled={running}>Done</button>
      </div>
    </div>
  );
}
