//  services/partyService.js

import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "./seriesService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";

function normalizePartyType(partyType) {
    return String(partyType ?? "").trim().toUpperCase();
}

export function resolvePartySeriesDocumentType(partyType, fallbackDocumentTypeId = null) {
    const normalizedPartyType = normalizePartyType(partyType);

    if (fallbackDocumentTypeId) {
        return fallbackDocumentTypeId;
    }

    switch (normalizedPartyType) {
        case "CUSTOMER":
            return DOCUMENT_TYPES.CUSTOMER;
        case "VENDOR":
            return DOCUMENT_TYPES.VENDOR;
        case "BOTH":
            return DOCUMENT_TYPES.CUSTOMER;
        default:
            throw new Error(`Unsupported party type: ${partyType}`);
    }
}

export async function addParty(partyData, companyId, userId, financialYearId, options = {}) {
    const companyPool = await getCompanyPool(companyId);
    const client = options.client ?? await companyPool.connect();
    const isOwnClient = !options.client;

    try {
        if (isOwnClient) {
            await client.query("BEGIN");
        }

        const normalizedPartyType = normalizePartyType(partyData.party_type ?? options.partyType);
        const documentTypeId = resolvePartySeriesDocumentType(
            normalizedPartyType,
            partyData.document_type_id ?? options.documentTypeId
        );

        const seriesResult = await getNextSeries(companyPool, {
            documentTypeId,
            companyId,
            userId,
            financialYearId
        });

        const insertPartyQuery = `INSERT INTO tbl_party
        (party_type, party_name, party_code, email, phone, gst_no, pan_no, website, notes, opening_balance, authorized_signature, currency_id, financial_year_id, company_id, user_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            RETURNING *`;

        const partyValues = [
            normalizedPartyType,
            partyData.party_name,
            seriesResult.series,
            partyData.email,
            partyData.phone,
            partyData.gst_no,
            partyData.pan_no ?? null,
            partyData.website ?? null,
            partyData.notes,
            partyData.opening_balance ?? 0,
            partyData.authorized_signature ?? null,
            partyData.currency_id,
            financialYearId,
            companyId,
            userId,
        ];

        const result = await client.query(insertPartyQuery, partyValues);
        const party = result.rows[0];
        const partyId = party.party_id;

        const addresses = Array.isArray(partyData.addresses) ? partyData.addresses : [];
        const savedAddresses = [];

        for (const address of addresses) {

            const addressResult = await client.query(
                `INSERT INTO tbl_party_addresses
                (party_id, address_type, address_label, attention_to, phone, address_line1, address_line2, city_id, state_id, country_id, pincode, company_id, user_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [
                    partyId,
                    address.address_type ?? null,
                    address.address_label ?? null,
                    address.attention_to ?? null,
                    address.phone ?? address.addr_phone ?? null,
                    address.address_line1 ?? null,
                    address.address_line2 ?? null,
                    address.city_id ?? null,
                    address.state_id ?? null,
                    address.country_id ?? null,
                    address.pincode ?? null,
                    companyId,
                    userId
                ]
            );
            savedAddresses.push(addressResult.rows[0]);
        }

        const contactPersons = Array.isArray(partyData.contactPersons) ? partyData.contactPersons : [];
        const savedContacts = [];

        for (const contact of contactPersons) {
            const contactResult = await client.query(
                `INSERT INTO tbl_party_contact_person (party_id, name, email, phone, company_id, user_id)
                VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
                [
                    partyId,
                    contact.name ?? partyData.party_name ?? "Main Contact",
                    contact.email ?? null,
                    contact.phone ?? null,
                    companyId,
                    userId
                ]
            );

            savedContacts.push(contactResult.rows[0]);
        }

        if (isOwnClient) {
            await client.query("COMMIT");
        }

        return {
            basic: party,
            address: savedAddresses, //addressResult.rows[0],
            contactPersons: savedContacts //contactResult.rows[0],
        };
    } catch (err) {
        if (isOwnClient) {
            await client.query("ROLLBACK").catch(() => { });
        }
        throw err;
    } finally {
        if (isOwnClient) {
            client.release();
        }
    }
}

export async function UpdateParty(partyId, partyData, companyId, userId, financialYearId, options = {}) {
    const companyPool = await getCompanyPool(companyId);
    const client = options.client ?? await companyPool.connect();
    const isOwnClient = !options.client;

    try {
        if (isOwnClient) {
            await client.query("BEGIN");
        }

        const normalizedPartyType = normalizePartyType(partyData.party_type ?? options.partyType);
        const documentTypeId = resolvePartySeriesDocumentType(normalizedPartyType, partyData.document_type_id ?? options.documentTypeId);

        const updatePartyQuery = `UPDATE tbl_party
        SET party_type = $1, party_name = $2, email = $3, phone = $4, gst_no = $5, pan_no = $6, website = $7, notes = $8, opening_balance = $9, authorized_signature = $10, currency_id = $11
        WHERE party_id = $12 
        AND company_id = $13
        AND is_deleted = FALSE RETURNING *`;

        const partyValues = [
            normalizedPartyType,
            partyData.party_name,
            partyData.email,
            partyData.phone,
            partyData.gst_no,
            partyData.pan_no ?? null,
            partyData.website ?? null,
            partyData.notes,
            partyData.opening_balance ?? 0,
            partyData.authorized_signature ?? null,
            partyData.currency_id,
            partyId,
            companyId
        ];

        const result = await client.query(updatePartyQuery, partyValues);
        if (result.rowCount === 0) {
            throw new Error("Party not found");
        }
        const party = result.rows[0];

        const savedAddresses = await updatePartyAddresses(client, partyId, companyId, userId, partyData.addresses);
        const savedContacts = await updatePartyContactPersons(client, partyId, companyId, userId, partyData.contactPersons);

        if (isOwnClient) {
            await client.query("COMMIT");
        }

        return {
            basic: party,
            address: savedAddresses, //addressResult.rows[0],
            contactPersons: savedContacts //contactResult.rows[0],
        };
    } catch (err) {
        if (isOwnClient) {
            await client.query("ROLLBACK").catch(() => { });
        }
        throw err;
    } finally {
        if (isOwnClient) {
            client.release();
        }
    }


}


export async function DeleteParty(partyId, partyData, companyId, userId, financialYearId, options = {}) {
    const companyPool = await getCompanyPool(companyId);
    const client = options.client ?? await companyPool.connect();
    const isOwnClient = !options.client;

    try {
        if (isOwnClient) {
            await client.query("BEGIN");
        }
        
        const normalizedPartyType = normalizePartyType(partyData.party_type ?? options.partyType);
        const documentTypeId = resolvePartySeriesDocumentType(normalizedPartyType, partyData.document_type_id ?? options.documentTypeId);


        const updatePartyQuery = `UPDATE tbl_party SET is_deleted = $1, status = $2
        WHERE party_id = $3 AND company_id = $4 AND is_deleted = FALSE AND party_type = $5 RETURNING *`;

        const partyValues = [true, 'inactive', partyId, companyId, normalizedPartyType];

        const result = await client.query(updatePartyQuery, partyValues);
        if (result.rowCount === 0) {
            throw new Error("Party not found");
        }
        const party = result.rows[0];

        const savedAddresses = await updatePartyAddresses(client, partyId, companyId, userId);
        const savedContacts = await updatePartyContactPersons(client, partyId, companyId, userId);

        if (isOwnClient) {
            await client.query("COMMIT");
        }

        return {
            basic: party,
            address: savedAddresses, //addressResult.rows[0],
            contactPersons: savedContacts //contactResult.rows[0],
        };
    } catch (err) {
        if (isOwnClient) {
            await client.query("ROLLBACK").catch(() => { });
        }
        throw err;
    } finally {
        if (isOwnClient) {
            client.release();
        }
    }


}

async function updatePartyAddresses(client, partyId, companyId, userId, addresses) {

    const addressList = Array.isArray(addresses) ? addresses : [];

    const existingResult = await client.query(
        `SELECT address_id FROM tbl_party_addresses
        WHERE party_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [partyId, companyId]
    );

    const existingIds = existingResult.rows.map(row => Number(row.address_id));

    const receivedIds = addressList.filter(address => address.address_id != null).map(address => Number(address.address_id));

    const idsToDelete = existingIds.filter(id => !receivedIds.includes(id));

    if (idsToDelete.length > 0) {
        await client.query(
            `UPDATE tbl_party_addresses SET is_deleted = TRUE, status = 'inactive' 
            WHERE party_id = $1 AND company_id = $2 AND address_id = ANY($3::int[])`,
            [partyId, companyId, idsToDelete]
        );
    }

    const savedAddresses = [];
    for (const address of addressList) {
        if (address.address_id != null) {

            const updateResult = await client.query(
                `UPDATE tbl_party_addresses SET address_type = $1, address_label = $2, attention_to = $3, phone = $4, address_line1 = $5, address_line2 = $6, city_id = $7, state_id = $8, country_id = $9, pincode = $10
                WHERE address_id = $11 AND party_id = $12 AND company_id = $13 AND is_deleted = FALSE RETURNING *`,
                [
                    address.address_type ?? null,
                    address.address_label ?? null,
                    address.attention_to ?? null,
                    address.phone ?? address.addr_phone ?? null,
                    address.address_line1 ?? null,
                    address.address_line2 ?? null,
                    address.city_id ?? null,
                    address.state_id ?? null,
                    address.country_id ?? null,
                    address.pincode ?? null,
                    address.address_id,
                    partyId,
                    companyId
                ]
            );

            if (updateResult.rowCount === 0) {
                throw new Error(`Address ${address.address_id} not found`);
            }
            savedAddresses.push(updateResult.rows[0]);
        }

        else {
            const insertResult = await client.query(
                `INSERT INTO tbl_party_addresses(party_id, address_type, address_label, attention_to, phone, address_line1, address_line2, city_id, state_id, country_id, pincode, company_id, user_id)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [
                    partyId,
                    address.address_type ?? null,
                    address.address_label ?? null,
                    address.attention_to ?? null,
                    address.phone ?? address.addr_phone ?? null,
                    address.address_line1 ?? null,
                    address.address_line2 ?? null,
                    address.city_id ?? null,
                    address.state_id ?? null,
                    address.country_id ?? null,
                    address.pincode ?? null,
                    companyId,
                    userId
                ]
            );
            savedAddresses.push(insertResult.rows[0]);
        }
    }

    return savedAddresses;
}

async function updatePartyContactPersons(client, partyId, companyId, userId, contactPersons) {

    const contactList = Array.isArray(contactPersons) ? contactPersons : [];

    const existingResult = await client.query(
        `SELECT person_id FROM tbl_party_contact_person WHERE party_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [partyId, companyId]
    );

    const existingIds = existingResult.rows.map(row => Number(row.person_id));

    const receivedIds = contactList.filter(contact => contact.person_id != null).map(contact => Number(contact.person_id));

    const idsToDelete = existingIds.filter(id => !receivedIds.includes(id));

    if (idsToDelete.length > 0) {

        await client.query(
            `UPDATE tbl_party_contact_person SET is_deleted = TRUE WHERE party_id = $1 AND company_id = $2 AND person_id = ANY($3::int[])`,
            [partyId, companyId, idsToDelete]
        );
    }

    const savedContacts = [];
    for (const contact of contactList) {
        if (contact.person_id != null) {
            const updateResult = await client.query(
                `UPDATE tbl_party_contact_person SET name = $1, email = $2, phone = $3
                WHERE person_id = $4 AND party_id = $5 AND company_id = $6 AND is_deleted = FALSE RETURNING *`,
                [
                    contact.name,
                    contact.email ?? null,
                    contact.phone ?? null,
                    contact.person_id,
                    partyId,
                    companyId
                ]
            );

            if (updateResult.rowCount === 0) {
                throw new Error(`Contact person ${contact.person_id} not found`);
            }
            savedContacts.push(updateResult.rows[0]);
        }

        else {
            const insertResult = await client.query(
                `INSERT INTO tbl_party_contact_person(party_id, name, email, phone, company_id, user_id)
                VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
                [
                    partyId,
                    contact.name ?? "Main Contact",
                    contact.email ?? null,
                    contact.phone ?? null,
                    companyId,
                    userId
                ]
            );

            savedContacts.push(insertResult.rows[0]);
        }
    }
    return savedContacts;
}