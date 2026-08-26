// routes/itemsRoutes.js

import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import {
    viewItemsTypes, createItemsTypes, updateItemsTypes, deleteItemsTypes,
    getItemsCategories, getItemsParentCategories, getItemsSubCategories, getItemsCategoryById, createItemsCategory, updateItemsCategory, deleteItemsCategory,
    viewItems, createItems, updateItems, deleteItems
} from "../controllers/itemsController.js";

const router = Router();

//ITEM MASTER---------------
//item types
router.get("/item-types", requireAuth, requirePermission("item_types:view"), viewItemsTypes);  //97
router.get("/item-types/:itemTypesId", requireAuth, requirePermission("item_types:view"), viewItemsTypes);
router.post("/item-types", requireAuth, requirePermission("item_types:create"), createItemsTypes);  //98
router.put("/item-types/:itemTypesId", requireAuth, requirePermission("item_types:update"), updateItemsTypes);  //99
router.delete("/item-types/:itemTypesId", requireAuth, requirePermission("item_types:delete"), deleteItemsTypes);  //100

//item category
router.get("/item-category", requireAuth, requirePermission("item_category:view"), getItemsCategories);  //101    // Get all categories
router.get("/item-category/parents", requireAuth, requirePermission("item_category:view"), getItemsParentCategories);        // Get parent categories
router.get("/item-category/:itemCategoryId/subcategories", requireAuth, requirePermission("item_category:view"), getItemsSubCategories);         // Get subcategories
router.get("/item-category/:itemCategoryId", requireAuth, requirePermission("item_category:view"), getItemsCategoryById);        // Get category by ID

router.post("/item-category", requireAuth, requirePermission("item_category:create"), createItemsCategory);  //102
router.put("/item-category/:itemCategoryId", requireAuth, requirePermission("item_category:update"), updateItemsCategory);  //103
router.delete("/item-category/:itemCategoryId",requireAuth, requirePermission("item_category:delete"), deleteItemsCategory);  //104

//ITEMS DETAILS
router.get("/items", requireAuth, requirePermission("items:view"), viewItems);     //105
router.get("/items/:itemsId", requireAuth, requirePermission("items:view"), viewItems);
router.post("/items", requireAuth, requirePermission ("items:create"), createItems);   //106
router.put("/items/:itemsId", requireAuth, requirePermission("items:update"), updateItems);   //107
router.delete("/items/:itemsId", requireAuth, requirePermission("items:delete"), deleteItems);   //108

export default router;