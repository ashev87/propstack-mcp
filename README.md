# Propstack MCP Server

Connect AI assistants (Claude, ChatGPT) to your Propstack real estate CRM.

> **Verbinden Sie KI-Assistenten mit Ihrem Propstack-CRM** — Kontakte verwalten, Objekte durchsuchen, Deals pflegen, Besichtigungen planen und Suchprofile erstellen, alles per Sprache oder Chat.

## What you can do / Was Sie damit machen koennen

- **Contact management** — search, create, update, and tag contacts with GDPR tracking
- **Property search & management** — filter by price, rooms, area, status; create and update listings
- **Deal pipeline** — create deals, move through stages, track win/loss rates
- **Buyer matching** — create search profiles from natural language ("3-Zimmer in Berlin, bis 400k, mit Balkon") and auto-match to new listings
- **Task & calendar** — log call notes, set follow-up reminders, schedule viewings
- **Email** — send templated emails linked to contacts and properties
- **360-degree contact view** — get a complete briefing before every call
- **Pipeline dashboards** — deal counts and values per stage, stale deal alerts
- **Lead intake** — one-call workflow: dedup, create contact, log notes, create deal, set reminder
- **Bulk export** — full data dumps for reporting, backup, or migration

## Quick Start

### 1. Set your API key

```bash
export PROPSTACK_API_KEY=your_api_key_here
```

### 2a. Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "propstack": {
      "command": "npx",
      "args": ["-y", "propstack-mcp-server"],
      "env": {
        "PROPSTACK_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### 2b. Claude Code (CLI)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "propstack": {
      "command": "npx",
      "args": ["-y", "propstack-mcp-server"],
      "env": {
        "PROPSTACK_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### 2c. ChatGPT

1. Go to **Settings > Connectors > Developer Mode**
2. Add a new MCP connector
3. Set the command to `npx -y propstack-mcp-server`
4. Add environment variable `PROPSTACK_API_KEY`

### 2d. Run directly

```bash
npm install propstack-mcp-server
PROPSTACK_API_KEY=your_key npx propstack-mcp-server
```

## API Key / API-Schluessel

Get your Propstack API key:

1. Log in to [crm.propstack.de](https://crm.propstack.de)
2. Go to **Verwaltung > API-Schluessel** (Administration > API Keys)
3. Create or copy your V1 API key

> **Hinweis:** Der API-Schluessel bestimmt die Berechtigungen. Stellen Sie sicher, dass Lese- und Schreibzugriff fuer die benoetigten Endpunkte aktiviert ist.

## Available Tools (50)

### Contacts (Kontakte)

| Tool | Description |
|---|---|
| `search_contacts` | Search and filter contacts by name, email, phone, status, tags, broker, GDPR status |
| `get_contact` | Get full details of a single contact with related data |
| `create_contact` | Create a new contact (auto-dedup by email) |
| `update_contact` | Update contact details, tags, GDPR status, broker assignment |
| `delete_contact` | Soft-delete a contact (30-day recycle bin) |
| `get_contact_sources` | List lead sources (ImmoScout24, Website, Empfehlung, etc.) |
| `search_contacts_by_phone` | Look up a contact by phone number (formatting-insensitive) |

### Properties (Objekte)

| Tool | Description |
|---|---|
| `search_properties` | Search properties with 11 range filters, 17 sort fields |
| `get_property` | Get full property details including media and custom fields |
| `create_property` | Create a new property listing |
| `update_property` | Update price, status, description, broker assignment |
| `get_property_statuses` | List property statuses (Verfuegbar, Reserviert, Verkauft, etc.) |

### Tasks (Aufgaben & Notizen)

| Tool | Description |
|---|---|
| `create_task` | Create a note, to-do, appointment, or cancellation (polymorphic) |
| `update_task` | Mark done, reschedule, update notes |
| `get_task` | Get task details with linked contacts, properties, projects |

### Deals (Pipeline)

| Tool | Description |
|---|---|
| `search_deals` | Search deals by stage, pipeline, category, broker, feeling score |
| `create_deal` | Link a contact to a property at a pipeline stage |
| `update_deal` | Move deal through pipeline stages, update price/notes |

### Search Profiles (Suchprofile)

| Tool | Description |
|---|---|
| `list_search_profiles` | List what buyers/renters are looking for |
| `create_search_profile` | Capture buyer criteria from natural language |
| `update_search_profile` | Adjust budget, cities, room count, features |
| `delete_search_profile` | Remove a search profile |

### Projects (Projekte)

| Tool | Description |
|---|---|
| `list_projects` | List development projects with unit counts |
| `get_project` | Get project details with all units, media, documents |

### Activities & Events (Aktivitaeten & Termine)

| Tool | Description |
|---|---|
| `search_activities` | Full activity timeline for a contact, property, or project |
| `list_events` | Calendar events — viewings, meetings, filtered by date/state |

### Emails (E-Mails)

| Tool | Description |
|---|---|
| `send_email` | Send email using a Propstack template (snippet) |
| `update_email` | Mark read/archived, categorize, link to CRM records |

### Documents (Dokumente)

| Tool | Description |
|---|---|
| `list_documents` | List files attached to a property, project, or contact |
| `upload_document` | Upload a document (base64 data URI) |

### Relationships (Beziehungen)

| Tool | Description |
|---|---|
| `create_ownership` | Link a contact as property owner (Eigentuemer) |
| `create_partnership` | Link a contact as buyer, tenant, etc. (Kaeufer, Mieter) |

### Lookups (Konfiguration)

| Tool | Description |
|---|---|
| `list_pipelines` | Get deal pipelines with stages (IDs, names, positions) |
| `get_pipeline` | Get a single pipeline with stage details |
| `list_tags` | List tags/labels (Merkmale) — hierarchical with Obermerkmale |
| `create_tag` | Create a new tag for contacts, properties, or activities |
| `list_custom_fields` | Discover custom field definitions (names, types, options) |
| `list_users` | List all brokers/agents with contact info |
| `list_teams` | List teams/departments with member assignments |
| `list_locations` | List geographic areas (Geolagen) for location matching |

### Smart Composites (Intelligente Workflows)

| Tool | Description |
|---|---|
| `full_contact_360` | Complete contact dossier — info, search profiles, deals, activity |
| `property_performance_report` | Days on market, inquiry count, pipeline breakdown, activity summary |
| `pipeline_summary` | Deals per stage, total values, stale deals needing attention |
| `smart_lead_intake` | Full lead workflow: dedup, create/update, log notes, deal, reminder |
| `match_contacts_to_property` | Find buyers whose search profiles match a property |

### Admin (Verwaltung)

| Tool | Description |
|---|---|
| `list_webhooks` | List all configured webhook subscriptions |
| `create_webhook` | Subscribe to CRM events (CLIENT_CREATED, PROPERTY_UPDATED, etc.) |
| `delete_webhook` | Remove a webhook subscription |
| `export_data` | Bulk export an entire data table as JSON |
| `get_contact_favorites` | Get properties a contact has favorited |

## Example Conversations / Beispiel-Konversationen

### Morning Briefing / Morgen-Briefing

> **You:** What's on my calendar today?
>
> **AI:** *calls `list_events` with today's date range* — You have 3 viewings scheduled...

> **Du:** Gibt es neue Leads seit gestern?
>
> **KI:** *ruft `search_contacts` mit created_at_from=gestern auf* — 5 neue Kontakte...

### Lead Intake / Leaderfassung

> **You:** I just got off the phone with Maria Schmidt, +49 157 1234 5678. She's looking for a 3-room apartment in Berlin, budget 300-400k, must have a balcony. She found us on ImmoScout.
>
> **AI:** *calls `smart_lead_intake`* — Contact created (ID: 4521), call note logged, follow-up reminder set for tomorrow 9:00. Would you like me to create a search profile for her criteria?

### Property Matching / Objekt-Matching

> **Du:** Wir haben ein neues Listing: 3-Zimmer-Wohnung in Charlottenburg, 385.000 EUR. Wer kommt als Kaeufer in Frage?
>
> **KI:** *ruft `match_contacts_to_property` auf* — 12 passende Suchprofile gefunden. Top 3: Herr Weber (Score 95%), Frau Mueller (Score 88%), Herr Kim (Score 85%)...

### Pipeline Review

> **You:** How's our sales pipeline looking? Any stale deals?
>
> **AI:** *calls `pipeline_summary`* — 47 active deals, total value 12.3M EUR. 5 deals haven't been updated in 14+ days...

### Pre-Call Briefing / Vor dem Anruf

> **Du:** Gib mir alles ueber Kontakt 3847 — ich rufe gleich an.
>
> **KI:** *ruft `full_contact_360` auf* — Herr Weber, Rating 3 Sterne, sucht 3-Zimmer in Berlin/Potsdam bis 400k. 2 aktive Deals, letzte Aktivitaet vor 3 Tagen...

## Development

```bash
git clone <repo-url>
cd propstack-mcp-server
npm install
npm run build    # tsc → dist/
npm start        # requires PROPSTACK_API_KEY
```

### Project Structure

```
src/
  index.ts                 # Server entry point (stdio transport)
  propstack-client.ts      # HTTP client with auth, retry, error handling
  types/
    propstack.ts           # TypeScript interfaces for all API responses
  tools/
    helpers.ts             # Shared formatting utilities
    contacts.ts            # 7 contact tools
    properties.ts          # 5 property tools
    tasks.ts               # 3 task tools (polymorphic: note/todo/event/cancel)
    deals.ts               # 3 deal pipeline tools
    search-profiles.ts     # 4 search profile tools
    projects.ts            # 2 project tools
    activities.ts          # 2 activity/event tools
    emails.ts              # 2 email tools
    documents.ts           # 2 document tools
    relationships.ts       # 2 relationship tools (ownership/partnership)
    lookups.ts             # 8 lookup/config tools
    composites.ts          # 5 smart composite tools
    admin.ts               # 5 admin tools (webhooks, export, favorites)
```

## License

MIT
