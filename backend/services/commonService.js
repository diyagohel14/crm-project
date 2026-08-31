//services/commonService.js
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

export async function priceCalculationFromDatabase(client, itemsDetails, payload = {}, applicableOn = null) {
    const taxDetails = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];
    const taxIds = [...new Set(taxDetails.map(tax => Number(tax.tax_id)).filter(Number.isInteger))];
    if (taxDetails.some(tax => !Number.isInteger(Number(tax.tax_id)))) {
        throw Object.assign(new Error("Each selected tax must include a valid tax_id"), { status: 400 });
    }
    if (!taxIds.length) return priceCalculation(itemsDetails, payload);

    const result = await client.query(
        `SELECT tax_id, tax_name, tax_percentage, tax_type, applicable_on
         FROM tax_types
         WHERE tax_id = ANY($1::int[]) AND status = 'active' AND is_deleted = FALSE`,
        [taxIds]
    );
    const taxesById = new Map(result.rows.map(tax => [Number(tax.tax_id), tax]));
    if (taxesById.size !== taxIds.length) {
        throw Object.assign(new Error("One or more selected taxes are invalid or inactive"), { status: 400 });
    }
    const invalidScope = result.rows.some(tax => applicableOn && tax.applicable_on !== applicableOn && tax.applicable_on !== "both");
    if (invalidScope) {
        throw Object.assign(new Error(`Selected tax is not applicable to ${applicableOn} documents`), { status: 400 });
    }

    return priceCalculation(itemsDetails, {
        ...payload,
        taxDetails: taxDetails.map(tax => ({ ...tax, ...taxesById.get(Number(tax.tax_id)) })),
    });
}


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

    const selectedTaxes = Array.isArray(payload.taxDetails) ? payload.taxDetails : [];
    const itemIdFields = [
        "invoice_item_id", "purchase_invoice_item_id", "purchase_order_item_id",
        "quotation_item_id", "proforma_item_id", "sales_order_item_id", "delivery_challan_item_id",
        "credit_note_item_id", "debit_note_item_id",
    ];
    const getTaxItemIndex = (tax) => {
        for (const field of itemIdFields) {
            const indexValue = tax[`${field.replace("_id", "_index")}`];
            if (indexValue !== undefined && indexValue !== null && indexValue !== "") {
                const index = Number(indexValue);
                if (Number.isInteger(index) && index >= 0 && index < itemsDetails.length) return index;
            }
            const itemId = Number(tax[field]);
            if (Number.isInteger(itemId)) {
                const index = itemsDetails.findIndex(item => Number(item[field]) === itemId);
                if (index >= 0) return index;
            }
        }
        return null;
    };

    const selectedTaxByItem = new Map();
    for (const tax of selectedTaxes) {
        const itemIndex = getTaxItemIndex(tax);
        if (itemIndex === null) continue;
        const taxType = tax.tax_type || "percentage";
        const taxValue = num(tax.tax_percentage, NaN);
        if (!["percentage", "fixed"].includes(taxType) || !Number.isFinite(taxValue) || taxValue < 0
            || (taxType === "percentage" && taxValue > 100)) {
            throw Object.assign(new Error("Selected tax type or value is invalid"), { status: 400 });
        }
        const itemTaxes = selectedTaxByItem.get(itemIndex) || [];
        itemTaxes.push({ tax, taxType, taxValue });
        selectedTaxByItem.set(itemIndex, itemTaxes);
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
        if (discountPercent < 0 || discountPercent > 100) {
            throw Object.assign(new Error(`Item #${idx + 1}: discount_percent must be between 0 and 100`), { status: 400 });
        }
        if (discountFlat < 0) {
            throw Object.assign(new Error(`Item #${idx + 1}: discount_flat cannot be negative`), { status: 400 });
        }
        const discountAmount = discountFlat > 0
            ? round2(Math.min(discountFlat, grossAmount))
            : round2(grossAmount * (discountPercent / 100));

        const taxableAmount = round2(Math.max(grossAmount - discountAmount, 0));

        const selectedItemTaxes = selectedTaxByItem.get(idx) || [];
        const percentageTaxes = selectedItemTaxes.filter(tax => tax.taxType === "percentage");
        const fixedTaxes = selectedItemTaxes.filter(tax => tax.taxType === "fixed");
        const taxPercent = percentageTaxes.length
            ? round2(percentageTaxes.reduce((sum, tax) => sum + tax.taxValue, 0))
            : (fixedTaxes.length ? 0 : num(it.tax_percent, 0));
        if (taxPercent < 0 || taxPercent > 100) {
            throw Object.assign(new Error(`Item #${idx + 1}: tax_percent must be between 0 and 100`), { status: 400 });
        }
        const taxAmount = round2(
            taxableAmount * (taxPercent / 100)
            + fixedTaxes.reduce((sum, tax) => sum + tax.taxValue, 0)
        );

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
    if (shippingCharges < 0) {
        throw Object.assign(new Error("shipping_charges cannot be negative"), { status: 400 });
    }
    const roundOff = round2(num(payload.round_off, 0));
    const paidAmount = round2(num(payload.paid_amount, 0));

    const totalAmount = round2(
        subtotalAmount - discountValue + itemsTaxAmount + shippingCharges + roundOff
    );
    const balanceDue = round2(totalAmount - paidAmount);

    const calculatedTaxDetails = selectedTaxes.map(tax => {
        const itemIndex = getTaxItemIndex(tax);
        const selectedItemTaxes = itemIndex === null ? [] : selectedTaxByItem.get(itemIndex) || [];
        const selectedTax = selectedItemTaxes.find(entry => entry.tax === tax);
        const taxableAmount = itemIndex === null ? num(tax.taxable_amount, 0) : pricedItems[itemIndex].total_rate - pricedItems[itemIndex].discount_flat;
        const taxType = selectedTax?.taxType || tax.tax_type || "percentage";
        const taxValue = selectedTax?.taxValue ?? num(tax.tax_percentage, 0);
        return {
            ...tax,
            taxable_amount: round2(Math.max(taxableAmount, 0)),
            tax_type: taxType,
            tax_percentage: taxType === "percentage" ? taxValue : null,
            tax_amount: taxType === "fixed"
                ? round2(taxValue)
                : round2(Math.max(taxableAmount, 0) * (taxValue / 100)),
        };
    });

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
        taxDetails: calculatedTaxDetails,
    };
}
