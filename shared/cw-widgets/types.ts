// The in-chat ConnectWise PSA widget format. A widget is data only: plain
// strings, numbers and booleans read from a ConnectWise record, never markup
// or code, so every client draws it with its own components (web, iPhone,
// iPad) and nothing in it can run. The same JSON is what a ```cw fence or a
// Claude-style artifact of type `application/vnd.sagax.cw+json` carries.

export const CW_WIDGET_VERSION = 1;
export const CW_ARTIFACT_TYPE = "application/vnd.sagax.cw+json";
export const CW_FENCE = "cw";

/** At most this many records in one list widget; `total` keeps the count. */
export const CW_MAX_RECORDS = 50;
export const CW_MAX_NOTES = 20;
export const CW_TEXT_MAX = 300;
export const CW_NOTE_MAX = 1500;

/** The ConnectWise Manage site a deep link opens: its host (na.myconnectwise.net,
 * or an on-premises name) and the company id typed at sign-in. */
export interface CwSite {
  host: string;
  company?: string;
}

export interface CwTicketNote {
  id?: number;
  text: string;
  by?: string;
  at?: string;
  internal?: boolean;
  resolution?: boolean;
}

export interface CwTicket {
  id: number;
  summary: string;
  status?: string;
  priority?: string;
  company?: string;
  contact?: string;
  board?: string;
  type?: string;
  owner?: string;
  resources?: string;
  entered?: string;
  updated?: string;
  due?: string;
  budgetHours?: number;
  actualHours?: number;
  closed?: boolean;
  /** "ServiceTicket" or "ProjectTicket", for a time entry charged to it */
  recordType?: "ServiceTicket" | "ProjectTicket";
  /** newest first */
  notes?: CwTicketNote[];
  link?: string;
}

/** A time entry charged to a ticket, a project or a charge code. */
export interface CwTimeEntry {
  id: number;
  /** "Ticket #48213" style label, when the entry names what it charges */
  charge?: string;
  chargeToId?: number;
  company?: string;
  member?: string;
  workType?: string;
  workRole?: string;
  /** ConnectWise billableOption: Billable, DoNotBill or NoCharge */
  billable?: string;
  hours?: number;
  notes?: string;
  start?: string;
  end?: string;
  status?: string;
  agreement?: string;
  link?: string;
}

/** One block on the dispatch calendar. */
export interface CwScheduleEntry {
  id: number;
  name: string;
  member?: string;
  company?: string;
  /** the service ticket or project the block is for */
  objectId?: number;
  type?: string;
  where?: string;
  status?: string;
  start?: string;
  end?: string;
  hours?: number;
  done?: boolean;
  link?: string;
}

export interface CwAgreement {
  id: number;
  name: string;
  company?: string;
  type?: string;
  status?: string;
  start?: string;
  end?: string;
  /** periodic bill amount, in the agreement's own currency */
  billAmount?: number;
  cycle?: string;
  cancelled?: boolean;
  link?: string;
}

export interface CwCompany {
  id: number;
  name: string;
  identifier?: string;
  status?: string;
  type?: string;
  phone?: string;
  /** https only; anything else is dropped */
  website?: string;
  city?: string;
  territory?: string;
  link?: string;
}

export interface CwWidgetBase {
  v: typeof CW_WIDGET_VERSION;
  /** one record: a card; several: the family's list view */
  view: "card" | "list";
  /** records the query returned when the widget holds fewer */
  total?: number;
  site?: CwSite;
}

export interface CwTicketWidget extends CwWidgetBase {
  family: "ticket";
  records: CwTicket[];
}

export interface CwTimeWidget extends CwWidgetBase {
  family: "time";
  records: CwTimeEntry[];
}

export interface CwScheduleWidget extends CwWidgetBase {
  family: "schedule";
  records: CwScheduleEntry[];
}

export interface CwAgreementWidget extends CwWidgetBase {
  family: "agreement";
  records: CwAgreement[];
}

export interface CwCompanyWidget extends CwWidgetBase {
  family: "company";
  records: CwCompany[];
}

export type CwWidget = CwTicketWidget | CwTimeWidget | CwScheduleWidget | CwAgreementWidget | CwCompanyWidget;
export type CwFamily = CwWidget["family"];
export type CwRecordOf<F extends CwFamily> = Extract<CwWidget, { family: F }>["records"][number];
