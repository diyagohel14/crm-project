export function getCurrentFinancialYearDetails(referenceDate = new Date()) {
  const date = new Date(referenceDate);
  const fiscalYearStartYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;

  return {
    fyName: `${fiscalYearStartYear}-${String(fiscalYearStartYear + 1).slice(-2)}`,
    startDate: `${fiscalYearStartYear.toString().padStart(4, "0")}-04-01`,
    endDate: `${(fiscalYearStartYear + 1).toString().padStart(4, "0")}-03-31`,
  };
}

export function resolveFinancialYearPayload(payload = {}, referenceDate = new Date()) {
  const currentFinancialYear = getCurrentFinancialYearDetails(referenceDate);
  const fyName = payload.fy_name || currentFinancialYear.fyName;
  const startDate = payload.start_date || currentFinancialYear.startDate;
  const endDate = payload.end_date || currentFinancialYear.endDate;
  const explicitIsCurrent = payload.is_current;
  const isCurrent =
    explicitIsCurrent === true ||
    (explicitIsCurrent !== false && (fyName === currentFinancialYear.fyName || (startDate === currentFinancialYear.startDate && endDate === currentFinancialYear.endDate)));

  return {
    fy_name: fyName,
    start_date: startDate,
    end_date: endDate,
    is_current: Boolean(isCurrent),
    status: payload.status || (isCurrent ? "active" : "closed"),
  };
}

export function buildInitialFinancialYearPayload(payload = {}, referenceDate = new Date()) {
  const resolved = resolveFinancialYearPayload(payload, referenceDate);

  return {
    ...resolved,
    is_deleted: false,
    user_id: payload.user_id ?? null,
  };
}
