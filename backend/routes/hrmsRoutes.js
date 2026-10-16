import { Router } from "express";
import {
  listEmployees, createEmployee, getEmployee, updateEmployee, deleteEmployee,
  listAttendance, createAttendance, listLeaveRequests, createLeaveRequest, updateLeaveRequest,
  listPayrollRuns, createPayrollRun, approvePayrollRun,
} from "../controllers/hrmsController.js";
import {

  createEmployeeDocument, listEmployeeDocuments, deleteEmployeeDocument,
  createOnboardingTask, listOnboardingTasks, updateOnboardingTask,
  createOvertimeRequest, listOvertimeRequests, reviewOvertimeRequest, 
  getHrmsAnalytics, getPayslip, getPayslipPdf,
  listAttendanceAlerts, 
  listDeductionRules, saveDeductionRule, 
  listLeaveBalances, saveLeaveBalance, 
  listShiftRosters, saveShiftRoster,
  createAttendanceCorrection, reviewAttendanceCorrection,
  listAttendanceCorrections,
  listPayrollPayments, recordPayrollPayment, reversePayrollPayment,
  listProjectAssignments, createProjectAssignment, closeProjectAssignment,
  listProjectTimesheets, createProjectTimesheet, reviewProjectTimesheet,
  listEmployeeExits, createEmployeeExit, reviewEmployeeExit,
  listTrainingCourses, createTrainingCourse, updateTrainingCourse,
  listTrainingParticipants, saveTrainingParticipant,
  listAppraisals, createAppraisal, submitAppraisal, reviewAppraisal,
  
} from "../controllers/hrmsOperationsController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

router.get("/employees", requireAuth, /*requirePermission("hrms_employee:view"),*/ listEmployees);
router.post("/employees", requireAuth, /*requirePermission("hrms_employee:create"),*/ createEmployee);
router.get("/employees/:employeeId", requireAuth, /*requirePermission("hrms_employee:view"),*/ getEmployee);
router.put("/employees/:employeeId", requireAuth, /*requirePermission("hrms_employee:update"),*/ updateEmployee);
router.delete("/employees/:employeeId", requireAuth, /*requirePermission("hrms_employee:delete"),*/ deleteEmployee);

router.get("/attendance", requireAuth, /*requirePermission("hrms_attendance:view"),*/ listAttendance);
router.post("/attendance", requireAuth, /*requirePermission("hrms_attendance:create"),*/ createAttendance);
router.get("/attendance-corrections", requireAuth, /*requirePermission("hrms_attendance:view"),*/ listAttendanceCorrections);
router.post("/attendance/:attendanceId/corrections", requireAuth, /*requirePermission("hrms_attendance:correction:create"),*/ createAttendanceCorrection);
router.put("/attendance-corrections/:correctionId/review", requireAuth, /*requirePermission("hrms_attendance:correction:approve"),*/ reviewAttendanceCorrection);

router.get("/leave-requests", requireAuth, /*requirePermission("hrms_leave:view"),*/ listLeaveRequests);
router.post("/leave-requests", requireAuth, /*requirePermission("hrms_leave:create"),*/ createLeaveRequest);
router.put("/leave-requests/:leaveId", requireAuth, /*requirePermission("hrms_leave:update"),*/ updateLeaveRequest);

router.get("/payroll", requireAuth, /*requirePermission("hrms_payroll:view"),*/ listPayrollRuns);
router.post("/payroll", requireAuth, /*requirePermission("hrms_payroll:create"),*/ createPayrollRun);
router.put("/payroll/:payrollId/approve", requireAuth, /*requirePermission("hrms_payroll:approve"),*/ approvePayrollRun);
router.get("/payroll/:payrollId/payslips/:employeeId.pdf", requireAuth, /*requirePermission("hrms_payroll:view"),*/ getPayslipPdf);
router.get("/payroll/:payrollId/payslips/:employeeId", requireAuth, /*requirePermission("hrms_payroll:view"),*/ getPayslip);
router.get("/payroll/:payrollId/payments", requireAuth, /*requirePermission("hrms_payroll:view"),*/ listPayrollPayments);
router.post("/payroll/:payrollId/payments", requireAuth, /*requirePermission("hrms_payroll:payment:create"),*/ recordPayrollPayment);
router.post("/payroll/:payrollId/payments/:paymentId/reverse", requireAuth, /*requirePermission("hrms_payroll:payment:reverse"),*/ reversePayrollPayment);

router.get("/analytics", requireAuth, /*requirePermission("hrms_analytics:view"),*/ getHrmsAnalytics);
router.get("/attendance/alerts", requireAuth, /*requirePermission("hrms_attendance:view"),*/ listAttendanceAlerts);
router.get("/rosters", requireAuth, /*requirePermission("hrms_roster:view"),*/ listShiftRosters);
router.post("/rosters", requireAuth, /*requirePermission("hrms_roster:create"),*/ saveShiftRoster);

router.get("/overtime-requests", requireAuth, /*requirePermission("hrms_overtime:view"),*/ listOvertimeRequests);
router.post("/overtime-requests", requireAuth, /*requirePermission("hrms_overtime:create"),*/ createOvertimeRequest);
router.put("/overtime-requests/:requestId/review", requireAuth, /*requirePermission("hrms_overtime:approve"),*/ reviewOvertimeRequest);

router.get("/leave-balances", requireAuth, /*requirePermission("hrms_leave_balance:view"),*/ listLeaveBalances);
router.put("/leave-balances/:employeeId", requireAuth, /*requirePermission("hrms_leave_balance:update"),*/ saveLeaveBalance);

router.get("/employees/:employeeId/documents", requireAuth, /*requirePermission("hrms_document:view"),*/ listEmployeeDocuments);
router.post("/employees/:employeeId/documents", requireAuth, /*requirePermission("hrms_document:create"),*/ createEmployeeDocument);
router.delete("/documents/:documentId", requireAuth, /*requirePermission("hrms_document:delete"),*/ deleteEmployeeDocument);

router.get("/onboarding-tasks", requireAuth, /*requirePermission("hrms_onboarding:view"),*/ listOnboardingTasks);
router.post("/onboarding-tasks", requireAuth, /*requirePermission("hrms_onboarding:create"),*/ createOnboardingTask);
router.put("/onboarding-tasks/:taskId", requireAuth, /*requirePermission("hrms_onboarding:update"),*/ updateOnboardingTask);

router.get("/deduction-rules", requireAuth, /*requirePermission("hrms_payroll:view"),*/ listDeductionRules);
router.post("/deduction-rules", requireAuth, /*requirePermission("hrms_payroll:create"),*/ saveDeductionRule);
router.put("/deduction-rules/:ruleId", requireAuth, /*requirePermission("hrms_payroll:update"),*/ saveDeductionRule);

router.get("/project-assignments", requireAuth, /*requirePermission("hrms_project_assignment:view"),*/ listProjectAssignments);
router.post("/project-assignments", requireAuth, /*requirePermission("hrms_project_assignment:create"),*/ createProjectAssignment);
router.put("/project-assignments/:assignmentId/close", requireAuth, /*requirePermission("hrms_project_assignment:update"),*/ closeProjectAssignment);
router.get("/project-timesheets", requireAuth, /*requirePermission("hrms_project_timesheet:view"),*/ listProjectTimesheets);
router.post("/project-timesheets", requireAuth, /*requirePermission("hrms_project_timesheet:create"),*/ createProjectTimesheet);
router.put("/project-timesheets/:timesheetId/review", requireAuth, /*requirePermission("hrms_project_timesheet:approve"),*/ reviewProjectTimesheet);

router.get("/employee-exits", requireAuth, /*requirePermission("hrms_employee_exit:view"),*/ listEmployeeExits);
router.post("/employee-exits", requireAuth, /*requirePermission("hrms_employee_exit:create"),*/ createEmployeeExit);
router.put("/employee-exits/:exitId/review", requireAuth, /*requirePermission("hrms_employee_exit:approve"),*/ reviewEmployeeExit);
router.get("/training", requireAuth, /*requirePermission("hrms_training:view"),*/ listTrainingCourses);
router.post("/training", requireAuth, /*requirePermission("hrms_training:create"),*/ createTrainingCourse);
router.put("/training/:trainingId", requireAuth, /*requirePermission("hrms_training:update"),*/ updateTrainingCourse);
router.get("/training/:trainingId/participants", requireAuth, /*requirePermission("hrms_training:view"),*/ listTrainingParticipants);
router.put("/training/:trainingId/participants", requireAuth, /*requirePermission("hrms_training:update"),*/ saveTrainingParticipant);
router.get("/appraisals", requireAuth, /*requirePermission("hrms_appraisal:view"),*/ listAppraisals);
router.post("/appraisals", requireAuth, /*requirePermission("hrms_appraisal:create"),*/ createAppraisal);
router.put("/appraisals/:appraisalId/submit", requireAuth, /*requirePermission("hrms_appraisal:update"),*/ submitAppraisal);
router.put("/appraisals/:appraisalId/review", requireAuth, /*requirePermission("hrms_appraisal:approve"),*/ reviewAppraisal);

export default router;
