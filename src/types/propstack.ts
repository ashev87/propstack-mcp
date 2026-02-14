// ── Generic pagination wrapper ───────────────────────────────────────

export interface PropstackPaginatedResponse<T> {
  data: T[];
  meta?: { total_count: number };
}

// ── Shared nested types ─────────────────────────────────────────────

export interface PropstackImage {
  id: number;
  url: string | null;
  title: string | null;
  position: number | null;
  is_floorplan: boolean | null;
  is_private: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PropstackLink {
  id: number;
  title: string | null;
  url: string | null;
}

export interface PropstackPropertyStatus {
  id: number;
  name: string | null;
  position: number | null;
  color: string | null;
  nonpublic: boolean | null;
}

export interface PropstackContactSource {
  id: number;
  name: string | null;
}

export interface PropstackContactStatus {
  id: number;
  name: string | null;
}

export interface PropstackLocation {
  id: number;
  name: string | null;
}

// ── Broker / Users ──────────────────────────────────────────────────

export interface PropstackBroker {
  id: number;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  team_id: number | null;
  department_ids: number[] | null;
  avatar: string | null;
  color: string | null;
}

// ── Teams / Departments ─────────────────────────────────────────────

export interface PropstackTeam {
  id: number;
  name: string | null;
  broker_ids: number[] | null;
  logo: string | null;
}

// ── Tags / Groups (Merkmale) ────────────────────────────────────────

export interface PropstackTag {
  id: number;
  name: string | null;
  super_group_id: number | null;
  for_clients: boolean | null;
  for_properties: boolean | null;
  for_activities: boolean | null;
}

export interface PropstackSuperGroup {
  id: number;
  name: string | null;
  groups: PropstackTag[] | null;
}

// ── Custom Fields ───────────────────────────────────────────────────

export interface PropstackCustomField {
  name: string | null;
  pretty_name: string | null;
  type: string | null;
  options: string[] | null;
}

export interface PropstackCustomFieldGroup {
  id: number;
  name: string | null;
  fields: PropstackCustomField[] | null;
}

// ── Contact (Kontakt) ───────────────────────────────────────────────

export interface PropstackContact {
  id: number;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  salutation: string | null;
  email: string | null;
  phone: string | null;
  home_cell: string | null;
  home_phone: string | null;
  office_phone: string | null;
  fax: string | null;
  company: string | null;
  position: string | null;
  description: string | null;

  // Addresses
  home_street: string | null;
  home_house_number: string | null;
  home_zip_code: string | null;
  home_city: string | null;
  home_country: string | null;
  office_street: string | null;
  office_house_number: string | null;
  office_zip_code: string | null;
  office_city: string | null;
  office_country: string | null;

  // Classification
  broker_id: number | null;
  broker: PropstackBroker | null;
  client_source_id: number | null;
  client_source: PropstackContactSource | null;
  client_status_id: number | null;
  client_status: PropstackContactStatus | null;
  language: string | null;
  rating: number | null;
  newsletter: boolean | null;
  accept_contact: boolean | null;
  gdpr_status: number | null;
  warning_notice: string | null;

  // Tags & custom fields
  groups: PropstackTag[] | null;
  custom_fields: Record<string, unknown> | null;

  // Timestamps
  last_contact_at: string | null;
  last_contact_at_formatted: string | null;
  created_at: string | null;
  updated_at: string | null;
  archived: boolean | null;

  // Include-expanded relations
  children?: PropstackContact[] | null;
  documents?: PropstackDocument[] | null;
  relationships?: PropstackRelationship[] | null;
  owned_properties?: PropstackProperty[] | null;

  // Upsert / external ID
  old_crm_id: string | null;
}

// ── Property (Objekt) ───────────────────────────────────────────────

export interface PropstackProperty {
  id: number;
  title: string | null;
  unit_id: string | null;
  exposee_id: string | null;

  // Type classification
  marketing_type: string | null;
  object_type: string | null;
  rs_type: string | null;
  rs_category: string | null;

  // Address
  street: string | null;
  house_number: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;

  // Pricing
  price: number | null;
  base_rent: number | null;
  total_rent: number | null;

  // Dimensions
  living_space: number | null;
  plot_area: number | null;
  property_space_value: number | null;
  number_of_rooms: number | null;
  number_of_bed_rooms: number | null;
  number_of_bath_rooms: number | null;
  floor: number | null;
  construction_year: number | null;

  // Description texts
  description_note: string | null;
  location_note: string | null;
  furnishing_note: string | null;
  other_note: string | null;

  // Commission
  courtage: string | null;
  courtage_note: string | null;

  // Assignment
  broker_id: number | null;
  broker: PropstackBroker | null;
  project_id: number | null;
  project: PropstackProject | null;

  // Status
  status: number | null;
  property_status: PropstackPropertyStatus | null;

  // Tags & custom fields
  property_groups: PropstackTag[] | null;
  custom_fields: Record<string, unknown> | null;

  // Media & documents
  images: PropstackImage[] | null;
  floorplans: PropstackImage[] | null;
  documents: PropstackDocument[] | null;
  links: PropstackLink[] | null;

  // Timestamps
  created_at: string | null;
  updated_at: string | null;
  archived: boolean | null;
}

// ── Deal (Client ↔ Property) ────────────────────────────────────────

export interface PropstackDeal {
  id: number;
  broker_id: number | null;
  client_id: number | null;
  property_id: number | null;
  project_id: number | null;
  deal_stage_id: number | null;
  deal_pipeline_id: number | null;
  sold_price: number | null;
  note: string | null;
  date: string | null;
  start_date: string | null;
  reservation_reason_id: number | null;
  feeling: number | null;
  category: string | null;

  // Expanded relations
  client: PropstackContact | null;
  property: PropstackProperty | null;

  created_at: string | null;
  updated_at: string | null;
}

// ── Deal Pipeline & Stages ──────────────────────────────────────────

export interface PropstackDealStage {
  id: number;
  name: string | null;
  position: number | null;
  color: string | null;
  chance: number | null;
}

export interface PropstackDealPipeline {
  id: number;
  name: string | null;
  broker_ids: number[] | null;
  deal_stages: PropstackDealStage[] | null;
}

// ── Task (polymorphic activity write hub) ────────────────────────────

export interface PropstackTask {
  id: number;
  title: string | null;
  body: string | null;
  note_type_id: number | null;
  broker_id: number | null;

  // Linked entities
  client_ids: number[] | null;
  property_ids: number[] | null;
  project_ids: number[] | null;

  // Reminder (Aufgabe) fields
  is_reminder: boolean | null;
  due_date: string | null;
  remind_at: string | null;
  done: boolean | null;

  // Event (Termin) fields
  is_event: boolean | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  private: boolean | null;
  all_day: boolean | null;
  recurring: boolean | null;
  rrule: string | null;

  // State & cancellation
  state: string | null;
  reservation_reason_id: number | null;

  // Attachments
  attachments: PropstackAttachment[] | null;

  // Include-expanded relations
  clients?: PropstackContact[] | null;
  units?: PropstackProperty[] | null;
  projects?: PropstackProject[] | null;
  viewings?: unknown[] | null;

  created_at: string | null;
  updated_at: string | null;
}

export interface PropstackAttachment {
  id: number;
  url: string | null;
  name: string | null;
  content_type: string | null;
}

// ── Search Profile (Suchprofil / saved_query) ───────────────────────

export interface PropstackSearchProfile {
  id: number;
  client_id: number | null;
  active: boolean | null;

  // Type filters
  marketing_type: string | null;
  rs_types: string[] | null;
  rs_categories: string[] | null;

  // Location
  cities: string[] | null;
  regions: string[] | null;
  lat: number | null;
  lng: number | null;
  radius: number | null;

  // Price ranges
  price: number | null;
  price_to: number | null;
  base_rent: number | null;
  base_rent_to: number | null;
  total_rent: number | null;
  total_rent_to: number | null;

  // Space ranges
  living_space: number | null;
  living_space_to: number | null;
  plot_area: number | null;
  plot_area_to: number | null;

  // Room ranges
  number_of_rooms: number | null;
  number_of_rooms_to: number | null;
  number_of_bed_rooms: number | null;
  number_of_bed_rooms_to: number | null;

  // Other ranges
  floor: number | null;
  floor_to: number | null;
  construction_year: number | null;
  construction_year_to: number | null;

  // Feature booleans (true / false / null = don't care)
  lift: boolean | null;
  balcony: boolean | null;
  garden: boolean | null;
  built_in_kitchen: boolean | null;
  cellar: boolean | null;
  rented: boolean | null;

  // Investment criteria
  price_per_sqm: number | null;
  price_per_sqm_to: number | null;
  price_multiplier: number | null;
  price_multiplier_to: number | null;
  yield_actual: number | null;
  yield_actual_to: number | null;

  // Metadata
  note: string | null;
  group_ids: number[] | null;
  location_ids: number[] | null;

  created_at: string | null;
  updated_at: string | null;
}

// ── Project ─────────────────────────────────────────────────────────

export interface PropstackProject {
  id: number;
  title: string | null;
  name: string | null;
  status: string | null;
  broker_id: number | null;

  // Address
  street: string | null;
  house_number: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;

  // Media & documents
  images: PropstackImage[] | null;
  floorplans: PropstackImage[] | null;
  documents: PropstackDocument[] | null;
  links: PropstackLink[] | null;

  // Units
  units: PropstackProperty[] | null;

  custom_fields: Record<string, unknown> | null;

  created_at: string | null;
  updated_at: string | null;
}

// ── Email (Message) ─────────────────────────────────────────────────

export interface PropstackEmail {
  id: number;
  subject: string | null;
  body: string | null;
  broker_id: number | null;
  snippet_id: number | null;

  // Recipients
  from: string | null;
  to: string[] | null;
  cc: string[] | null;
  bcc: string[] | null;

  // Linked entities
  client_ids: number[] | null;
  property_ids: number[] | null;
  project_ids: number[] | null;

  // State
  read: boolean | null;
  archived: boolean | null;
  message_category_id: number | null;

  attachments: PropstackAttachment[] | null;

  created_at: string | null;
  updated_at: string | null;
}

// ── Document ────────────────────────────────────────────────────────

export interface PropstackDocument {
  id: number;
  token: string | null;
  title: string | null;
  name: string | null;
  url: string | null;
  position: number | null;
  broker_id: number | null;

  // Flags
  is_private: boolean | null;
  is_floorplan: boolean | null;
  is_exposee: boolean | null;
  on_landing_page: boolean | null;

  tags: string[] | null;

  created_at: string | null;
  updated_at: string | null;
}

// ── Activity (read-only feed item) ──────────────────────────────────

export interface PropstackActivity {
  id: number;
  type: string | null;
  title: string | null;
  body: string | null;
  broker_id: number | null;
  client_id: number | null;
  property_id: number | null;
  project_id: number | null;

  // Nested objects (may or may not be expanded)
  broker: PropstackBroker | null;
  client: PropstackContact | null;
  property: PropstackProperty | null;

  created_at: string | null;
  updated_at: string | null;
}

// ── Event (Termin — calendar read view) ─────────────────────────────

export interface PropstackEvent {
  id: number;
  title: string | null;
  body: string | null;
  location: string | null;
  starts_at: string | null;
  ends_at: string | null;
  state: string | null;
  recurring: boolean | null;
  rrule: string | null;
  all_day: boolean | null;
  private: boolean | null;
  broker_id: number | null;

  // Nested
  client: PropstackContact | null;
  property: PropstackProperty | null;
  group_ids: number[] | null;

  created_at: string | null;
  updated_at: string | null;
}

// ── Webhook ─────────────────────────────────────────────────────────

export interface PropstackWebhook {
  id: number;
  url: string | null;
  events: string[] | null;
  active: boolean | null;
  secret: string | null;
}

// ── Relationship (ownership / partnership) ──────────────────────────

export interface PropstackRelationship {
  id: number;
  client_id: number | null;
  property_id: number | null;
  internal_name: string | null;
  name: string | null;
}

// ── Policy (GDPR consent record) ────────────────────────────────────

export interface PropstackPolicy {
  id: number;
  client_id: number | null;
  broker_id: number | null;
  type: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// ── Portal Export ───────────────────────────────────────────────────

export interface PropstackPortalExport {
  id: number;
  property_id: number | null;
  portal_name: string | null;
  status: string | null;
  url: string | null;
  created_at: string | null;
  updated_at: string | null;
}
