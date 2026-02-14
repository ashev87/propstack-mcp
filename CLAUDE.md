# Propstack MCP Server — Complete Architecture

## Deep API Audit & Comprehensive Tool Design

Based on full analysis of all 27 API V1 endpoints + V2 scroll endpoints at docs.propstack.de.

---

## Table of Contents

1. API Surface Summary
2. Complete MCP Tool Map (47 tools)
3. Makler Workflow Coverage
4. Tool Design Principles
5. Smart Composite Tools (what makes this MCP "very good")
6. Technical Implementation Details
7. Build Sequence

---

## 1. API Surface Summary

### V1 Endpoints Audited (27 total)

| # | Resource (DE) | Endpoint Base | CRUD | Key Insight |
|---|--------------|---------------|------|-------------|
| 1 | **Kontakte** | `/v1/contacts` | Full | Upsert by email, phone search, GDPR fields, sub-contacts, group management (add/sub/rewrite), custom fields via `partial_custom_fields` |
| 2 | **Favoriten** | `/v1/contacts/:id/favorites` | Read | Contact's favorited properties |
| 3 | **Objekte** | `/v1/units` | Full | 20+ sort options, 12 range filters, `?new=1` for extra fields, multilingual texts (`locale=en`), `?expand=1` for custom fields, `?with_meta=1` for total count |
| 4 | **Bilder** | `/v1/units/:id/images` | CRUD | Property images, floorplan flag, private flag, position ordering |
| 5 | **Links** | `/v1/units/:id/links` | CRUD | External links on properties (virtual tours, video links etc.) |
| 6 | **Projekte** | `/v1/projects` | Full | "Super-objects" containing multiple units, address, images, floorplans, documents, links, status |
| 7 | **Deals** | `/v1/client_properties` | Full | Contact↔Property relationship with pipeline stage, "feeling" score, cancellation reasons, won/lost tracking |
| 8 | **Deal-Pipelines** | `/v1/deal_pipelines` | Read | Multiple pipelines (Sales, Akquise, Vermietung), stages with position/color/chance% |
| 9 | **Task** | `/v1/tasks` | CRU | Polymorphic: note, aufgabe (reminder), termin (event), brief, SMS, absage, anfrage. Central write endpoint for activities |
| 10 | **Aufgaben** | `/v1/tasks/:id` | Read | Read single task with associations (clients, units, projects, viewings) |
| 11 | **Termine** | `/v1/events` | Read | Calendar events with state (neutral/took_place/cancelled), recurring filter, group/tag filter |
| 12 | **Aktivitäten** | `/v1/activities` | Read | Activity feed — container for all task types. Filter by type (message, note, reminder, event, policy, cancelation, decision, sms, letter), broker, contact, property, project, date |
| 13 | **E-Mails** | `/v1/messages` | Send+Update | Send via snippet/template, update read/archive/category/links. Full email object with from/to/cc/bcc, attachments |
| 14 | **Suchprofile** | `/v1/saved_queries` | Full | Buyer search criteria: cities, regions, radius (lat/lng/meters), price/rent ranges, rooms, property types, features (lift, balcony, garden, kitchen, cellar, rented), investment criteria |
| 15 | **Dokumente** | `/v1/documents` | Full | File upload (base64), belongs to property/project/contact, tags, is_floorplan, is_private, is_exposee, on_landing_page |
| 16 | **Notizen** | `/v1/notes` | Read | Simple notes with tag filter |
| 17 | **Custom Felder** | `/v1/custom_field_groups` | Read | Field definitions per entity (clients, properties, projects, brokers, tasks, deals). Types: String, Dropdown, etc. Filter objects with `cf_` prefix |
| 18 | **Merkmale** | `/v1/groups` | CR | Tags/labels — hierarchical (Obermerkmale). Per entity: for_clients, for_properties, for_activities |
| 19 | **Beziehungen** | `/v1/ownerships` + `/v1/partnerships` | CD | Owner/Partner links between contacts and properties |
| 20 | **Nutzer** | `/v1/brokers` | Read | Team members with name, email, phone, position, avatar, color, team, departments |
| 21 | **Teams/Abteilungen** | `/v1/teams` | Read | Departments with broker assignments, logo |
| 22 | **Geolagen** | `/v1/locations` | Read | Geographic areas/districts for property/search profile matching |
| 23 | **Kontakt-Quellen** | `/v1/contact_sources` | Read | Lead sources (ImmoScout24, etc.) |
| 24 | **Policy** | `/v1/policies` | Read | GDPR consent/disclosure records (Widerrufsbelehrung, Kontakterlaubnis) |
| 25 | **Portal-Export** | `/v1/portal_exports` | Read | Portal listing status |
| 26 | **Webhooks** | `/v1/hooks` | Full | Events: CLIENT_CREATED, CLIENT_UPDATED, PROPERTY_UPDATED, etc. HMAC verification. `changed_attributes` on updates |
| 27 | **Datendump** | `/v1/datadump/:table` | Read | Bulk export — all tables: appointments, brokers, cancelations, commission_splits, contacts, deal_pipelines, deals, departments, documents, images, messages, notes, policies, projects, properties, property_details, relationships, saved_queries, teams, todos + lookup tables (groups, contact_sources, contact_reasons, contact_statuses, reservation_reasons, property_statuses) |

### V2 API (`api.propstack.de/v2`)

- Still in development, not all V1 endpoints mirrored
- Key advantage: **Scroll endpoints** for efficient bulk data retrieval (cursor-based pagination)
- Use V2 for: large data exports, full-portfolio scans, bulk reporting
- Use V1 for: everything else (more complete, better documented)
- Separate API keys can be created for V1 and V2

### Key Discovery: The Task Endpoint is the Write Hub

Propstack's Task endpoint (`POST /v1/tasks`) is **polymorphic** — it creates ALL activity types:

| Set this flag | Creates |
|--------------|---------|
| *(nothing)* | Note/Notiz |
| `is_reminder: true` | Aufgabe (to-do with due date) |
| `is_event: true` | Termin (calendar event with start/end) |
| `reservation_reason_id` present | Absage (deal cancellation) |
| — | Brief, SMS, Anfrage (by note_type_id) |

This means a single `create_task` MCP tool with smart parameter handling covers notes, tasks, appointments, and cancellations.

---

## 2. Complete MCP Tool Map (47 Tools)

### TIER 1 — Daily Operations (18 tools, MVP)

These are the tools a Makler would use every single day.

#### Contacts (Kontakte) — 7 tools

```
search_contacts
  → GET /v1/contacts
  → Params: q (fulltext: name/email/address/phone), phone_number, email,
            broker_id, status[], sources[], group[] (tag IDs), not_in_group[],
            gdpr_status, newsletter, accept_contact, owner, archived,
            language[], home_countries[], project_ids[],
            created_at_from/to, updated_at_from/to,
            sort_by (last_contact_at|created_at|updated_at|first_name|last_name),
            order (asc|desc), expand, include_children, page, per_page
  → WHY: Most-used tool. Makler asks "show me all new leads this week" or 
         "find Herr Müller" or "who hasn't been contacted in 30 days?"

get_contact
  → GET /v1/contacts/:id
  → Params: include (children, documents, relationships, owned_properties)
  → WHY: Deep view of one contact with all relations

create_contact
  → POST /v1/contacts
  → Body: { client: { first_name, last_name, email, phone, salutation (mr/ms),
            company, position, description, broker_id, client_source_id,
            client_status_id, language, rating (0-3), newsletter, accept_contact,
            home_street/house_number/zip_code/city/country,
            office_street/house_number/zip_code/city/country,
            partial_custom_fields: {}, group_ids: [] } }
  → Auto-upserts if email or old_crm_id matches existing contact
  → WHY: Voice agent creates contact after call. Web form creates lead.

update_contact
  → PUT /v1/contacts/:id
  → Body: same as create + group management:
          group_ids: [1,2,3] → replaces ALL tags
          add_group_ids: [5] → adds tags
          sub_group_ids: [1] → removes tags
  → Also supports identifier=token for external ID lookup
  → WHY: Update status after call, add tags, change broker assignment

delete_contact
  → DELETE /v1/contacts/:id
  → Soft delete (30-day recycle bin)
  → WHY: GDPR deletion requests

get_contact_sources
  → GET /v1/contact_sources
  → Returns [{id, name}] (e.g. "Immobilienscout 24", "Website", "Empfehlung")
  → WHY: Needed to set correct source when creating contacts. AI needs to know 
         valid source IDs.

get_contact_statuses
  → (via datadump or custom lookup)
  → WHY: Needed to filter/set contact status
```

#### Properties (Objekte) — 5 tools

```
search_properties
  → GET /v1/units?with_meta=1
  → Params: q (fulltext: unit_id/street/zip/city/district/exposee_id),
            status (comma-separated IDs), marketing_type (BUY|RENT),
            rs_type (APARTMENT|HOUSE|OFFICE|...11 types),
            object_type (LIVING|COMMERCIAL|INVESTMENT),
            country, project_id, group (tag ID), archived,
            property_ids[], include_variants, exact,
            — Range filters (all support _from/_to):
            price, base_rent, total_rent, property_space_value,
            living_space, plot_area, number_of_rooms, number_of_bed_rooms,
            number_of_bath_rooms, floor, construction_year,
            — Custom field filter: cf_my_field=value
            — Sorting: sort_by (exposee_id|construction_year|unit_id.raw|floor|
              created_at|property_space_value|plot_area|base_rent|price|
              object_price|price_per_sqm|property_status_position|
              street_number.raw|sold_date|total_rent|number_of_rooms|updated_at),
            order (asc|desc), expand, page, per_page
  → WHY: "Which apartments between 300k-400k in Berlin are still available?"
         "Show me all properties listed 90+ days" "What's unsold in Project X?"

get_property
  → GET /v1/units/:id?new=1&expand=1
  → Returns: full property with custom_fields, images[], floorplans[], 
             documents[], links[], broker, project, property_groups[], status
  → Param: include_translations=en,de for multilingual texts
  → WHY: Full property detail for exposé preparation or client inquiry

create_property
  → POST /v1/units
  → Body: { property: { title, marketing_type, object_type, rs_type, rs_category,
            street, house_number, zip_code, city, country, lat, lng,
            price, base_rent, total_rent, living_space, plot_area,
            number_of_rooms, number_of_bed_rooms, number_of_bath_rooms,
            floor, construction_year, description_note, location_note,
            furnishing_note, other_note, courtage, courtage_note,
            broker_id, project_id, partial_custom_fields: {},
            relationships_attributes: [{internal_name: "owner", related_client_id: 123}] } }
  → WHY: Create new listing from acquisition call or owner inquiry

update_property
  → PUT /v1/units/:id
  → Same body as create
  → WHY: Update price, status, description, assign broker

get_property_statuses
  → GET /v1/property_statuses
  → Returns [{id, name, position, color, nonpublic}] 
    (e.g. "Verfügbar", "Reserviert", "Verkauft")
  → WHY: AI needs valid status IDs to filter or update properties
```

#### Tasks — The Activity Write Hub — 3 tools

```
create_task
  → POST /v1/tasks
  → Smart tool that handles 4 activity types via flags:

  MODE 1 — Note:
  { task: { title, body (HTML), note_type_id, client_ids[], property_ids[], 
            project_ids[], broker_id } }

  MODE 2 — To-do/Aufgabe:
  { task: { is_reminder: true, title, due_date, remind_at, done: false,
            note_type_id, client_ids[], property_ids[], broker_id } }

  MODE 3 — Appointment/Termin:
  { task: { is_event: true, title, starts_at, ends_at, location,
            all_day, private, recurring, rrule,
            note_type_id, client_ids[], property_ids[], broker_id } }

  MODE 4 — Cancellation/Absage:
  { task: { title: "Absage", reservation_reason_id, 
            client_ids[], property_ids[], body } }

  → WHY: Central command for "log a call note", "remind me to call back tomorrow",
         "schedule viewing at Musterstr 12 at 3pm", "cancel deal with reason"

update_task
  → PUT /v1/tasks/:id
  → Same body as create (mark done, reschedule, add notes)
  → WHY: "Mark that task as done" "Move the viewing to Thursday"

get_task
  → GET /v1/tasks/:id
  → include: clients,units,projects,viewings
  → WHY: Get full context of a specific activity
```

#### Deals — 3 tools

```
search_deals
  → GET /v1/client_properties
  → Params: client_id, property_id, project_id, broker_id,
            deal_stage_ids[], deal_pipeline_id, category (qualified|unqualified|lost),
            reservation_reason_ids[], client_source_id, team_id,
            property_broker_ids[], client_broker_ids[],
            feeling_from/to, created_at_from/to, start_date_from/to,
            show_archived_clients, hide_archived_properties,
            include (client,property), sort_by, order, page, per_page
  → WHY: "Show me all deals in the Reserviert stage" 
         "Which deals did we lose this month and why?"
         "What's in the pipeline for Projekt X?"

create_deal
  → POST /v1/client_properties
  → Body: { client_property: { client_id, property_id, deal_stage_id,
            broker_id, price, note, date } }
  → WHY: After viewing, move contact into deal pipeline

update_deal
  → PUT /v1/client_properties/:id
  → Body: same + deal_stage_id to move through pipeline
  → WHY: "Move deal to Notartermin stage" "Update expected price"
```

### TIER 2 — Weekly Operations (14 tools)

#### Search Profiles (Suchprofile) — 4 tools

```
search_profiles_list
  → GET /v1/saved_queries
  → Params: client (contact ID), page, per_page
  → WHY: "What is this buyer looking for?" "Show all active search profiles"

create_search_profile
  → POST /v1/saved_queries
  → Body: { saved_query: { client_id, active: true, marketing_type (BUY|RENT),
            cities[], regions[], lat, lng, radius (meters),
            rs_types[], rs_categories[],
            price/_to, base_rent/_to, total_rent/_to,
            living_space/_to, plot_area/_to,
            number_of_rooms/_to, number_of_bed_rooms/_to, 
            floor/_to, construction_year/_to,
            lift, balcony, garden, built_in_kitchen, cellar, rented,
            — Investment fields:
            price_per_sqm/_to, price_multiplier/_to, yield_actual/_to,
            note, group_ids[], location_ids[] } }
  → WHY: "Create search profile for Herr Weber: 3-room apartment in Berlin, 
         300-400k, with balcony" — This is THE killer feature. AI understands 
         natural language criteria and maps to structured search profile.

update_search_profile
  → PUT /v1/saved_queries/:id
  → WHY: "Expand budget to 450k" "Add Potsdam to the search"

delete_search_profile
  → DELETE /v1/saved_queries/:id
  → WHY: Contact found a property or no longer searching
```

#### Projects — 2 tools

```
list_projects
  → GET /v1/projects
  → Params: expand
  → WHY: "Show me all active development projects"

get_project
  → GET /v1/projects/:id
  → Returns: full project with images, floorplans, documents, links, units, status
  → WHY: "How is Project Living Home performing?" "How many units are left?"
```

#### Activity Feed — 2 tools

```
search_activities
  → GET /v1/activities
  → Params: type (message|note|reminder|event|policy|cancelation|decision|sms|letter),
            broker_id, client_id, property_id, project_id,
            sort_by, order (asc|desc), page, per (default 20)
  → WHY: "Show me all activity on this contact" "What happened with this property 
         this week?" — The full activity timeline.

list_events
  → GET /v1/events
  → Params: recurring, state (neutral|took_place|cancelled), group_id,
            starts_at_from/to, broker_id
  → WHY: "What viewings are scheduled this week?" "Show cancelled appointments"
```

#### E-Mails — 2 tools

```
send_email
  → POST /v1/messages
  → Body: { message: { broker_id, to[], cc[], snippet_id, 
            client_ids[], property_ids[], project_ids[] } }
  → Uses Propstack email templates (snippets) — AI picks the right template
  → WHY: "Send the exposé to Frau Schmidt" "Send follow-up email to all viewers"

update_email
  → PUT /v1/messages/:id
  → Body: { message: { read, archived, message_category_id, 
            client_ids[], property_ids[], project_ids[] } }
  → WHY: "Archive that email" "Link that email to the Friedrichstr property"
```

#### Documents — 2 tools

```
list_documents
  → GET /v1/documents
  → Params: property_id, project_id, client_id, sort, page, per_page
  → Returns: [{id, title, name, url, is_private, is_floorplan, is_exposee, 
              on_landing_page, tags[], broker_id}]
  → WHY: "Show me all documents for this property" "Where's the Grundriss?"

upload_document
  → POST /v1/documents
  → Body: { document: { property_id|project_id|client_id, title, 
            doc: "data:image/png;base64,...", 
            is_private, is_floorplan, is_exposee, on_landing_page } }
  → WHY: "Upload this floor plan to the property"
```

#### Relationships — 2 tools

```
create_ownership
  → POST /v1/ownerships
  → Body: { client_id, property_id }
  → WHY: "Set Herr Müller as owner of Hauptstraße 12"

create_partnership
  → POST /v1/partnerships
  → Body: { client_id, property_id, name (e.g. "Käufer") }
  → WHY: "Link the buyer to the property"
```

### TIER 3 — Configuration & Lookup (10 tools)

```
list_pipelines
  → GET /v1/deal_pipelines
  → Returns: pipelines with stages [{id, name, position, color, chance}]
  → WHY: AI needs stage IDs to create/move deals

list_tags
  → GET /v1/groups
  → Params: entity (for_clients|for_properties|for_activities)
  → Returns: hierarchical tag tree with Obermerkmale
  → WHY: AI needs tag IDs for filtering and assigning

create_tag
  → POST /v1/groups
  → Body: { entity, name, super_group_id (optional parent) }
  → WHY: "Create new tag 'Penthouse-Käufer' for contacts"

list_custom_fields
  → GET /v1/custom_field_groups
  → Params: entity (for_clients|for_properties|for_projects|for_brokers|
            for_tasks|for_deals)
  → Returns: field groups with field definitions (name, pretty_name, type, options)
  → WHY: Critical — AI must know custom field names to read/write them correctly.
         Without this, custom fields are blind spots.

list_users
  → GET /v1/brokers
  → Returns: [{id, name, email, phone, position, team_id, department_ids}]
  → WHY: AI needs broker IDs for assignment, filtering. "Who handles Charlottenburg?"

list_teams
  → GET /v1/teams
  → Returns: [{id, name, broker_ids}]
  → WHY: Team-level filtering and assignment

list_locations
  → GET /v1/locations (Geolagen/Bezirke)
  → WHY: Location IDs for search profile matching

list_contact_sources
  → GET /v1/contact_sources
  → Returns: [{id, name}] e.g. "ImmoScout24", "Website"
  → WHY: Needed when creating contacts to set correct lead source
```

### TIER 4 — Advanced/Admin (5 tools)

```
manage_webhooks
  → GET/POST/DELETE /v1/hooks
  → Events: CLIENT_CREATED, CLIENT_UPDATED, PROPERTY_UPDATED, etc.
  → WHY: Setup automation triggers. "Notify me when any property status changes"

export_data
  → GET /v1/datadump/:table
  → Tables: appointments, brokers, cancelations, commission_splits, contacts,
            deal_pipelines, deals, departments, documents, images, messages,
            notes, policies, projects, properties, property_details,
            relationships, saved_queries, teams, todos,
            + lookup: groups, contact_sources, contact_reasons, 
              contact_statuses, reservation_reasons, property_statuses
  → WHY: Bulk reporting, backup, migration, analytics

get_portal_export_status
  → GET /v1/portal_exports
  → WHY: "Is the Friedrichstr property live on ImmoScout?"

list_policies
  → GET /v1/policies
  → WHY: GDPR compliance — view consent/disclosure records

get_contact_favorites
  → GET /v1/contacts/:id/favorites  
  → WHY: "Which properties has this contact favorited?"
```

---

## 3. Makler Workflow Coverage

### Morning Routine
| Task | MCP Tools Used |
|------|---------------|
| "What's on my calendar today?" | `list_events` (filter by broker_id, today's date) |
| "Any overdue tasks?" | `search_activities` (type=reminder, filter by due_date < today) |
| "New leads since yesterday?" | `search_contacts` (created_at_from=yesterday, sort=created_at desc) |
| "Pipeline overview" | `search_deals` (deal_pipeline_id, group by stage) |

### Lead Management
| Task | MCP Tools Used |
|------|---------------|
| "Create contact from phone call" | `create_contact` + `create_task` (note with call summary) |
| "What does this caller want?" | `search_contacts` (phone_number) → `search_profiles_list` (client_id) |
| "Rate this lead A+" | `update_contact` (rating: 3) |
| "Tag as VIP buyer" | `update_contact` (add_group_ids) |
| "Set GDPR consent" | `update_contact` (gdpr_status: 2, accept_contact: true) |
| "Archive old lead" | `update_contact` (archived: true) |

### Property Management
| Task | MCP Tools Used |
|------|---------------|
| "New listing from owner call" | `create_contact` (owner) → `create_property` (with relationship) |
| "Update price to 385k" | `update_property` (price: 385000) |
| "Mark as reserved" | `update_property` (status: reserved_id from get_property_statuses) |
| "What's been sitting too long?" | `search_properties` (created_at_to=90 days ago, status=available) |
| "Show me the Grundriss" | `list_documents` (property_id, is_floorplan) |

### Deal Pipeline
| Task | MCP Tools Used |
|------|---------------|
| "Create deal after viewing" | `create_deal` (client_id, property_id, stage=Besichtigt) |
| "Move to Reserviert" | `update_deal` (deal_stage_id) |
| "Lost — too expensive" | `create_task` (absage with reservation_reason_id) |
| "Pipeline value this month?" | `search_deals` (created_at_from, include=property) → sum prices |
| "Win rate by source?" | `search_deals` (category=qualified vs lost) + `search_contacts` |

### Matching (THE Killer Workflow)
| Task | MCP Tools Used |
|------|---------------|
| "Create buyer profile" | `create_search_profile` (from natural language criteria) |
| "Who matches this new listing?" | `search_profiles_list` → compare with property attributes |
| "Send exposé to matches" | `send_email` (snippet_id for exposé template, to matching contacts) |
| "This buyer expanded budget" | `update_search_profile` (price_to: new_amount) |

### Appointments
| Task | MCP Tools Used |
|------|---------------|
| "Schedule viewing Friday 3pm" | `create_task` (is_event, starts_at, location, client_ids, property_ids) |
| "Cancel tomorrow's viewing" | `update_task` (state: cancelled) |
| "Log viewing feedback" | `create_task` (note with body, linked to contact + property) |
| "What viewings this week?" | `list_events` (date range) |

### Voice Agent Integration (Your Unique Angle)
| Event | MCP Tools Used |
|-------|---------------|
| Incoming call → look up caller | `search_contacts` (phone_number) |
| Unknown caller → create lead | `create_contact` + `create_task` (note: call summary) |
| Caller asks about property | `search_properties` (q) → agent reads details |
| After call → assign follow-up | `create_task` (is_reminder, due_date, broker_id) |
| After call → create deal | `create_deal` (client_id, property_id, initial stage) |

---

## 4. Tool Design Principles

### 4.1 Rich Descriptions = Smart AI

Each tool's description is what the AI reads to decide when to use it. Bad descriptions = AI picks wrong tools. Example:

```typescript
// ❌ BAD — too generic
server.tool("search_contacts", "Search contacts", ...)

// ✅ GOOD — teaches the AI when and how to use it
server.tool(
  "search_contacts",
  `Search and filter contacts in Propstack CRM.

Use this tool to:
- Find contacts by name, email, or phone number
- List recent leads (sort by created_at desc)
- Find uncontacted leads (last_contact_at is null)
- Filter by broker assignment, status, tags, or GDPR status
- Search across all contact fields with 'q' parameter

The 'q' parameter searches across: first name, last name, all emails, 
all addresses, and all phone numbers.

Phone search ('phone_number') ignores formatting — both 015712345678 
and 0157-123-456-78 will match.

Returns paginated results. Use expand=true for full details including 
custom fields.`,
  { ... }
)
```

### 4.2 Graceful Enum Exposure

The AI needs to know valid values without looking them up separately. Embed enums in descriptions:

```typescript
marketing_type: z.enum(["BUY", "RENT"]).optional()
  .describe("Filter by marketing type: BUY (Kauf) or RENT (Miete)"),

rs_type: z.enum([
  "APARTMENT", "HOUSE", "TRADE_SITE", "GARAGE", 
  "SHORT_TERM_ACCOMODATION", "OFFICE", "GASTRONOMY", 
  "INDUSTRY", "STORE", "SPECIAL_PURPOSE", "INVESTMENT"
]).optional()
  .describe("Property type filter"),

sort_by: z.enum([
  "created_at", "updated_at", "price", "base_rent", "total_rent",
  "living_space", "plot_area", "number_of_rooms", "floor",
  "construction_year", "sold_date", "property_status_position"
]).optional()
  .describe("Field to sort results by. Default: unit_id"),
```

### 4.3 ID Resolution Strategy

A Makler says "move deal to Reserviert stage", not "move deal to deal_stage_id 34". The AI needs lookup tools to resolve names → IDs.

**Pattern: Auto-bootstrap on first use**

When the server starts, it should cache:
- Property statuses (small, static set)
- Pipeline stages (small, static set)
- Broker list (rarely changes)
- Contact sources (rarely changes)
- Tags/Merkmale (occasionally changes)
- Custom field definitions (occasionally changes)

Expose these as `list_*` lookup tools so the AI can resolve names to IDs.

### 4.4 Custom Field Awareness

This is what separates a "good" MCP from a "very good" one:

```typescript
// The list_custom_fields tool tells the AI what custom fields exist
// Then search_contacts / search_properties accept cf_ filters
// And create/update accept partial_custom_fields

// Example: Agency has custom field "marketing_channel" on contacts
// AI learns this from list_custom_fields, then can:
//   search_contacts with cf_marketing_channel=Lead
//   create_contact with partial_custom_fields: { marketing_channel: "Website" }
```

**The MCP should prompt the AI to call `list_custom_fields` early in the conversation** to learn the agency's specific field setup.

---

## 5. Smart Composite Tools (What Makes This "Very Good")

Beyond 1:1 API mapping, these higher-level tools combine multiple API calls into single workflow actions:

### 5.1 `match_contacts_to_property`
```
Input: property_id
Logic:
  1. GET /v1/units/:id (get property details)
  2. GET /v1/saved_queries (get all active search profiles)
  3. Compare property attributes against each profile's criteria
  4. Return ranked list of matching contacts with match score
Output: [{contact_id, name, match_score, matching_criteria, mismatches}]
```
**Why it's killer:** This is the #1 manual task Makler spend time on. Propstack has matching UI but no AI-powered natural language matching. "Who should I send this new listing to?"

### 5.2 `full_contact_360`
```
Input: contact_id
Logic:
  1. GET /v1/contacts/:id?include=children,documents,relationships,owned_properties
  2. GET /v1/saved_queries?client=:id (search profiles)
  3. GET /v1/client_properties?client_id=:id&include=property (deals)
  4. GET /v1/activities?client_id=:id (recent activity)
Output: Complete contact dossier with properties, deals, search profiles, 
        activity timeline — everything the Makler needs before a call
```
**Why it's killer:** Before calling a client, the Makler asks "tell me everything about Herr Weber" and gets a full briefing in one shot.

### 5.3 `property_performance_report`
```
Input: property_id (or project_id for project-level)
Logic:
  1. GET /v1/units/:id (property details, days on market)
  2. GET /v1/client_properties?property_id=:id (all deals/inquiries)
  3. GET /v1/activities?property_id=:id (viewings, calls, emails)
  4. Calculate: days on market, inquiry count, viewing count, 
     conversion rate, pipeline stage distribution
Output: Performance summary with actionable insights
```
**Why it's killer:** "How is the Friedrichstr property doing?" → instant performance report instead of clicking through 5 screens.

### 5.4 `smart_lead_intake`
```
Input: { name, phone?, email?, interested_in?, source?, notes? }
Logic:
  1. Search existing contacts by phone/email (dedup check)
  2. If exists → update with new info, add note
  3. If new → create contact with source, create note
  4. If interested_in is specified → create search profile
  5. If specific property → create deal at initial stage
  6. Create follow-up reminder for broker
Output: { contact_id, action_taken, search_profile_id?, deal_id?, reminder_id? }
```
**Why it's killer:** Voice agent completes a call → one tool call handles the entire intake workflow that would normally be 4-6 manual steps.

### 5.5 `pipeline_summary`
```
Input: { pipeline_id?, broker_id?, date_range? }
Logic:
  1. GET /v1/deal_pipelines (get stages)
  2. GET /v1/client_properties (filtered, include=client,property)
  3. Aggregate: count by stage, total value by stage, average days in stage,
     win/loss ratio, top deals, stale deals
Output: Pipeline dashboard data
```
**Why it's killer:** "How's the pipeline looking?" → instant management overview.

---

## 6. Technical Implementation Details

### Authentication
```
- Header: X-API-KEY: <user_api_key>
- OR Query param: ?api_key=<user_api_key>
- One key per Propstack account
- Separate V1 and V2 keys possible
- Keys managed at: crm.propstack.de/app/admin/api_keys
- Keys have configurable permissions per endpoint
```

### Pagination
```
- V1: page + per_page (default 25)
  Response: { data: [...], meta: { total_count: N } }
  
- V2: Scroll/cursor-based (more efficient for large datasets)
  Response: { data: [...], next_cursor: "..." }

- MCP tools should expose page/per_page and return total_count 
  so AI can inform user "showing 25 of 847 contacts"
```

### Error Handling
```
- 401: Invalid API key → tell user to check key in Propstack admin
- 403: Insufficient permissions → tell user to check API key permissions
- 404: Resource not found → clear message
- 422: Validation error → return field-level errors
- 429: Rate limited → retry with backoff
```

### Response Formatting for AI
```typescript
// Don't dump raw JSON. Format for AI readability:
function formatContact(contact) {
  return [
    `**${contact.name}** (ID: ${contact.id})`,
    `Email: ${contact.email || 'none'}`,
    `Phone: ${contact.phone || contact.home_cell || 'none'}`,
    `Status: ${contact.client_status?.name || 'none'}`,
    `Broker: ${contact.broker?.name || 'unassigned'}`,
    `Rating: ${'★'.repeat(contact.rating)}${'☆'.repeat(3-contact.rating)}`,
    `Last contact: ${contact.last_contact_at_formatted || 'never'}`,
    `GDPR: ${['Keine Angabe','Ignoriert','Zugestimmt','Widerrufen'][contact.gdpr_status]}`,
    contact.warning_notice ? `⚠️ Warning: ${contact.warning_notice}` : null,
  ].filter(Boolean).join('\n');
}
```

---

## 7. Build Sequence

### Phase 1: Foundation (Day 1-2)
```
□ Project setup: TypeScript, MCP SDK, Zod schemas
□ PropstackClient class (auth, pagination, error handling, retry)
□ TIER 1 tools (18 tools):
  □ Contacts: search, get, create, update, delete, sources, statuses
  □ Properties: search, get, create, update, statuses
  □ Tasks: create (polymorphic), update, get
  □ Deals: search, create, update
□ Test locally with Claude Desktop via stdio
```

### Phase 2: Full Coverage (Day 3-4)
```
□ TIER 2 tools (14 tools):
  □ Search profiles: list, create, update, delete
  □ Projects: list, get
  □ Activities: search, events
  □ E-Mails: send, update
  □ Documents: list, upload
  □ Relationships: ownership, partnership
□ TIER 3 lookup tools (10 tools):
  □ Pipelines, tags, custom fields, users, teams, locations, sources
□ Smart composite tools (5):
  □ match_contacts_to_property
  □ full_contact_360
  □ property_performance_report
  □ smart_lead_intake
  □ pipeline_summary
```

### Phase 3: Distribution (Day 5)
```
□ npm publish (propstack-mcp-server)
□ Remote HTTP transport (Cloudflare Workers)
□ One-click deploy buttons (Railway, Render)
□ README in English + German
□ GitHub repo with examples
□ Submit to MCP registries
□ Demo video for LinkedIn
```

### Phase 4: Polish (Week 2)
```
□ TIER 4 admin tools (webhooks, datadump, portal export, policies)
□ V2 scroll integration for large datasets
□ Response caching for lookup tables
□ Structured error messages in German
□ Rate limit handling with queuing
□ Integration tests against Propstack sandbox
```

---

## Appendix: All Propstack rs_type / rs_category Enums

(Included for completeness — these go into Zod schemas so the AI knows all valid property types)

### rs_type (11 main types)
APARTMENT, HOUSE, TRADE_SITE, GARAGE, SHORT_TERM_ACCOMODATION, OFFICE, GASTRONOMY, INDUSTRY, STORE, SPECIAL_PURPOSE, INVESTMENT

### rs_category (120+ sub-types)
**Residential:** ROOF_STOREY, LOFT, MAISONETTE, PENTHOUSE, TERRACED_FLAT, GROUND_FLOOR, APARTMENT, RAISED_GROUND_FLOOR, HALF_BASEMENT, ATTIKA, OTHER, SINGLE_FAMILY_HOUSE, TWO_FAMILY_HOUSE, TERRACE_HOUSE, MID_TERRACE_HOUSE, TERRACE_END_HOUSE, END_TERRACE_HOUSE, MULTI_FAMILY_HOUSE, TOWNHOUSE, FINCA, BUNGALOW, FARMHOUSE, SEMIDETACHED_HOUSE, VILLA, CASTLE_MANOR_HOUSE, SPECIAL_REAL_ESTATE, TWIN_SINGLE_FAMILY_HOUSE, SUMMER_RESIDENCE

**Parking:** GARAGE, STREET_PARKING, CARPORT, DUPLEX, CAR_PARK, UNDERGROUND_GARAGE, DOUBLE_GARAGE, NO_INFORMATION

**Office:** OFFICE_LOFT, STUDIO, OFFICE, OFFICE_FLOOR, OFFICE_BUILDING, OFFICE_CENTRE, OFFICE_STORAGE_BUILDING, SURGERY, SURGERY_FLOOR, SURGERY_BUILDING, COMMERCIAL_CENTRE, LIVING_AND_COMMERCIAL_BUILDING, OFFICE_AND_COMMERCIAL_BUILDING

**Gastronomy:** BAR_LOUNGE, CAFE, CLUB_DISCO, GUESTS_HOUSE, TAVERN, HOTEL, HOTEL_RESIDENCE, HOTEL_GARNI, PENSION, RESTAURANT

**Industry/Warehouse:** SHOWROOM_SPACE, HALL, HIGH_LACK_STORAGE, INDUSTRY_HALL, INDUSTRY_HALL_WITH_OPEN_AREA, COLD_STORAGE, MULTIDECK_CABINET_STORAGE, STORAGE_WITH_OPEN_AREA, STORAGE_AREA, STORAGE_HALL, SERVICE_AREA, SHIPPING_STORAGE, REPAIR_SHOP

**Retail:** SHOPPING_CENTRE, FACTORY_OUTLET, DEPARTMENT_STORE, KIOSK, STORE, SELF_SERVICE_MARKET, SALES_AREA, SALES_HALL

**Special:** RESIDENCE, FARM, LEISURE_FACILITY, COMMERCIAL_UNIT, INDUSTRIAL_AREA, NURSING_HOME, ASSISTED_LIVING, HORSE_FARM, VINEYARD, SPECIAL_ESTATE

**Investment (25+ types):** INVEST_FREEHOLD_FLAT, INVEST_SINGLE_FAMILY_HOUSE, INVEST_MULTI_FAMILY_HOUSE, INVEST_LIVING_BUSINESS_HOUSE, INVEST_HOUSING_ESTATE, INVEST_MICRO_APARTMENTS, INVEST_OFFICE_BUILDING, INVEST_COMMERCIAL_BUILDING, INVEST_OFFICE_AND_COMMERCIAL_BUILDING, INVEST_SHOP_SALES_FLOOR, INVEST_SUPERMARKET, INVEST_SHOPPING_CENTRE, INVEST_RETAIL_PARK, INVEST_HOTEL, INVEST_BOARDING_HOUSE, INVEST_SURGERY_BUILDING, INVEST_CLINIC, INVEST_REHAB_CLINIC, INVEST_MEDICAL_SERVICE_CENTER, INVEST_INTEGRATION_ASSISTANCE, INVEST_DAY_NURSERY, INVEST_DAY_CARE, INVEST_NURSING_HOME, INVEST_ASSISTED_LIVING, INVEST_COMMERCIAL_CENTRE, INVEST_HALL_STORAGE, INVEST_INDUSTRIAL_PROPERTY, INVEST_CAR_PARK, INVEST_PLOT, INVEST_COMMERCIAL_UNIT, INVEST_OTHER

**Short-term:** SHORT_TERM_APARTMENT, SHORT_TERM_ROOM, SHORT_TERM_HOUSE, SHORT_TERM_FLAT

### Webhook Events
CLIENT_CREATED, CLIENT_UPDATED, PROPERTY_UPDATED (+ likely PROPERTY_CREATED, DEAL_CREATED, DEAL_UPDATED based on pattern — verify with Propstack)

### Activity Types (for search_activities filter)
message, note, reminder, event, policy, cancelation, decision, sms, letter

### Custom Field Entities
for_clients, for_properties, for_projects, for_brokers, for_tasks, for_deals

### Search Profile Feature Filters
lift, balcony, garden, built_in_kitchen, cellar, rented — each accepts "true", "false", or empty (don't care)
