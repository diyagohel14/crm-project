// services/seriesService.js
// Helper to generate and atomically increment document series numbers.

/**
 * Get the next series value for a given document type and company.
 * Ensures atomic increment using a DB transaction and SELECT FOR UPDATE.
 *
 * @param {Pool} pool - a `pg` Pool connected to the company database (or admin DB if series stored there)
 * @param {object} opts
 * @param {import('pg').PoolClient|null} [opts.client] - existing client to reuse inside an active transaction
 * @param {number} opts.documentTypeId - FK to `document_type` (required)
 * @param {number} opts.companyId - company id (required)
 * @param {number} opts.userId - user id (required)
 * @param {number|null} [opts.financialYearId] - optional financial year partition, use null for no FY
 * @param {string|null} [opts.prefix] - optional override prefix when creating a new series
 * @param {string|null} [opts.postfix] - optional override postfix when creating a new series
 * @param {number} [opts.paddingLength] - digits to pad the numeric part (default: 5)
 *
 * @returns {{ sequenceId:number, number:number, series:string }}
 */
export async function getNextSeries(pool, opts) {
  const {
    documentTypeId,
    companyId,
    userId,
    financialYearId = null,
    prefix: overridePrefix = null,
    postfix: overridePostfix = null,
    paddingLength: overridePadding = 5,
    client: existingClient = null,
  } = opts;

  if (!documentTypeId) throw new Error('documentTypeId is required');
  if (!companyId) throw new Error('companyId is required');
  if (!userId) throw new Error('userId is required for new series creation');
  
  const client = existingClient ?? await pool.connect();
  const ownsClient = !existingClient;
  try {
    if (ownsClient) {
      await client.query('BEGIN');
    }

    let selectSql;
    let selectParams;
    if (financialYearId == null) {
      selectSql = `SELECT sequence_id, current_number, prefix, postfix, padding_length
                   FROM document_series
                  WHERE document_type_id = $1 AND company_id = $2 AND financial_year_id IS NULL AND status = 'active' AND is_deleted = FALSE
                  FOR UPDATE`;
      selectParams = [documentTypeId, companyId];
    } else {
      selectSql = `SELECT sequence_id, current_number, prefix, postfix, padding_length
                   FROM document_series
                  WHERE document_type_id = $1 AND company_id = $2 AND financial_year_id = $3 AND status = 'active' AND is_deleted = FALSE
                  FOR UPDATE`;
      selectParams = [documentTypeId, companyId, financialYearId];
    }

    const sel = await client.query(selectSql, selectParams);

    let row;
    if (sel.rows && sel.rows.length > 0) {
      row = sel.rows[0];
      const newNumber = Number(row.current_number || 0) + 1;
      await client.query('UPDATE document_series SET current_number = $1 WHERE sequence_id = $2', [newNumber, row.sequence_id]);
      row.current_number = newNumber;
    } else {
      // create a new series row (first number = 1)
      const initNumber = 1;
      const prefix = overridePrefix ?? '';
      const postfix = overridePostfix ?? '';
      const padding = overridePadding ?? 5;

      const insertSql = `INSERT INTO document_series
        (document_type_id, prefix, postfix, current_number, financial_year_id, padding_length, status, company_id, user_id)
        VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)
        RETURNING sequence_id, current_number, prefix, postfix, padding_length`;
      const insertParams = [documentTypeId, prefix, postfix, initNumber, financialYearId, padding, companyId, userId];
      const ins = await client.query(insertSql, insertParams);
      row = ins.rows[0];
    }

    if (ownsClient) {
      await client.query('COMMIT');
    }

    const pad = row.padding_length ?? overridePadding ?? 5;
    const numeric = String(row.current_number).padStart(pad, '0');
    const formatted = `${overridePrefix ?? row.prefix ?? ''}${numeric}${overridePostfix ?? row.postfix ?? ''}`;

    return { sequenceId: row.sequence_id, number: row.current_number, series: formatted };
  } catch (err) {
    if (ownsClient) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    if (ownsClient) {
      client.release();
    }
  }
}

export default { getNextSeries };
