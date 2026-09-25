// routes/projectRoutes.js

import { Router } from "express";
import {
    getProjects, createProject, createProjectFromSalesOrder, updateProject, deleteProject, changeStatus,
    getProjectFinancials,
    addProjectSite, deleteProjectSite,
    addBoqItem, updateBoqItem, deleteBoqItem,
    addMilestone, updateMilestone, deleteMilestone,
    addTask, updateTask, deleteTask,
    getDprList, addDpr,
    getDocuments, addDocument, deleteDocument,
} from "../controllers/projectController.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";

const router = Router();

// PROJECT
router.get("/", requireAuth, /*requirePermission("project:view"),*/ getProjects);   //182
router.get("/:projectId", requireAuth, /*requirePermission("project:view"),*/ getProjects);
router.post("/", requireAuth, /*requirePermission("project:create"),*/ createProject);  //183
router.post("/from-sales-order/:salesOrderId", requireAuth, /*requirePermission("project:create"),*/ createProjectFromSalesOrder);
router.put("/:projectId", requireAuth, /*requirePermission("project:update"),*/ updateProject);  //184
router.delete("/:projectId", requireAuth, /*requirePermission("project:delete"),*/ deleteProject);  //185
router.post("/:projectId/status/:status", requireAuth, /*requirePermission("project:approve"),*/ changeStatus); //186
router.get("/:projectId/financials", requireAuth, /*requirePermission("project:view"),*/ getProjectFinancials);

// PROJECT SITES
router.post("/:projectId/sites", requireAuth, /*requirePermission("project_site:create"),*/ addProjectSite);    //188
router.delete("/:projectId/sites/:siteId", requireAuth, /*requirePermission("project_site:delete"),*/ deleteProjectSite);   //190

// PROJECT BOQ
router.post("/:projectId/boq", requireAuth, /*requirePermission("project_boq:create"),*/ addBoqItem);   //192
router.put("/:projectId/boq/:boqItemId", requireAuth, /*requirePermission("project_boq:update"),*/ updateBoqItem);  //193
router.delete("/:projectId/boq/:boqItemId", requireAuth, /*requirePermission("project_boq:delete"),*/ deleteBoqItem);   //194

// PROJECT MILESTONES
router.post("/:projectId/milestones", requireAuth, /*requirePermission("project_milestone:create"),*/ addMilestone);    //196
router.put("/:projectId/milestones/:milestoneId", requireAuth, /*requirePermission("project_milestone:update"),*/ updateMilestone);  //197
router.delete("/:projectId/milestones/:milestoneId", requireAuth, /*requirePermission("project_milestone:delete"),*/ deleteMilestone);  //198

// PROJECT TASKS
router.post("/:projectId/tasks", requireAuth, /*requirePermission("project_task:create"),*/ addTask);   //200
router.put("/:projectId/tasks/:taskId", requireAuth, /*requirePermission("project_task:update"),*/ updateTask); //201
router.delete("/:projectId/tasks/:taskId", requireAuth, /*requirePermission("project_task:delete"),*/ deleteTask);  //202

// DAILY PROGRESS REPORT
router.get("/:projectId/dpr", requireAuth, /*requirePermission("project_dpr:view"),*/ getDprList);  //203
router.post("/:projectId/dpr", requireAuth, /*requirePermission("project_dpr:create"),*/ addDpr);   //204

// PROJECT DOCUMENTS
router.get("/:projectId/documents", requireAuth, /*requirePermission("project_document:view"),*/ getDocuments);   //207
router.post("/:projectId/documents", requireAuth, /*requirePermission("project_document:create"),*/ addDocument);   //208
router.delete("/:projectId/documents/:documentId", requireAuth, /*requirePermission("project_document:delete"),*/ deleteDocument);  //209

export default router;
