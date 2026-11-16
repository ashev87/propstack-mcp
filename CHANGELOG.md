# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **`delete_image`** — permanently deletes an image or floor plan. Destructive
  and irreversible; the tool description says so (#13).
- **`update_image`** can now set an image's `position` and mark it as a floor
  plan with `is_floorplan` (#13).
- **`list_inbound_emails`** — lists received emails, filterable by contact,
  property, project and broker. Returns subject, date and linked IDs only; no
  addresses, names or email text (#13).
- **`get_email`** — reads one email by activity ID, with an optional `fields`
  whitelist. The body is returned as plain text and capped in length (#13).
- Optional **`PROPSTACK_API_KEY_V2`** environment variable.

### Notes
- `delete_image` and the `position` / `is_floorplan` options use the Propstack
  **API V2 (beta)**, because the V1 API does not document them. They use
  `PROPSTACK_API_KEY_V2` if set and `PROPSTACK_API_KEY` otherwise. All other
  tools, including title and visibility updates in `update_image`, stay on V1.
- Emails are read through the documented V1 activity endpoints
  (`GET /activities?item_type=message`, `GET /activities/:id`). Propstack
  documents no inbound-only filter, so `list_inbound_emails` drops sent emails
  after fetching each page; a page can hold fewer results than requested.

## [1.2.0] — 2026-10-15

### Added
- **German residential property fields** on `create_property` / `update_property`,
  shown in `get_property`: energy certificate (GEG: availability, rating type,
  efficiency class, thermal characteristics, validity dates, heating type,
  energy carrier), equipment (lift, cellar, balcony, garden, terrace, built-in
  kitchen, guest toilet, barrier-free, listed building), layout and condition,
  costs (Hausgeld/service charge, heating costs, deposit, parking), areas,
  `free_from`, `rented` and the long portal texts. Previously these fields were
  silently dropped by the server (#2, #3, #8). They are also accepted by the
  `fields` parameter of `search_properties`.
- **Image tools:** `list_property_images`, `upload_image`, `update_image`.
- **`match_properties_to_contact`** — reverse matching: which listings fit a
  contact's search profiles.

### Changed
- Matching now scores the profile's feature flags (balcony, lift, garden,
  built-in kitchen, cellar, rented). The tool description already promised this;
  the scoring is now shared by both matching tools.
- Propstack API failures are returned as MCP tool errors (`isError: true`), so
  clients can tell a failed call from a successful one (#9).
- README: ChatGPT / claude.ai section now states that these clients need a
  remote HTTPS server, with a warning against exposing the server unauthenticated.

## [1.1.0] — 2026-06-30

### Added
- **`fields` parameter (data minimization, Art. 25 DSGVO)** on `search_contacts`,
  `search_properties`, `search_deals`, and `full_contact_360`. When supplied, only
  the requested fields are returned (validated per entity; unknown names produce a
  clear error). Omitting it leaves the default output unchanged.
- **`custom_filters` parameter** on `search_contacts` and `search_properties` for
  filtering by agency-specific custom fields (maps to `cf_<name>` query params).
  This implements filtering that was previously documented but not wired up.
- **Data Protection (DSGVO) section** in the README (controller responsibility,
  LLM processing, Art. 22 note for `match_contacts_to_property`, data
  minimization, audit logging) plus an English pointer.
- **Per-request timeout** (30s, `AbortSignal`) in the HTTP client, with retry and
  a timeout-aware error message.
- **Test suite** (Vitest) covering the pure helper functions.

### Changed
- The server version reported to MCP clients is now read from `package.json`
  instead of a hardcoded value (was stale at `0.1.0`).
- Corrected the `repository`, `homepage`, and `bugs` URLs in `package.json`.

### Removed
- **`export_data`** — the bulk table-dump tool was removed. Dumping an entire
  table of raw records into an LLM context window has no practical use (it is
  expensive, exceeds the context window, and the model cannot act on thousands of
  unstructured rows). Full-portfolio scanning, when added, will use server-side
  aggregation tools (see `docs/v2-integration-plan.md`) that return computed
  summaries rather than raw dumps.
  > If you relied on `export_data`, use the Propstack API directly or the
  > forthcoming V2-backed reporting tools instead.

## [1.0.2]

- Initial published release: 49+ tools across contacts, properties, deals,
  search profiles, tasks, activities, email, documents, relationships, lookups,
  smart composites, and admin.
