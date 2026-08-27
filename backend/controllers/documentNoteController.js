import { getCompanyPool } from "../config/companyPoolManager.js";
import { getNextSeries } from "../services/seriesService.js";
import { priceCalculation, num } from "../services/allService.js";
import { getRequestInfo } from "../utils/crypto.js";
import { logAudit } from "../services/authService.js";

const STATUS_TRANSITIONS = {
    draft: ["issued"],
    issued: ["applied"],
    applied: [],
};

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function itemSourceId(item, sourceItemId) {
    return item?.[sourceItemId] ?? item?.source_item_id;
}

export function createDocumentNoteController({
    kind,
    documentTypeId,
    table,
    itemTable,
    taxTable,
    noteIdColumn,
    noteNoColumn,
    dateColumn,
    sourceTable,
    sourceIdColumn,
    sourceItemTable,
    sourceItemIdColumn,
    permissionPrefix,
}) {
    const label = kind === "credit" ? "Credit Note" : "Debit Note";
    const itemIdField = kind === "credit" ? "invoice_item_id" : "purchase_invoice_item_id";

    async function loadNote(client, noteId, companyId, forUpdate = false) {
        const lock = forUpdate ? " FOR UPDATE" : "";
        const result = await client.query(`
            SELECT n.*,
                COALESCE((SELECT json_agg(i ORDER BY i.${itemTable === "credit_note_items" ? "credit_note_item_id" : "debit_note_item_id"})
                    FROM ${itemTable} i
                    WHERE i.${noteIdColumn} = n.${noteIdColumn} AND i.company_id = n.company_id AND i.is_deleted = FALSE), '[]'::json) AS "itemsDetails",
                COALESCE((SELECT json_agg(t ORDER BY t.tax_detail_id)
                    FROM ${taxTable} t
                    WHERE t.${noteIdColumn} = n.${noteIdColumn} AND t.is_deleted = FALSE), '[]'::json) AS "taxDetails"
            FROM ${table} n
            WHERE n.${noteIdColumn} = $1 AND n.company_id = $2 AND n.is_deleted = FALSE${lock}`,
            [noteId, companyId]
        );
        return result.rows[0] || null;
    }

    async function validateSource(client, payload, companyId) {
        if (!payload[sourceIdColumn]) throw badRequest(`${sourceIdColumn} is required`);
        const sourceResult = await client.query(
            `SELECT ${sourceIdColumn}, party_id, total_amount FROM ${sourceTable}
             WHERE ${sourceIdColumn} = $1 AND company_id = $2 AND is_deleted = FALSE FOR SHARE`,
            [payload[sourceIdColumn], companyId]
        );
        const source = sourceResult.rows[0];
        if (!source) throw Object.assign(new Error(`${label} source document not found`), { status: 404 });
        if (payload.party_id && Number(payload.party_id) !== Number(source.party_id)) {
            throw badRequest("party_id must match the source document party");
        }
        return source;
    }

    async function validateReason(client, reasonId, companyId) {
        if (!reasonId) return;
        const result = await client.query(
            `SELECT reason_id FROM cr_dr_reason_mst
                         WHERE reason_id = $1 AND company_id = $2 AND form_type = $3
                             AND status = 'active' AND is_deleted = FALSE`,
            [reasonId, companyId, kind]
        );
        if (!result.rows.length) throw badRequest(`Invalid active ${kind} note reason`);
    }

    async function validateSourceItems(client, payload, companyId) {
        const items = Array.isArray(payload.itemsDetails) ? payload.itemsDetails : [];
        if (!items.length) throw badRequest("At least one source item is required");

        const sourceItemIds = items.map(item => itemSourceId(item, itemIdField));
        if (sourceItemIds.some(id => !Number.isInteger(Number(id)))) {
            throw badRequest(`Each note item must include ${itemIdField}`);
        }
        const result = await client.query(
            `SELECT ${sourceItemIdColumn}, item_id FROM ${sourceItemTable}
                         WHERE ${sourceItemIdColumn} = ANY($1::int[]) AND ${sourceIdColumn} = $2
                             AND company_id = $3 AND is_deleted = FALSE`,
            [sourceItemIds.map(Number), payload[sourceIdColumn], companyId]
        );
        const validIds = new Set(result.rows.map(row => Number(row[sourceItemIdColumn])));
        if (sourceItemIds.some(id => !validIds.has(Number(id)))) {
            throw badRequest("One or more note items do not belong to the source document");
        }
        return items;
    }

    async function ensureWithinSourceLimit(client, source, companyId, noteId = null, amount = 0) {
        const usedResult = await client.query(
            `SELECT COALESCE(SUM(total_amount), 0) AS used_amount FROM ${table}
             WHERE ${sourceIdColumn} = $1 AND company_id = $2 AND status IN ('issued', 'applied')
               AND is_deleted = FALSE${noteId ? ` AND ${noteIdColumn} <> $3` : ""}`,
            noteId ? [source[sourceIdColumn], companyId, noteId] : [source[sourceIdColumn], companyId]
        );
        const used = Number(usedResult.rows[0].used_amount || 0);
        if (used + Number(amount) > Number(source.total_amount || 0) + 0.005) {
            throw badRequest(`${label} total exceeds the remaining source document amount`);
        }
    }

    async function writeChildren(client, noteId, payload, items, userId, companyId) {
        const priced = priceCalculation(items, payload);
        const noteItems = [];
        const insertedItemIds = [];
        const itemSql = `INSERT INTO ${itemTable} (
            ${noteIdColumn}, ${itemIdField}, item_id, description, quantity, hsn_code, unit_id, unit_rate,
            total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount, user_id, company_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`;

        for (let index = 0; index < priced.items.length; index += 1) {
            const item = priced.items[index];
            const input = items[index];
            const result = await client.query(itemSql, [
                noteId, Number(itemSourceId(input, itemIdField)), item.item_id, item.description, item.quantity,
                item.hsn_code, item.unit_id, item.unit_rate, item.total_rate, item.discount_percent,
                item.discount_flat, item.tax_percent, item.tax_amount, item.total_amount, userId, companyId
            ]);
            noteItems.push(result.rows[0]);
            insertedItemIds.push(result.rows[0][kind === "credit" ? "credit_note_item_id" : "debit_note_item_id"]);
        }

        const taxDetails = priced.taxDetails;
        const taxItems = [];
        const taxSql = `INSERT INTO ${taxTable} (
            ${noteIdColumn}, ${kind === "credit" ? "credit_note_item_id" : "debit_note_item_id"}, tax_id,
            taxable_amount, tax_percentage, tax_amount, is_deleted
        ) VALUES ($1,$2,$3,$4,$5,$6,FALSE) RETURNING *`;
        for (const tax of taxDetails) {
            const index = Number(tax[`${kind}_note_item_index`]);
            const itemId = Number.isInteger(index) && insertedItemIds[index] !== undefined
                ? insertedItemIds[index]
                : (insertedItemIds.includes(Number(tax[`${kind}_note_item_id`])) ? Number(tax[`${kind}_note_item_id`]) : null);
            const result = await client.query(taxSql, [
                noteId, itemId, tax.tax_id || null, num(tax.taxable_amount, null),
                num(tax.tax_percentage, null), num(tax.tax_amount, null)
            ]);
            taxItems.push(result.rows[0]);
        }
        return { priced, noteItems, taxItems };
    }

    async function updateChildren(client, noteId, payload, items, existing, userId, companyId) {
        const priced = priceCalculation(items, payload);
        const childIdColumn = kind === "credit" ? "credit_note_item_id" : "debit_note_item_id";
        const existingItems = existing.itemsDetails || [];
        const existingById = new Map(existingItems.map(item => [Number(item[childIdColumn]), item]));
        const usedItemIds = new Set();
        const noteItems = [];

        const itemColumns = `
            ${itemIdField}=$1, item_id=$2, description=$3, quantity=$4, hsn_code=$5, unit_id=$6,
            unit_rate=$7, total_rate=$8, discount_percent=$9, discount_flat=$10, tax_percent=$11,
            tax_amount=$12, total_amount=$13, user_id=$14, updated_at=CURRENT_TIMESTAMP`;

        for (let index = 0; index < priced.items.length; index += 1) {
            const item = priced.items[index];
            const input = items[index];
            const requestedId = Number(input[childIdColumn]);
            const hasRequestedId = Number.isInteger(requestedId) && requestedId > 0;
            const current = hasRequestedId ? existingById.get(requestedId) : existingItems[index];
            const values = [
                Number(itemSourceId(input, itemIdField)), item.item_id, item.description, item.quantity,
                item.hsn_code, item.unit_id, item.unit_rate, item.total_rate, item.discount_percent,
                item.discount_flat, item.tax_percent, item.tax_amount, item.total_amount, userId
            ];

            let result;
            if (current && !usedItemIds.has(Number(current[childIdColumn]))) {
                usedItemIds.add(Number(current[childIdColumn]));
                result = await client.query(
                    `UPDATE ${itemTable} SET ${itemColumns}
                     WHERE ${childIdColumn}=$15 AND ${noteIdColumn}=$16 AND company_id=$17
                       AND is_deleted=FALSE RETURNING *`,
                    [...values, current[childIdColumn], noteId, companyId]
                );
            } else {
                result = await client.query(`INSERT INTO ${itemTable} (
                    ${noteIdColumn}, ${itemIdField}, item_id, description, quantity, hsn_code, unit_id, unit_rate,
                    total_rate, discount_percent, discount_flat, tax_percent, tax_amount, total_amount, user_id, company_id
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
                    [noteId, ...values, companyId]);
            }
            noteItems.push(result.rows[0]);
        }

        const activeItemIds = noteItems.map(item => Number(item[childIdColumn]));
        const removedItemIds = existingItems
            .map(item => Number(item[childIdColumn]))
            .filter(id => !activeItemIds.includes(id));
        if (removedItemIds.length) {
            await client.query(
                `UPDATE ${itemTable} SET is_deleted=TRUE, updated_at=CURRENT_TIMESTAMP
                 WHERE ${noteIdColumn}=$1 AND company_id=$2 AND ${childIdColumn}=ANY($3::int[])`,
                [noteId, companyId, removedItemIds]
            );
        }

        const taxDetails = priced.taxDetails;
        const existingTaxes = existing.taxDetails || [];
        const usedTaxIds = new Set();
        const taxItems = [];
        for (let index = 0; index < taxDetails.length; index += 1) {
            const tax = taxDetails[index];
            const itemIndex = Number(tax[`${kind}_note_item_index`]);
            const linkedItemId = Number.isInteger(itemIndex) && noteItems[itemIndex]
                ? noteItems[itemIndex][childIdColumn]
                : (activeItemIds.includes(Number(tax[`${kind}_note_item_id`])) ? Number(tax[`${kind}_note_item_id`]) : null);
            const requestedTaxId = Number(tax.tax_detail_id);
            const hasRequestedTaxId = Number.isInteger(requestedTaxId) && requestedTaxId > 0;
            const current = hasRequestedTaxId
                ? existingTaxes.find(row => Number(row.tax_detail_id) === requestedTaxId)
                : existingTaxes[index];
            const values = [
                linkedItemId, tax.tax_id || null, num(tax.taxable_amount, null),
                num(tax.tax_percentage, null), num(tax.tax_amount, null)
            ];
            let result;
            if (current && !usedTaxIds.has(Number(current.tax_detail_id))) {
                usedTaxIds.add(Number(current.tax_detail_id));
                result = await client.query(`UPDATE ${taxTable} SET
                    ${kind === "credit" ? "credit_note_item_id" : "debit_note_item_id"}=$1,
                    tax_id=$2, taxable_amount=$3, tax_percentage=$4, tax_amount=$5, is_deleted=FALSE
                    WHERE tax_detail_id=$6 AND ${noteIdColumn}=$7 RETURNING *`,
                    [...values, current.tax_detail_id, noteId]);
            } else {
                result = await client.query(`INSERT INTO ${taxTable} (
                    ${noteIdColumn}, ${kind === "credit" ? "credit_note_item_id" : "debit_note_item_id"},
                    tax_id, taxable_amount, tax_percentage, tax_amount, is_deleted
                ) VALUES ($1,$2,$3,$4,$5,$6,FALSE) RETURNING *`, [noteId, ...values]);
            }
            taxItems.push(result.rows[0]);
        }

        const activeTaxIds = taxItems.map(tax => Number(tax.tax_detail_id));
        const removedTaxIds = existingTaxes
            .map(tax => Number(tax.tax_detail_id))
            .filter(id => !activeTaxIds.includes(id));
        if (removedTaxIds.length) {
            await client.query(
                `UPDATE ${taxTable} SET is_deleted=TRUE
                 WHERE ${noteIdColumn}=$1 AND tax_detail_id=ANY($2::int[])`,
                [noteId, removedTaxIds]
            );
        }
        return { priced, noteItems, taxItems };
    }

    async function getNotes(req, res) {
        const { companyId } = req.session.user;
        const companyPool = await getCompanyPool(companyId);
        try {
            const noteId = req.params.noteId;
            const result = await companyPool.query(`
                SELECT n.*,
                    COALESCE((SELECT json_agg(i ORDER BY i.${itemTable === "credit_note_items" ? "credit_note_item_id" : "debit_note_item_id"})
                        FROM ${itemTable} i WHERE i.${noteIdColumn} = n.${noteIdColumn} AND i.company_id = n.company_id AND i.is_deleted = FALSE), '[]'::json) AS "itemsDetails",
                    COALESCE((SELECT json_agg(t ORDER BY t.tax_detail_id)
                        FROM ${taxTable} t WHERE t.${noteIdColumn} = n.${noteIdColumn} AND t.is_deleted = FALSE), '[]'::json) AS "taxDetails"
                FROM ${table} n
                WHERE n.company_id = $1 AND n.is_deleted = FALSE${noteId ? ` AND n.${noteIdColumn} = $2` : ""}
                ORDER BY n.${noteNoColumn} ASC`, noteId ? [companyId, noteId] : [companyId]);
            if (noteId && !result.rows.length) return res.status(404).json({ error: `${label} not found` });
            return res.status(200).json({ message: `${label} fetch successfully`, notes: result.rows });
        } catch (err) {
            console.error(`[get${label.replaceAll(" ", "")}]`, err);
            return res.status(500).json({ error: `Failed to fetch ${label}`, details: err.message });
        }
    }

    async function createNote(req, res) {
        const { companyId, userId, roleId, financialYearId } = req.session.user;
        const client = await (await getCompanyPool(companyId)).connect();
        const { ipAddress, deviceInfo } = getRequestInfo(req);
        try {
            const payload = req.body || {};
            if (!payload.party_id) throw badRequest("party_id is required");
            if (!payload[dateColumn]) throw badRequest(`${dateColumn} is required`);
            if (payload.status && payload.status !== "draft") throw badRequest("New notes must start in draft status");
            await client.query("BEGIN");
            const source = await validateSource(client, payload, companyId);
            await validateReason(client, payload.reason_id, companyId);
            const items = await validateSourceItems(client, payload, companyId);
            const noteSeries = await getNextSeries(client, { documentTypeId, companyId, userId, financialYearId, client });
            const priced = priceCalculation(items, { round_off: payload.round_off });
            const noteResult = await client.query(`INSERT INTO ${table} (
                ${noteNoColumn}, ${dateColumn}, ${sourceIdColumn}, party_id, reason_id, subtotal_amount,
                discount_value, total_tax_amount, round_off, total_amount, notes, status, user_id, company_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$13) RETURNING *`, [
                noteSeries.series, payload[dateColumn], source[sourceIdColumn], source.party_id, payload.reason_id || null,
                priced.subtotal_amount, priced.discount_value, priced.total_tax_amount, priced.round_off,
                priced.total_amount, payload.notes || null, userId, companyId
            ]);
            const children = await writeChildren(client, noteResult.rows[0][noteIdColumn], payload, items, userId, companyId);
            await logAudit(client, {
                module_name: label, page_name: `Create ${label}`, table_name: table,
                table_id: noteResult.rows[0][noteIdColumn], action_type: "CREATE",
                action_description: `${label} created: ${noteSeries.series}`,
                new_value: JSON.stringify(noteResult.rows[0]), user_id: userId, role_id: roleId,
                ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
            });
            await client.query("COMMIT");
            return res.status(201).json({ success: true, message: `${label} created`, note: noteResult.rows[0], itemsDetails: children.noteItems, taxDetails: children.taxItems });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => { });
            console.error(`[create${label.replaceAll(" ", "")}]`, err);
            const status = err.status || 500;
            return res.status(status).json({ success: false, error: status === 400 || status === 404 ? err.message : `Failed to create ${label}`, details: err.message });
        } finally {
            client.release();
        }
    }

    async function updateNote(req, res) {
        const { companyId, userId, roleId } = req.session.user;
        const { noteId } = req.params;
        const client = await (await getCompanyPool(companyId)).connect();
        const { ipAddress, deviceInfo } = getRequestInfo(req);
        try {
            const payload = req.body || {};
            if (!payload.party_id) throw badRequest("party_id is required");
            if (!payload[dateColumn]) throw badRequest(`${dateColumn} is required`);
            await client.query("BEGIN");
            const existing = await loadNote(client, noteId, companyId, true);
            if (!existing) { await client.query("ROLLBACK"); return res.status(404).json({ error: `${label} not found` }); }
            if (existing.status !== "draft") throw badRequest(`${label} can only be updated while in draft status`);
            const source = await validateSource(client, payload, companyId);
            await validateReason(client, payload.reason_id, companyId);
            const items = await validateSourceItems(client, payload, companyId);
            const priced = priceCalculation(items, { round_off: payload.round_off });
            const result = await client.query(`UPDATE ${table} SET ${dateColumn}=$1, party_id=$2, reason_id=$3,
                subtotal_amount=$4, discount_value=$5, total_tax_amount=$6, round_off=$7, total_amount=$8,
                notes=$9, updated_at=CURRENT_TIMESTAMP WHERE ${noteIdColumn}=$10 AND company_id=$11 AND is_deleted=FALSE RETURNING *`, [
                payload[dateColumn], source.party_id, payload.reason_id || null, priced.subtotal_amount,
                priced.discount_value, priced.total_tax_amount, priced.round_off, priced.total_amount,
                payload.notes || null, noteId, companyId
            ]);
            const children = await updateChildren(client, noteId, payload, items, existing, userId, companyId);
            await logAudit(client, {
                module_name: label, page_name: `Update ${label}`, table_name: table, table_id: noteId,
                action_type: "UPDATE", action_description: `${label} updated`, new_value: JSON.stringify(result.rows[0]),
                user_id: userId, role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
            });
            await client.query("COMMIT");
            return res.status(200).json({ success: true, message: `${label} updated`, note: result.rows[0], itemsDetails: children.noteItems, taxDetails: children.taxItems });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => { });
            const status = err.status || 500;
            return res.status(status).json({ success: false, error: status === 400 || status === 404 ? err.message : `Failed to update ${label}`, details: err.message });
        } finally { client.release(); }
    }

    async function deleteNote(req, res) {
        const { companyId } = req.session.user;
        const { noteId } = req.params;
        const client = await (await getCompanyPool(companyId)).connect();
        try {
            await client.query("BEGIN");
            const note = await loadNote(client, noteId, companyId, true);
            if (!note) { await client.query("ROLLBACK"); return res.status(404).json({ error: `${label} not found` }); }
            if (note.status !== "draft") throw badRequest(`${label} can only be deleted while in draft status`);
            await client.query(`UPDATE ${table} SET is_deleted=TRUE, updated_at=CURRENT_TIMESTAMP WHERE ${noteIdColumn}=$1 AND company_id=$2`, [noteId, companyId]);
            await client.query(`UPDATE ${itemTable} SET is_deleted=TRUE WHERE ${noteIdColumn}=$1 AND company_id=$2`, [noteId, companyId]);
            await client.query(`UPDATE ${taxTable} SET is_deleted=TRUE WHERE ${noteIdColumn}=$1`, [noteId]);
            await client.query("COMMIT");
            return res.status(200).json({ success: true, message: `${label} deleted`, note });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => { });
            const status = err.status || 500;
            return res.status(status).json({ success: false, error: status === 400 ? err.message : `Failed to delete ${label}`, details: err.message });
        } finally { client.release(); }
    }

    async function changeStatus(req, res) {
        const { companyId, userId, roleId } = req.session.user;
        const { noteId, status } = req.params;
        const client = await (await getCompanyPool(companyId)).connect();
        const { ipAddress, deviceInfo } = getRequestInfo(req);
        try {
            await client.query("BEGIN");
            const note = await loadNote(client, noteId, companyId, true);
            if (!note) { await client.query("ROLLBACK"); return res.status(404).json({ error: `${label} not found` }); }
            if (!STATUS_TRANSITIONS[note.status]?.includes(status)) throw badRequest(`${label} status cannot change from '${note.status}' to '${status}'`);
            if (status === "issued") {
                const sourceResult = await client.query(`SELECT ${sourceIdColumn}, total_amount FROM ${sourceTable} WHERE ${sourceIdColumn}=$1 AND company_id=$2 AND is_deleted=FALSE FOR SHARE`, [note[sourceIdColumn], companyId]);
                await ensureWithinSourceLimit(client, sourceResult.rows[0], companyId, noteId, note.total_amount);
            }
            const result = await client.query(`UPDATE ${table} SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE ${noteIdColumn}=$2 AND company_id=$3 AND is_deleted=FALSE RETURNING *`, [status, noteId, companyId]);
            await logAudit(client, {
                module_name: label, page_name: `${label} Status`, table_name: table, table_id: noteId,
                action_type: "STATUS_CHANGE", action_description: `${label} status changed from ${note.status} to ${status}`,
                old_value: JSON.stringify(note), new_value: JSON.stringify(result.rows[0]), user_id: userId,
                role_id: roleId, ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
            });
            await client.query("COMMIT");
            return res.status(200).json({ success: true, message: `${label} status changed`, note: result.rows[0] });
        } catch (err) {
            await client.query("ROLLBACK").catch(() => { });
            const statusCode = err.status || 500;
            return res.status(statusCode).json({ success: false, error: statusCode === 400 ? err.message : `Failed to change ${label} status`, details: err.message });
        } finally { client.release(); }
    }

    return { getNotes, createNote, updateNote, deleteNote, changeStatus, permissionPrefix };
}
