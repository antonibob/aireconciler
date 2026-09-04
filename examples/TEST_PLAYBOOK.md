# AI Closer — Test Playbook

Verify the add-in works end-to-end. Each test has a **prompt**, **how to set it up**, and the **expected result**. Do them in order.

> Setup: server running (`npm run serve`), Excel open, **AI Closer** taskpane loaded, API key set in ⚙ (model `deepseek/deepseek-v4-flash-0731`).

---

## Test 1 — Paste a table → analyze it (no Excel selection needed)

1. Copy the whole `examples/datasets/ap_invoices.csv` (including header row).
2. Paste it into the chat. Keep the cursor on the last line, then add:

   ```
   → Sum the amounts by vendor and tell me the total. Flag any invoice with no PO.
   ```
   *(just start a new line after the pasted table with that prompt)*

3. **Expected:** a `📋 pasted table` badge appears on your message; AI Closer replies with a vendor-by-vendor sum and the total (~$54,200). It does **not** write to the sheet.

---

## Test 2 — Formula into a selected cell (writes directly)

1. In an empty sheet, type a small data block: A1=10, A2=20, A3=30, A4=40.
2. **Select cell A5.** In AI Closer type:

   ```
   put =SUM(A1:A4) in the selected cell
   ```

3. **Expected:** it writes `=SUM(A1:A4)` into **A5** and reports a read-back like `✓ Wrote to your selected cell. (read-back: "=SUM(A1:A4)")`. **A5 now shows 100.** An amber **↩ Undo last change** button appears.

> This proves direct-write + formula preservation + verification.

---

## Test 3 — Compute a column into a selection (multi-cell apply)

1. In a sheet put:
   - A1:a, B1=10, C1=2
   - A2:b, B2=20, C2=4
   - A3:c, B3=30, C3=6
2. **Select D1:D3** (the empty column). Type:

   ```
   for each row, compute B*C into this column
   ```

3. **Expected:** AI Closer writes `20, 80, 180` into **D1:D3** as live formulas (`=B1*C1`, etc.), reads back, and shows the verify line.

---

## Test 4 — Explain a formula (reads formulas, not values)

1. In a sheet put A1=5, B1=7, and **C1 = =A1*B1**.
2. **Select C1** and type:

   ```
   explain what this cell does and what result it gives
   ```

3. **Expected:** the reply references the *formula* `=A1*B1` (=35), not a bare number. This proves it reads formulas.

---

## Test 5 — Undo a direct write

1. After Test 2 or 3, click the amber **↩ Undo last change** button in the input bar.
2. **Expected:** it reverts the cells to their prior values/formulas and posts "↩ Reverted the last change."

---

## Test 6 — Credit-card flagging (domain reasoning)

1. Paste `examples/datasets/credit_card.csv` into the chat, then add:

   ```
   which cardholders have transactions this month? What looks odd?
   ```

2. **Expected:**
   - Correctly names cardholders (Cal=0807, Frank=3474/7878, Greg=9494/9583, Rares=2169).
   - Flags at least: the `EXPEDIA REFUND` (a credit, -129), the `$0.00 TD CANADA TRUST` payment row, the `MYSTERY CHARGE DUBLIN`, the USD `ANTHROPIC` line. Doesn't invent a total that ignores the refund.

---

## Test 7 — Product-costing help (domain reasoning)

1. Paste `examples/datasets/product_costing.csv`, then add:

   ```
   total material cost per unit if each shade uses all listed components once? Show your calc.
   ```

2. **Expected:** a reasoned per-unit total; distinguishes FX (`unit_cost_is_fx=1`) vs the rest in the running total (it won't silently add FX at 1:1 without noting it — that's the honest behavior).

---

## Not expected to work yet (known limits)

- **Reading actual `.xlsx` files from disk** — sandboxed; paste CSV or select a range instead.
- **Multi-sheet model calls** (the agent tool-loop) — not built.
- If a **write fails**, AI Closer reports the error rather than claiming success — that's by design.

---

## If something breaks

Tell me 3 things: the **test number**, the **exact prompt**, and the **reply you got**. If it wrote a wrong value, tell me the cell + what landed. I'll fix the specific path.