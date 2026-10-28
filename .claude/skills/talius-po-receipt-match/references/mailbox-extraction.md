# Reading invoices out of the payables mailbox

Mailbox: `payables@talius.com` (a shared mailbox, not the user's own).
Access is **read-only** (`Mail.Read`). You cannot send, draft, reply to, or move
mail — so when the user wants an email moved or a vendor contacted, give them the
text or the list and let them act.

## Call shapes that work

`mailboxOwnerEmail` is mandatory on every search. Without it the search silently
runs against the personal mailbox and returns plausible-looking but wrong
results — and message IDs taken from one mailbox fail when read against the other.

To list a folder:

```
outlook_email_search
  mailboxOwnerEmail: payables@talius.com
  folderName: 1 POs awaiting receipt
  order: newest
  limit: 25          # 25 is the cap
  offset: 0          # then 25, 50 ... while moreResults is true
```

Send **no `query`** with that combination. The filters are refused together in
three cases, and the error does not always make the reason obvious:

- `order: "oldest"` with `query` or `recipient`
- `folderName` with a date filter *and* `query` or `recipient`
- `mailboxOwnerEmail` with any `recipient`, or with `query` plus `sender` or a date

When you need a folder listing, filter by folder and sort; do the narrowing
yourself on the results. The response's final element carries `nextOffset` and
`totalResultCount` — page until you have them all. **Do not trust the Outlook
folder badge as the item count**; it showed 35 for a folder holding 37.

## Reading an attachment: two steps

1. `read_resource` on `mail:///messages/{id}?owner=payables@talius.com` — returns
   an `attachments` array.
2. `read_resource` on the attachment's `uri` **copied verbatim** from that array.
   It is already URL-encoded; rebuilding it by hand does not work.

Both steps parallelise well. Batch six to twelve reads per turn.

`contentType: application/pdf` extracts to text. **`application/octet-stream`
does not** — it returns "Binary attachment — content cannot be returned inline"
no matter that the file is a PDF. Lakeside Fasteners and Millennium Alloys both
send this way. For those, take the PO from the subject line and leave the amount
NULL rather than guessing.

Invoice numbers are often in the attachment filename (`on-714692.pdf`,
`Inv4274237.pdf`, `QEY0015.pdf`, `INV-141708.PDF`), so you can harvest invoice
numbers from a folder listing without opening anything. The PO number and the
totals almost always need the PDF opened.

## Where the PO number sits, by vendor

Extracted text arrives with the PDF's layout flattened, so labels and values are
often far apart. These are the landmarks that actually locate the value.

| Vendor | PO location | Notes |
|---|---|---|
| **Endura** | the field after the buyer code `00421` | invoice no is in the filename; subtotal + GST printed |
| **BC Fasteners** | labelled `PO Number`, near `Net Due Date` | clean header, terms Net 30 |
| **Richelieu** / Hi-Tech Glazing | `CUSTOMER ORDER NO.` — the bare number in the run `1012-5568  <INV>  1  <PO>  1482-4176  N 30` | bilingual layout; totals at the end as `$net $gst $total` |
| **Uline** | `PURCHASE ORDER NO.`, second field after customer no `10167755` | carries PST as well as GST, plus a taxed freight line |
| **Trivantage** | `Customer PO No`, as `PO260699` | USD, no tax |
| **Memtech** | `P.O. Number` | USD, no tax, freight collect |
| **Canevas LaSalle** | `N° bon de com. / Pur. Order No.` | bilingual; carries GST **and** PST |
| **Lakeside Fasteners** | subject line: `Cust PO#: 260720` | PDF unreadable; amount unavailable |
| **Millennium Alloys** | subject line: `Please Find Invoice For Your PO 260638` | PDF unreadable; amount unavailable |
| **Crown Packaging** | none — `C.P. ORDER NO.` is *their* order, not a Talius PO | often pallet-return credits |
| **McMaster-Carr** | `Purchase Order 1022CJOHNSON` is a **credit-card reference**, not a Seradex PO | USD; code to card clearing |

PO numbers print inconsistently: bare (`260645`), prefixed (`PO260669`), or
mistyped (`PO2060647`, which is `PO260647` with a stray digit). Seradex stores
them as `PO` + six digits. Normalise in SQL, and when a PO is "not found",
suspect a typo before concluding it does not exist.

## Vendor name aliases in Seradex

The name on the invoice is frequently not the name on the vendor record:

| On the invoice | In Seradex |
|---|---|
| Richelieu Hardware | `Hi-Tech Glazing Supplies` |
| Bunzl | `GF Inc` |
| Welser | `AVZ` |
| Crown Packaging | `Crown Corrugate Company V55000` |
| Muir Tapes | `Graham Muir Sales Inc.` |
| Millennium Alloys | `Millennium Specialty Alloys Lt` (truncated) |

Match on `Name LIKE` fragments, never on the invoice's letterhead. **BC Fasteners
is split across four vendor records**, and **Cooper Equipment has no vendor record
at all** — only a person, "Kerry Cooper".

## Two standing security facts

- A **bank-detail-change request from McClary Swift** (Sep 4) is unverified.
  Confirm only by phoning **360-332-4552 from Talius's own records** — never a
  number in the email. Do not act on it from here.
- Endura invoices carry "No payment changes will ever be made without verbal
  confirmation." Treat any emailed remittance change for them the same way.
