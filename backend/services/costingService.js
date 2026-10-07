// services/costingService.js
//
// The one place that keeps tbl_project_costs.actual_amount and
// tbl_project.actual_cost in sync with what's actually been logged.
// Must be called inside the caller's transaction (pass its `client`).

export function computeManpowerCost({ headcount, regular_hours, overtime_hours, rate_per_hour, ot_rate_per_hour }) {
    const otRate = ot_rate_per_hour != null ? Number(ot_rate_per_hour) : Number(rate_per_hour) * 1.5;
    const perHead = Number(regular_hours) * Number(rate_per_hour) + Number(overtime_hours) * otRate;
    return { otRate, totalCost: Math.round(perHead * Number(headcount) * 100) / 100 };
}

export function computeEquipmentCost({ hours_used, rate_per_hour, fuel_cost }) {
    return Math.round((Number(hours_used) * Number(rate_per_hour) + Number(fuel_cost || 0)) * 100) / 100;
}

/**
 * Recomputes tbl_project_costs.actual_amount for one category from its source
 * log table, then recomputes tbl_project.actual_cost as the sum across every
 * category. Category -> table is fixed on purpose: this function only knows
 * about the two costed-by-log categories, not material/subcontract/other.
 */
export async function recalcProjectCost(client, { projectId, companyId, category }) {
    const table = { labour: "tbl_project_manpower_log", equipment: "tbl_project_equipment_log" }[category];
    if (!table) throw new Error(`recalcProjectCost: unsupported category '${category}'`);

    const sum = await client.query(
        `SELECT COALESCE(SUM(total_cost), 0) AS total FROM ${table}
          WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [projectId, companyId]
    );
    const actual = sum.rows[0].total;

    await client.query(
        `INSERT INTO tbl_project_costs (project_id, category, actual_amount, company_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (project_id, category)
         DO UPDATE SET actual_amount = EXCLUDED.actual_amount, updated_at = CURRENT_TIMESTAMP`,
        [projectId, category, actual, companyId]
    );

    const total = await client.query(
        `SELECT COALESCE(SUM(actual_amount), 0) AS total FROM tbl_project_costs
          WHERE project_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
        [projectId, companyId]
    );
    await client.query(
        `UPDATE tbl_project SET actual_cost = $3, updated_at = CURRENT_TIMESTAMP
          WHERE project_id = $1 AND company_id = $2`,
        [projectId, companyId, total.rows[0].total]
    );

    return { category_actual: actual, project_actual_cost: total.rows[0].total };
}
