# Propstack API V2 Integration Plan

Status: **draft / planning**. Researched against the live V2 OpenAPI spec
(`https://api.propstack.de/v2/swagger_doc`) on 2026-06-30. V2 is officially
**Beta** (`info.version: "0.1"`, title "Propstack API v2 Beta"), so treat the
surface below as subject to change and verify against a real V2 key before
building.

---

## 1. Verified V2 surface

- **Base URL:** `https://api.propstack.de/v2`
- **Auth:** `X-Api-Key` header (API-key security scheme). Our V1 client already
  sends `X-API-KEY`; HTTP headers are case-insensitive so the same mechanism
  works, but Propstack supports **separate V1/V2 keys**, so we expose a distinct
  `PROPSTACK_API_KEY_V2` (falling back to the V1 key).
- **55 paths total.** The relevant ones:

### Scroll endpoints (the whole reason to use V2) — 4 of them
| V2 endpoint | Returns | V1 equivalent |
|---|---|---|
| `GET /clients/scroll` | contacts | `/contacts` |
| `GET /properties/scroll` | properties (units) | `/units` |
| `GET /client_properties/scroll` | deals | `/client_properties` |
| `GET /activities/scroll` | activity feed | `/activities` |

> **Naming differs from V1:** V2 calls units `properties` and contacts `clients`.
> Deals stay `client_properties`.

### Scroll mechanics (confirmed from the spec)
- **Params:** `per` (default 10, **max 1000**), `scroll_id`, `with_total`
  (bool), `updated_at_from` / `updated_at_to` (date). `/clients/scroll` also
  takes `fields` and `include_children`.
- **Response shape:** `{ data: [...], total?: number, scroll_id: string }`.
- **Loop:** first call without `scroll_id`; each response returns a new
  `scroll_id`; pass it to the next call; stop when `data` is empty. `with_total=1`
  on the first call gives the count for progress reporting.

### Native `fields` param — synergy with our DSGVO work
`/clients/scroll` (and `/clients` list) accept a server-side, **enum-validated**
`fields` whitelist (≈90 known client fields incl. `gdpr_status`,
`accept_contact`, `keep_data_till`, `cp_delete_request_date`). For V2-backed
tools we can pass `fields` straight through and let the API enforce minimization —
the same Art. 25 story we built for V1, but native.

> Spec quirk to verify: `fields` is declared `in: formData` on a GET. Almost
> certainly a comma-separated **query** param in practice — confirm at impl time.

### V2-only resources worth tools later
- **`GET /clients/deleted`, `GET /properties/deleted`** (params
  `deleted_at_from/to`) — deletion audit. Directly supports the DSGVO theme
  (proving Art. 17 erasure happened).
- **`GET /history/{deals,events,messages,notes,tasks}/{id}`** — per-record
  **change history / audit trail**. This is a genuinely new capability with no
  V1 equivalent and is the natural home for "who changed what when."
- Also present: `comments`, `folders`, `portals`, `publishings`, `recipes`,
  `rights`, `message_trackings`, `snippets`.

### Gaps / constraints
- **No `saved_queries` / search-profile endpoint in V2.** So
  `match_contacts_to_property` must keep reading profiles from **V1**; only the
  property/contact scans can move to V2.
- Some `/v2/*` paths 302-redirect to `/app` when unauthenticated — expected;
  they resolve with a valid key. `/v2/projects` and `/v2/brokers` return 401
  unauth (exist, smaller sets, **no scroll** — keep on V1 or paginate normally).

---

## 2. Design principle (carry over from `export_data` removal)

V2 lets the **server** scan an entire account cheaply. The **LLM** must still
only ever receive a **computed summary** — counts, totals, funnels, a small
sample — never the raw scrolled records. Every tool below returns an aggregate.
If a tool would dump rows, it doesn't ship.

---

## 3. Foundation (build first)

`src/propstack-v2-client.ts`:
- `PropstackV2Client` (base `…/v2`, `X-Api-Key`, reuse the V1 retry/timeout
  logic — consider extracting the shared `request()` core).
- `async *scrollAll(endpoint, params)` generator that loops `scroll_id` until
  `data` is empty, yielding records (or pages). Caller aggregates; nothing is
  buffered wholesale beyond what a tool needs.
- Config: `PROPSTACK_API_KEY_V2` env (fallback to `PROPSTACK_API_KEY`).
- **Graceful disable:** if no key works against V2, the V2 tools are not
  registered (or return a clear "V2 not configured" message) so the V1 server
  is unaffected.

---

## 4. Tools — phased

### Phase 1 (highest value, on-theme)
1. **`portfolio_overview`** — scroll `/properties/scroll`; aggregate count &
   total value by status / type / broker, avg days on market, % reserved/sold.
2. **`gdpr_consent_report`** — scroll `/clients/scroll` with
   `fields=id,gdpr_status,accept_contact,newsletter,keep_data_till,cp_delete_request_date`;
   summarize consent posture across the whole base. Optionally fold in
   `/clients/deleted` for an erasure log. Controller-facing; extends the
   Datenschutz section.
3. **Upgrade existing capped composites** to scroll where possible:
   - `pipeline_summary` → `/client_properties/scroll` (drops the 2000 cap).
   - `match_contacts_to_property` → properties via V2 if useful, but **profiles
     stay V1** (no V2 endpoint).

### Phase 2
4. **`data_quality_audit`** — properties missing price/broker/images; deals with
   no stage; contacts with no source. Returns counts + a small sample.
5. **`stale_listings_report`** — every property on market > N days (full scan).
6. **`duplicate_contacts`** — scroll `/clients/scroll`, group by normalized
   email/phone/name.
7. **`conversion_funnel`** — scroll `/client_properties/scroll`; stage-to-stage
   drop-off, win/loss, sliced by source/broker over a date range.
8. **`record_history`** — wrap `/history/{type}/{id}`; "show the change history
   for deal/contact/property X." New capability; supports the audit-logging
   theme.
9. **`deleted_records_report`** — `/clients/deleted` + `/properties/deleted`
   over a date window. GDPR erasure evidence.

---

## 5. Risks / open questions (resolve in Step 0)

- **Beta surface (v0.1)** — schemas/fields may shift; pin to what we verify.
- **Key compatibility** — confirm whether the V1 key works against V2 or a
  dedicated V2 key is required (test the 401 endpoints with a real key).
- **`fields` transport** — confirm query vs formData on the GET scroll routes.
- **Scroll termination** — confirm "empty `data`" is the stop signal (vs. a
  stable/empty `scroll_id`).
- **Rate limits** — full scans = many calls; reuse V1 backoff and cap with a
  `with_total`-driven progress + a sane hard ceiling per tool.

## 6. Step 0 — verification spike (needs a real V2 key)
1. Generate a V2 key in Propstack admin; confirm `GET /v2/properties/scroll?per=1`
   returns `{ data, scroll_id }` with `X-Api-Key`.
2. Confirm the `fields` whitelist behavior and the scroll loop over 2-3 pages.
3. Hit one `/history/...` and `/clients/deleted` to confirm shape.
4. Then implement the foundation + `portfolio_overview` as the first real tool.
