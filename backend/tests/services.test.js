import test from "node:test";
import assert from "node:assert/strict";
import { computeManpowerCost, computeEquipmentCost, recalcProjectCost } from "../services/costingService.js";
import { buildEffectivePermissionSummary, hasPermission } from "../services/permissionService.js";

test("costing helpers calculate labour and equipment totals", () => {
  assert.deepEqual(computeManpowerCost({
    headcount: 2,
    regular_hours: 8,
    overtime_hours: 2,
    rate_per_hour: 100,
  }), { otRate: 150, totalCost: 2200 });
  assert.equal(computeEquipmentCost({ hours_used: 3, rate_per_hour: 125.5, fuel_cost: 10 }), 386.5);
});

test("recalcProjectCost updates the category and project totals", async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (queries.length === 1) return { rows: [{ total: "125.50" }] };
      if (queries.length === 3) return { rows: [{ total: "900.50" }] };
      return { rows: [] };
    },
  };
  const result = await recalcProjectCost(client, { projectId: 4, companyId: 9, category: "labour" });
  assert.deepEqual(result, { category_actual: "125.50", project_actual_cost: "900.50" });
  assert.match(queries[0].sql, /tbl_project_manpower_log/);
  assert.match(queries[1].sql, /ON CONFLICT/);
  assert.match(queries[2].sql, /tbl_project_costs/);
  assert.match(queries[3].sql, /UPDATE tbl_project/);
  await assert.rejects(() => recalcProjectCost(client, { projectId: 4, companyId: 9, category: "material" }), /unsupported category/);
});

test("user permissions override role permissions and summary counts remain accurate", () => {
  const result = buildEffectivePermissionSummary(
    [
      { permission_name: "read", module_name: "CRM", is_allowed: true },
      { permission_name: "delete", module_name: "CRM", is_allowed: true },
    ],
    [{ permission_name: "delete", module_name: "CRM", is_allowed: false }],
  );
  assert.deepEqual(result.summary, {
    totalPermissions: 2,
    allowedPermissions: 1,
    deniedPermissions: 1,
    modules: ["CRM"],
  });
  assert.equal(hasPermission(result.permissions, "read"), true);
  assert.equal(hasPermission(result.permissions, "delete"), false);
  assert.equal(hasPermission(result.permissions, "missing"), false);
});
