// routes/adminRoutes.js
import { Router } from "express";
import {
    registerAdmin, loginAdmin, logoutAdmin,
    viewPalnns, createPalnns, updatePalnns, deletePalnns,
    createCompany, viewCompany, deleteCompany, hardDeleteCompany, changeStatus
} from "../controllers/adminController.js";
import { requireAdmin } from "../middleware/adminMiddleware.js";

const router = Router();

//auth
router.post("/register", registerAdmin);  //Optional
router.post("/login", loginAdmin);
router.post("/logout", requireAdmin, logoutAdmin);  //Optional

//subscription plans
router.get("/subscription-plans", requireAdmin, viewPalnns);
router.post("/subscription-plans", requireAdmin, createPalnns);
router.put("/subscription-plans/:planId", requireAdmin, updatePalnns); 
router.delete("/subscription-plans/:planId", requireAdmin, deletePalnns);

// this endpoint provisions a brand new company + database.
//company & profile
router.post("/companies", requireAdmin, createCompany);
router.get("/companies", requireAdmin, viewCompany);
router.get("/companies/:companyId", requireAdmin, viewCompany);
router.delete("/companies/:companyId", requireAdmin, deleteCompany);
// Irreversible: physically drops the tenant's database. Requires the
// company to already be soft-deleted and the caller to echo back its
// company_code as { confirmCompanyCode } in the body.
router.delete("/companies/:companyId/harddelete", requireAdmin, hardDeleteCompany);
router.put("/change_status/:companyId/:status", requireAdmin, changeStatus);


export default router;
