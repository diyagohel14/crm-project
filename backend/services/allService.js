//services/allService.js
import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";

/**
 * Soft-deletes a row (sets is_deleted = TRUE, plus any extra columns in setData).
 */
export async function deleteModule(client, table, table_id, id, whereData = {}, setData = {}) {
    const values = [id];

    let setQuery = `is_deleted = TRUE`;
    let paramIndex = 2;

    for (const [column, value] of Object.entries(setData)) {
        setQuery += `, ${column} = $${paramIndex}`;
        values.push(value);
        paramIndex++;
    }

    let whereQuery = `${table_id} = $1`;
    for (const [column, value] of Object.entries(whereData)) {
        whereQuery += ` AND ${column} = $${paramIndex}`;
        values.push(value);
        paramIndex++;
    }

    const query = `
        UPDATE ${table}
        SET ${setQuery}
        WHERE ${whereQuery}
        RETURNING *
    `;
    const result = await client.query(query, values);

    return { result: result.rows };
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Number(v) if finite, else `fallback`. Shared by every document controller
 *  for coercing client-supplied numeric fields (tax %, taxable_amount, ...). */
export const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};


/**
 * @param {Array} itemsDetails - line items from the request body
 * @param {object} payload - the document-level request body (for
 *   discount_type/discount_value, shipping_charges, round_off, paid_amount) discount_type:string|null,
 * @returns {{ items: object[], subtotal_amount:number, 
 *   discount_value:number, total_tax_amount:number, shipping_charges:number,
 *   round_off:number, total_amount:number, paid_amount:number, balance_due:number }}
 */
export function priceCalculation(itemsDetails, payload = {}) {
    if (!Array.isArray(itemsDetails) || itemsDetails.length === 0) {
        throw Object.assign(new Error("At least one item is required"), { status: 400 });
    }

    const pricedItems = itemsDetails.map((it, idx) => {
        const quantity = num(it.quantity, NaN);
        const unitRate = num(it.unit_rate, NaN);

        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw Object.assign(new Error(`Item #${idx + 1}: quantity must be a positive number`), { status: 400 });
        }
        if (!Number.isFinite(unitRate) || unitRate < 0) {
            throw Object.assign(new Error(`Item #${idx + 1}: unit_rate must be a non-negative number`), { status: 400 });
        }

        const grossAmount = round2(quantity * unitRate);

        const discountPercent = num(it.discount_percent, 0);
        const discountFlat = num(it.discount_flat, 0);
        const discountAmount = discountFlat > 0
            ? round2(discountFlat)
            : round2(grossAmount * (discountPercent / 100));

        const taxableAmount = round2(Math.max(grossAmount - discountAmount, 0));

        const taxPercent = num(it.tax_percent, 0);
        const taxAmount = round2(taxableAmount * (taxPercent / 100));

        const lineTotal = round2(taxableAmount + taxAmount);

        return {
            item_id: it.item_id || null,
            description: it.description || null,
            quantity,
            hsn_code: it.hsn_code || null,
            unit_id: it.unit_id || null,
            unit_rate: unitRate,
            total_rate: grossAmount,
            discount_percent: discountPercent,
            discount_flat: discountAmount,
            tax_percent: taxPercent,
            tax_amount: taxAmount,
            total_amount: lineTotal,
        };
    });

    const subtotalAmount = round2(pricedItems.reduce((sum, it) => sum + it.total_rate, 0));
    const itemsTaxAmount = round2(pricedItems.reduce((sum, it) => sum + it.tax_amount, 0));
    const discountValue = round2(pricedItems.reduce((sum, it) => sum + it.discount_flat, 0));

    // const discountType = payload.discount_type === 'percentage' || payload.discount_type === 'flat'
    //     ? payload.discount_type
    //     : null;
    // const discountValue = num(payload.discount_value, 0);
    // const documentDiscount = discountType === 'percentage'
    //     ? round2(subtotalAmount * (discountValue / 100))
    //     : discountType === 'flat'
    //         ? round2(discountValue)
    //         : 0;

    const shippingCharges = round2(num(payload.shipping_charges, 0));
    const roundOff = round2(num(payload.round_off, 0));
    const paidAmount = round2(num(payload.paid_amount, 0));

    const totalAmount = round2(
        subtotalAmount - discountValue + itemsTaxAmount + shippingCharges + roundOff
    );
    const balanceDue = round2(totalAmount - paidAmount);

    return {
        items: pricedItems,
        subtotal_amount: subtotalAmount,
        // discount_type: discountType,
        discount_value: discountValue,
        total_tax_amount: itemsTaxAmount,
        shipping_charges: shippingCharges,
        round_off: roundOff,
        total_amount: totalAmount,
        paid_amount: paidAmount,
        balance_due: balanceDue,
    };
}
