// routes/partyRoutes.js

import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import {
    viewCustomers, createCustomers, updateCustomers, deleteCustomers,
    viewVendors, createVendors, updateVendors, deleteVendors
} from "../controllers/partyController.js";

const router = Router();

//Customer
router.get("/customers", 
    requireAuth, requirePermission("customer:view"), 
    viewCustomers);    //89
router.get("/customers/:customerId", 
    requireAuth, requirePermission("customer:view"), 
    viewCustomers);
router.post("/customers", 
    requireAuth, requirePermission("customer:create"),
    createCustomers);  //90
router.put("/customers/:customerId", 
    requireAuth, requirePermission("customer:update"), 
    updateCustomers);   //91
router.delete("/customers/:customerId", 
    requireAuth, requirePermission("customer:delete"),
    deleteCustomers);   //92


//Vendor
router.get("/vendors", 
    requireAuth, requirePermission("vendor:view"), 
    viewVendors);    //93
router.get("/vendors/:vendorId", 
    requireAuth, requirePermission("vendor:view"), 
    viewVendors);
router.post("/vendors", 
    requireAuth, requirePermission("vendor:create"), 
    createVendors);    //94
router.put("/vendors/:vendorId", 
    requireAuth, requirePermission("vendor:update"),
    updateVendors); //95
router.delete("/vendors/:vendorId", 
    requireAuth, requirePermission("vendor:delete"),
    deleteVendors); //96


export default router;