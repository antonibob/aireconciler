/**
 * Procedure storage.
 *
 * The built-ins are a starting point, not the product. The point is that an
 * accountant can write down how *their* job is done — the checks that must
 * pass, the vendors that always behave oddly, the order of operations — and
 * have the add-in follow it. That has to be editable without a rebuild, so
 * user procedures live in browser storage next to the shipped ones.
 */

import { BUILTIN_PROCEDURES } from "./builtin.js";
import { normalizeName, summarize, type Procedure, type ProcedureSummary } from "./types.js";

const STORAGE_KEY = "ai-closer-procedures";

/** A user procedure, or an override of a built-in with the same name. */
type Stored = Pick<Procedure, "name" | "title" | "description" | "body">;

function readStored(): Stored[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Stored =>
        typeof p?.name === "string" &&
        typeof p?.title === "string" &&
        typeof p?.description === "string" &&
        typeof p?.body === "string",
    );
  } catch {
    // Corrupt or unavailable storage falls back to the built-ins rather than
    // failing the pane; a rec is still possible without custom procedures.
    return [];
  }
}

function writeStored(list: Stored[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

/**
 * Built-ins plus user procedures. A user procedure with the same name as a
 * built-in replaces it — that is how a firm adapts a shipped method to its own
 * conventions without losing the rest.
 */
export function allProcedures(): Procedure[] {
  const stored = readStored();
  const overridden = new Set(stored.map((s) => s.name));
  return [
    ...BUILTIN_PROCEDURES.filter((b) => !overridden.has(b.name)),
    ...stored.map((s) => ({ ...s, builtin: false })),
  ];
}

export function listProcedures(): ProcedureSummary[] {
  return allProcedures().map(summarize);
}

export function getProcedure(name: string): Procedure | null {
  const wanted = normalizeName(name);
  return allProcedures().find((p) => p.name === wanted) ?? null;
}

export function saveProcedure(input: {
  name?: string;
  title: string;
  description: string;
  body: string;
}): Procedure {
  const name = normalizeName(input.name || input.title);
  const entry: Stored = {
    name,
    title: input.title.trim(),
    description: input.description.trim(),
    body: input.body,
  };
  const stored = readStored().filter((s) => s.name !== name);
  writeStored([...stored, entry]);
  return { ...entry, builtin: false };
}

/** Removing a user procedure restores the built-in of the same name, if any. */
export function deleteProcedure(name: string): void {
  writeStored(readStored().filter((s) => s.name !== normalizeName(name)));
}

/**
 * The menu the model always sees. Kept to one line per procedure so the
 * system prompt stays small no matter how many the firm writes.
 */
export function proceduresMenu(list: ProcedureSummary[]): string {
  if (list.length === 0) return "";
  const lines = list.map((p) => `- ${p.name}: ${p.description}`).join("\n");
  return `\n\n## Procedures\n\nThese are this firm's documented ways of doing a job. When a request matches one, call load_procedure with its name and follow it — it outranks your own instincts about how the work should be done, because it encodes decisions the accountant has already made.\n\n${lines}\n\nIf none matches, work from first principles with the tools.`;
}
