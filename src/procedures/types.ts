/**
 * Procedures — the layer that turns a toolbox into a colleague.
 *
 * Tools say what the add-in *can* do. A procedure says how *this firm* does a
 * job: the method, the order, the checks that must pass, and the domain
 * knowledge that stops the model reasoning from first principles about
 * something the accountant already knows.
 *
 * Loading follows progressive disclosure, the same way Claude handles skills:
 * every procedure's name and description sit in the system prompt (cheap, a
 * line each), and the full body is pulled only when the model decides the job
 * is that one. Fifty procedures cost fifty lines of context, not fifty pages.
 */

export interface Procedure {
  /** Stable slug the model passes to load_procedure. */
  name: string;
  /** Short human title for the UI. */
  title: string;
  /** When to use this. Always in context, so write it as a trigger. */
  description: string;
  /** The full instructions. Markdown. Loaded on demand. */
  body: string;
  /** Shipped with the add-in rather than written by the user. */
  builtin: boolean;
}

/** A procedure as the model first sees it: the menu line, without the body. */
export interface ProcedureSummary {
  name: string;
  title: string;
  description: string;
}

export function summarize(p: Procedure): ProcedureSummary {
  return { name: p.name, title: p.title, description: p.description };
}

/** Slugs must be safe to match on and stable across edits. */
export function normalizeName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
