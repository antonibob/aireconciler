/**
 * The procedures editor.
 *
 * This is the part that makes the add-in yours rather than generic: an
 * accountant writes down how a job is actually done — the order, the checks
 * that must pass, the vendors that always behave oddly — and the model follows
 * it instead of reasoning from first principles about work you have already
 * settled.
 */

import { useState } from "react";
import {
  allProcedures,
  deleteProcedure,
  saveProcedure,
} from "../procedures/store.js";
import type { Procedure } from "../procedures/types.js";

interface Draft {
  name?: string;
  title: string;
  description: string;
  body: string;
}

const BLANK: Draft = { title: "", description: "", body: "" };

const PLACEHOLDER_BODY = `# How we do this job

## Before you start
What to read first, and what to establish before forming a view.

## The method
1. The steps, in order.
2. The check that must pass before moving on.

## Usual suspects
The things that are nearly always the cause. Be specific — real amounts,
real vendor names, real account numbers.

## Output
What the finished answer looks like.`;

export function Procedures({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Procedure[]>(allProcedures);
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = () => setList(allProcedures());

  const edit = (p: Procedure) =>
    setDraft({ name: p.name, title: p.title, description: p.description, body: p.body });

  const save = () => {
    if (!draft || !draft.title.trim() || !draft.body.trim()) return;
    saveProcedure(draft);
    setDraft(null);
    refresh();
  };

  const remove = (p: Procedure) => {
    deleteProcedure(p.name);
    setDraft(null);
    refresh();
  };

  if (draft) {
    const canSave = draft.title.trim() !== "" && draft.body.trim() !== "";
    return (
      <div className="settings">
        <label className="field">
          <span>Name</span>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Month-end close"
          />
        </label>
        <label className="field">
          <span>
            When to use it <span className="field-hint">the model reads this to decide</span>
          </span>
          <textarea
            className="proc-input"
            rows={3}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Use when closing a month, when asked to tie out the card statement, or when someone mentions the GST gate."
          />
        </label>
        <label className="field">
          <span>The procedure</span>
          <textarea
            className="proc-input proc-body"
            rows={16}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder={PLACEHOLDER_BODY}
          />
        </label>
        <div className="settings-actions">
          <button className="btn primary" onClick={save} disabled={!canSave}>Save</button>
          <button className="btn ghost" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
      <p className="settings-note">
        Procedures are how this firm does a job. The model sees every name and description, and
        loads the full text when a request matches — so a procedure you write here changes how the
        work gets done, without touching the code.
      </p>
      <ul className="proc-list">
        {list.map((p) => (
          <li key={p.name}>
            <div className="proc-row">
              <span className="proc-title">{p.title}</span>
              {p.builtin && <span className="proc-badge">built-in</span>}
              <button className="link-btn" onClick={() => edit(p)}>Edit</button>
              {!p.builtin && (
                <button className="link-btn" onClick={() => remove(p)}>Delete</button>
              )}
            </div>
            <div className="proc-desc">{p.description}</div>
          </li>
        ))}
      </ul>
      <div className="settings-actions">
        <button className="btn primary" onClick={() => setDraft({ ...BLANK })}>New procedure</button>
        <button className="btn ghost" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
