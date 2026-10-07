// services/crmService.js
//
// Pure rules for the pre-award CRM (Lead -> Enquiry). No database or env
// imports on purpose, so everything here is unit-testable on its own.

/* ------------------------------------------------------------------ */
/* Status flows                                                        */
/* ------------------------------------------------------------------ */

// "converted" is deliberately NOT reachable from here: the only way to
// convert a lead is POST /lead/:id/convert, because that is what creates
// the customer record.
export const LEAD_STATUS_TRANSITIONS = {
    new: ["contacted", "qualified", "lost"],
    contacted: ["qualified", "lost"],
    qualified: ["contacted", "lost"],
    lost: ["new"], // reopen
    converted: [],
};

export const LEAD_OPEN_STATUSES = ["new", "contacted", "qualified"];

export const ENQUIRY_STATUS_TRANSITIONS = {
    new: ["under_review", "site_visit", "estimating", "no_bid", "on_hold", "cancelled"],
    under_review: ["site_visit", "estimating", "no_bid", "on_hold", "cancelled"],
    site_visit: ["estimating", "no_bid", "on_hold", "cancelled"],
    estimating: ["quoted", "no_bid", "on_hold", "cancelled"],
    quoted: ["estimating", "negotiation", "won", "lost", "on_hold", "cancelled"],
    negotiation: ["quoted", "won", "lost", "on_hold", "cancelled"],
    on_hold: ["under_review", "estimating", "cancelled"],
    lost: ["under_review"], // reopen
    no_bid: ["under_review"], // reopen
    won: [],
    cancelled: [],
};

// Statuses that still need somebody to act on them (drives follow-ups).
export const ENQUIRY_OPEN_STATUSES = [
    "new", "under_review", "site_visit", "estimating", "quoted", "negotiation", "on_hold",
];
// Nothing can be quoted against an enquiry in one of these states.
export const ENQUIRY_CLOSED_STATUSES = ["lost", "no_bid", "cancelled"];
// Moving into "quoted" automatically is only correct from these.
export const ENQUIRY_PRE_QUOTE_STATUSES = ["new", "under_review", "site_visit", "estimating"];

export function isValidLeadTransition(from, to) {
    return LEAD_STATUS_TRANSITIONS[from]?.includes(to) || false;
}

export function isValidEnquiryTransition(from, to) {
    return ENQUIRY_STATUS_TRANSITIONS[from]?.includes(to) || false;
}

/* ------------------------------------------------------------------ */
/* Allowed values (mirror the CHECK constraints in the schema)         */
/* ------------------------------------------------------------------ */

export const LEAD_RATINGS = ["cold", "warm", "hot"];
export const PRIORITIES = ["low", "medium", "high", "critical"];
export const PROJECT_TYPES = [
    "electrical", "mechanical", "mep", "plumbing", "piping", "hvac",
    "fabrication", "installation", "erection", "commissioning",
    "maintenance", "turnkey", "other",
];
export const ACTIVITY_TYPES = ["call", "meeting", "email", "whatsapp", "site_visit", "note"];
export const ENQUIRY_DOCUMENT_TYPES = [
    "rfq", "tender_document", "drawing", "specification", "boq",
    "site_photo", "correspondence", "other",
];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** Error carrying an HTTP status, for controllers to translate. */
export function httpError(status, message, extra = {}) {
    return Object.assign(new Error(message), { status, extra });
}

/** "" / undefined / null -> null, otherwise the trimmed string. */
export function cleanText(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
}

/** Last 10 digits of a phone number, or null if there are fewer than 7 digits. */
export function normalizePhone(v) {
    const digits = String(v ?? "").replace(/\D/g, "");
    return digits.length >= 7 ? digits.slice(-10) : null;
}

export function normalizeEmail(v) {
    const s = cleanText(v);
    return s ? s.toLowerCase() : null;
}

export function isValidEmail(v) {
    return /^\S+@\S+\.\S+$/.test(String(v));
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDateOnly(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Checks the fields both leads and enquiries share. Throws a 400 httpError
 * on the first problem; returns nothing. Only looks at keys that are present.
 */
export function assertCommonFields(p, { dateFields = [], enumChecks = {} } = {}) {
    for (const f of dateFields) {
        if (p[f] !== undefined && p[f] !== null && p[f] !== "" && !isValidDateOnly(p[f])) {
            throw httpError(400, `${f} must be a date in YYYY-MM-DD format`);
        }
    }
    for (const [field, allowed] of Object.entries(enumChecks)) {
        if (p[field] !== undefined && p[field] !== null && !allowed.includes(p[field])) {
            throw httpError(400, `${field} must be one of: ${allowed.join(", ")}`);
        }
    }
    if (p.email !== undefined && cleanText(p.email) && !isValidEmail(p.email)) {
        throw httpError(400, "email is not a valid email address");
    }
    if (p.contact_email !== undefined && cleanText(p.contact_email) && !isValidEmail(p.contact_email)) {
        throw httpError(400, "contact_email is not a valid email address");
    }
    for (const f of ["estimated_value", "emd_amount"]) {
        if (p[f] !== undefined && p[f] !== null && p[f] !== "" && !(Number(p[f]) >= 0)) {
            throw httpError(400, `${f} must be a number that is zero or greater`);
        }
    }
}

/**
 * Picks the allowed columns that are actually present in `body`, cleaned:
 *   textColumns  -> trimmed, "" becomes null
 *   boolColumns  -> Boolean()
 *   transforms   -> { column: fn } custom cleaning (e.g. lowercase an email)
 *   anything else -> "" becomes null, otherwise passed through
 *
 * @returns {Array<[string, any]>} [column, value] pairs in allow-list order
 */
export function pickFields(body, allowedColumns, { textColumns = [], boolColumns = [], transforms = {} } = {}) {
    const pairs = [];
    for (const col of allowedColumns) {
        if (!Object.prototype.hasOwnProperty.call(body, col)) continue;
        let v = body[col];
        if (transforms[col]) v = transforms[col](v);
        else if (boolColumns.includes(col)) v = Boolean(v);
        else if (textColumns.includes(col)) v = cleanText(v);
        else if (v === "") v = null;
        pairs.push([col, v]);
    }
    return pairs;
}

/** "col = $1, col2 = $2" from pairs, so a PUT only touches what was sent. */
export function buildSetClause(pairs) {
    return {
        setSql: pairs.map(([col], i) => `${col} = $${i + 1}`).join(", "),
        values: pairs.map(([, v]) => v),
    };
}

/** Translates common Postgres errors into a friendly HTTP status + message. */
export function mapDbError(err) {
    if (err?.status) return { status: err.status, message: err.message };
    switch (err?.code) {
        case "23503":
            return { status: 400, message: "One of the referenced records (customer, user, city, ...) does not exist" };
        case "23514":
            return { status: 400, message: "A field has a value that is not allowed" };
        case "23505":
            return { status: 409, message: "That record already exists" };
        case "22P02":
        case "22007":
        case "22003":
            return { status: 400, message: "A field has an invalid value" };
        default:
            return null;
    }
}

/** Sends a consistent error response; only leaks internals outside production. */
export function sendError(res, tag, err, fallbackMessage) {
    const mapped = mapDbError(err);
    if (mapped) {
        return res.status(mapped.status).json({ success: false, error: mapped.message, ...(err.extra || {}) });
    }
    console.error(`[${tag}]`, err);
    const body = { success: false, error: fallbackMessage };
    if (process.env.NODE_ENV !== "production") body.details = err?.message;
    return res.status(500).json(body);
}

/** Clamp ?limit / ?offset from a query string. */
export function parsePaging(query, { defaultLimit = 200, maxLimit = 1000 } = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
    const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
    return { limit, offset };
}
