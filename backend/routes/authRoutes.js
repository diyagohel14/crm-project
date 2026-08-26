// routes/authRoutes.js
import { Router } from "express";
import {
    loginController, logoutController, meController, updatemeController, viewUser, createSubUser, updateSubUser, deleteSubUser, changePassword,
    viewRoles, createRoles, updateRoles, deleteRoles, listPermissions, createPermission, listRolePermissions, updateRolePermissions, listUserPermissions, updateUserPermissions
} from "../controllers/authController.js";
import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//Auth Module
router.post("/login", loginController);
router.post("/logout", requireAuth, logoutController);
router.get("/profile", requireAuth, meController);   //USE FOR GET THE PROFILE DATA
router.put("/profile", requireAuth, requirePermission("company:profile:update"), updatemeController);   //USE FOR UPDATE THE COMPANY PROFILE DATA  //1

// Superuser/admin creates a sub-user account under their own company
//User Module
router.get("/users", requireAuth, requirePermission("users:view"), viewUser);   //2
router.post("/users", requireAuth, requirePermission("users:create"), createSubUser);   //3
router.put("/users/:userId", requireAuth, requirePermission("users:update"), updateSubUser);    //4
router.delete("/users/:userId", requireAuth, requirePermission("users:delete"), deleteSubUser); //5
router.put("/user/password", requireAuth, requirePermission("users:password:update"), changePassword);  //6

// CRUD for roles module
router.get("/roles", requireAuth, requirePermission("roles:view"), viewRoles);  //7
router.post("/roles", requireAuth, requirePermission("roles:create"), createRoles);     //8
router.put("/roles/:roleId", requireAuth, requirePermission("roles:update"), updateRoles);      //9
router.delete("/roles/:roleId", requireAuth, requirePermission("roles:delete"), deleteRoles);   //10

// Permission management
router.get("/permissions", requireAuth, requirePermission("permissions:view"), listPermissions);    //11
router.post("/permissions", requireAuth, requirePermission("permissions:manage"), createPermission);    //12
router.get("/roles/:roleId/permissions", requireAuth, requirePermission("roles:view"), listRolePermissions);
router.put("/roles/:roleId/permissions", requireAuth, requirePermission("permissions:manage"), updateRolePermissions);
router.get("/users/:userId/permissions", requireAuth, requirePermission("users:view"), listUserPermissions);
router.put("/users/:userId/permissions", requireAuth, requirePermission("permissions:manage"), updateUserPermissions);



export default router;