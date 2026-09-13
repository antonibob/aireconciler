/**
 * Tool definitions handed to the model.
 *
 * This replaces the keyword routing that used to live in the taskpane. The app
 * no longer guesses intent from the user's wording — the model is shown what it
 * can do and picks, with arguments it chose from real sheet context.
 *
 * Shape is the OpenAI function-calling schema, which OpenRouter accepts
 * verbatim on /api/v1/chat/completions.
 */

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: false;
    };
  };
}

/** A tool call the model asked for, after arguments are parsed. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Set when the model emitted arguments we could not parse as JSON. */
  parseError?: string;
}

/** The result of executing one tool call, fed back to the model. */
export interface ToolResult {
  toolCallId: string;
  name: string;
  /** JSON-serialisable payload the model reads. */
  content: unknown;
  isError?: boolean;
}

const A1 = "An A1-style range address, e.g. \"B2:D400\" or \"Sheet2!A1:C99\".";

export const TOOLS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "get_sheet_context",
      description:
        "Inspect the active worksheet before doing anything else. Returns the sheet name, the used-range address and size, the detected header row with column letters and inferred types, any named Excel tables, and a small sample of data rows. Call this first whenever you need to know what columns exist or where the data sits. Cheap — prefer it over guessing.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "read_range",
      description:
        "Read the cell values of a specific range. Use after get_sheet_context when you need actual data rather than a sample. Large ranges are truncated; the reply says so when that happens.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: A1 },
          maxRows: {
            type: "integer",
            description: "Cap on rows returned. Defaults to 200. Raise only when you genuinely need more.",
          },
        },
        required: ["address"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reconcile_columns",
      description:
        "Run the deterministic reconciliation engine over two amount columns (for example GL/book against bank). Returns exact integer-cent totals, one-to-one matched pairs with their real worksheet row numbers, unmatched rows on each side, the residual, and a transposition check. YOU MUST NOT do this arithmetic yourself — call this tool and report what it returns. Amounts are parsed from messy exports (parentheses negatives, DR/CR markers, currency symbols, European decimals).",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: A1 + " Must cover both columns." },
          columnA: {
            type: "integer",
            description: "Zero-based column index WITHIN the address for the first (book/GL) amounts.",
          },
          columnB: {
            type: "integer",
            description: "Zero-based column index WITHIN the address for the second (bank) amounts.",
          },
          toleranceCents: {
            type: "integer",
            description: "Allowed per-pair difference in cents. Defaults to 0 (exact). Use sparingly.",
          },
        },
        required: ["address", "columnA", "columnB"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_duplicates",
      description:
        "Flag likely duplicate payments: same vendor and same amount within a date window. Deterministic — call this instead of eyeballing rows.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: A1 },
          vendorColumn: { type: "integer", description: "Zero-based column index within the address." },
          amountColumn: { type: "integer", description: "Zero-based column index within the address." },
          dateColumn: { type: "integer", description: "Zero-based column index within the address." },
          dateWindowDays: { type: "integer", description: "Defaults to 3." },
        },
        required: ["address", "vendorColumn", "amountColumn", "dateColumn"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_write",
      description:
        "Stage a change to the worksheet for the user to review. This does NOT modify the sheet — it shows the user a before/after diff which they accept or reject. This is the ONLY way to put anything into a cell. Never claim you have written something; say you have proposed it. Values beginning with = are written as live formulas.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: A1 + " Must match the shape of `values` exactly.",
          },
          values: {
            type: "array",
            description: "Rows of cell values. Every row must have the same length.",
            items: {
              type: "array",
              items: { type: ["string", "number", "null"] },
            },
          },
          note: {
            type: "string",
            description: "One short line telling the user what this change does, shown above the diff.",
          },
        },
        required: ["address", "values", "note"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_table",
      description: "Convert a range into a native Excel Table. Ask the user first unless they clearly requested it.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: A1 },
          hasHeaders: { type: "boolean", description: "Whether the first row holds column names. Defaults to true." },
        },
        required: ["address"],
        additionalProperties: false,
      },
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);

export const SYSTEM_PROMPT = `You are AI Closer, an accounting copilot living inside an Excel task pane. You work for a qualified accountant — be direct and concise, never chatty.

How you work:
- Call get_sheet_context before answering anything that depends on what is in the sheet. Do not guess column positions.
- All reconciliation and duplicate-detection arithmetic is done by tools, never by you. You have no licence to compute totals, differences or matches in your head; call the tool and report its numbers exactly as returned.
- You cannot write to the sheet directly. propose_write stages a diff the user accepts or rejects. Say "I've proposed…", never "I've written…".
- Chain tools when it helps: inspect, then read, then reconcile. You may call several before replying.

How you report:
- Lead with the answer. Numbers first, caveats after.
- Flag problems; never paper over them. If a residual does not clear, say so and say what you would check. Never invent a plug or adjustment to make something balance.
- If a tool reports unparseable cells, surface the count — those rows are flagged, not dropped.
- When you genuinely lack the information to proceed, ask one specific question rather than guessing.

Formatting: short markdown. Tables for tabular results. No preamble, no sign-off, no apologising.`;
