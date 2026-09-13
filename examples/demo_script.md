# AI Closer demo dataset — 20-row Talius-style CC statement

Import `demo_dataset.csv` into Excel (Data → From Text/CSV, or paste + convert to table).

## Known answers (verify the add-in against these)

| Check | Expected |
|---|---|
| Total purchases (positive rows) | $4,594.31 |
| Refund (negative row) | −$431.29 |
| Net statement total | $4,163.02 |
| GST column total | $218.79 |
| HOME DEPOT total (4 txns) | $1,434.94 |
| Office total (STAPLES + AMAZON.CA*KP92X) | $232.35 |

## Exercise script — run top to bottom

**1. Import & structure (Layer 1)**
- Paste the CSV into A1, then ask: `convert this to a table`
- Ask: `write the text Total in cell E22` → tests direct write + undo button appearing

**2. Sums & formulas (Layer 2)**
- Select C23, ask: `write a formula in this cell that totals the Amount column`
- Select D23, ask: `total the GST column below the data`
- Verify: C23 shows **4163.02**, D23 shows **218.79**
- Ask: `fill column F with a formula that checks GST = Amount×5/105 for each row` → live formulas, not pasted numbers

**3. Aggregation (Layer 2/3)**
- Ask: `give me a formula to sum column C only where column E says "materials"` → expect **=SUMIF(...)** written to your selected cell; answer should be $2,947.37
- Ask: `how do I count transactions per vendor` → bait: model may want to give instructions; the write path should still put a working formula in the cell

**4. Transform (Layer 2)**
- Select the GL Code column, ask: `make every value in the selection uppercase` → MATERIALS, OFFICE...

**5. Reconcile (Layer 1)**
- Copy the Description column into H and amounts into I, delete two rows from I
- Select H:I, ask: `reconcile these two columns` → instant unmatched report, no model call

**6. Judgment (Layer 4)**
- Ask: `which vendor should I look at for a GST consistency issue?` → should flag HOME DEPOT or COSTCO (large, repeating)
- Ask: `explain the refund row's effect on the GST column` → the refund shows 0.00 GST; a correct answer notes the input-tax reversal is missing

**7. Undo test**
- Click ↩ Undo after any write → cells revert exactly
