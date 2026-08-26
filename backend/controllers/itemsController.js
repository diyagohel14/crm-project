//  controllers/itemsController.js

import { getCompanyPool } from "../config/companyPoolManager.js";
import { logAudit } from "../services/authService.js";
import { getRequestInfo } from "../utils/crypto.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";
import { getNextSeries } from "../services/seriesService.js";


///////////////Item Masters Module Start///////////////
export async function viewItemsTypes(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const { itemTypesId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let result;

    try {
        if (itemTypesId) {
            const query = `SELECT * FROM item_type WHERE item_type_id = $1 AND is_deleted = FALSE AND company_id = $2`;
            result = await companyPool.query(query, [itemTypesId, companyId]);

        } else {
            const query = `SELECT * FROM item_type WHERE is_deleted = FALSE AND company_id = $1`;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ message: "Item Types Fetch Successfully", ItemTypes: result.rows });

    } catch (err) {
        console.error("[viewItemsTypes]", err);
        return res.status(500).json({ error: "Failed to fetch Items Types List", details: err.message });
    }
}

export async function createItemsTypes(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const { item_type_name, status } = req.body;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        if (!item_type_name || !item_type_name.trim()) {
            return res.status(400).json({ success: false, message: "Item Type name is required" });
        }

        const existingType = await client.query(
            `select item_type_name from item_type where LOWER(item_type_name) = LOWER($1) AND is_deleted = FALSE AND company_id = $2`,
            [item_type_name, companyId]
        );

        if (existingType.rows.length !== 0) {
            return res.status(404).json({ success: false, error: `${item_type_name} Type Already Exists` });
        }

        const query = `INSERT INTO item_type(item_type_name, status, user_id, company_id) VALUES($1,$2,$3,$4) RETURNING *`;
        const result = await client.query(query, [item_type_name, status, userId, companyId]);

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Item Types Master",
                page_name: "Create Items Type",
                table_name: "item_type",
                table_id: result.rows[0].item_type_id,
                action_type: "CREATE",
                action_description: "Item Type Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "New Item Type Created Successfully", ItemTypes: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createItemsTypes]", err);
        return res.status(500).json({ success: false, error: "Failed to Add Items Types", details: err.message });

    } finally {
        client.release();
    }
}

export async function updateItemsTypes(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemTypesId } = req.params;
    const { item_type_name, status } = req.body;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        if (!item_type_name || !item_type_name.trim()) {
            return res.status(400).json({ success: false, message: "Item Type name is required" });
        }

        const existingType = await client.query(
            `select item_type_name from item_type where LOWER(item_type_name) = LOWER($1) AND is_deleted = FALSE AND company_id = $2 AND status = $3  AND item_type_id != $4`,
            [item_type_name, companyId, status, itemTypesId]
        );

        if (existingType.rows.length !== 0) {
            return res.status(404).json({ success: false, error: `${item_type_name} Type Already Exists` });
        }

        const result = await client.query(
            `UPDATE item_type SET item_type_name = $1, status = $4 WHERE item_type_id = $2 AND is_deleted = FALSE AND company_id = $3 RETURNING *`,
            [item_type_name, itemTypesId, companyId, status]
        );

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Item Types Master",
                page_name: "Update Items Type",
                table_name: "item_type",
                table_id: result.rows[0].item_type_id,
                action_type: "UPDATE",
                action_description: "Item Type Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        } else {
            return res.status(400).json({ success: false, message: "Item Type Not Found!!!" })
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Type Updated Successfully", ItemTypes: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updateItemsTypes]", err);
        return res.status(500).json({ success: false, error: "Failed to Update Items Types", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteItemsTypes(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemTypesId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        const result = await client.query(
            `UPDATE item_type SET is_deleted = TRUE, status = 'inactive' WHERE item_type_id = $1 AND is_deleted = FALSE AND company_id = $2 RETURNING *`,
            [itemTypesId, companyId]
        );

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Item Types Master",
                page_name: "Delete Items Type",
                table_name: "item_type",
                table_id: result.rows[0].item_type_id,
                action_type: "DELETE",
                action_description: "Item Type Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Type Deleted Successfully", ItemTypes: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteItemsTypes]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Items Types", details: err.message });

    } finally {
        client.release();
    }
}

//item category
export async function getItemsCategories(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        const result = await client.query(
            `SELECT * FROM item_categories WHERE company_id = $1 AND is_deleted = FALSE ORDER BY category_name ASC`,
            [companyId]
        );
        return res.status(200).json({ success: true, message: "All Item Category Fetch Successfully", ItemsCategory: result.rows });

    } catch (err) {
        console.error("[getItemsCategories]", err);
        return res.status(500).json({ success: false, error: "Failed to get All Items Category", details: err.message });
    }
}
export async function getItemsParentCategories(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        const result = await client.query(
            `SELECT * FROM item_categories
            WHERE company_id = $1 AND parent_category_id IS NULL AND status = 'active' AND is_deleted = FALSE
            ORDER BY category_name ASC`,
            [companyId]
        );

        return res.status(200).json({ success: true, message: "Parent Category Fetch Successfully", ItemsCategory: result.rows });

    } catch (err) {
        console.error("[getItemsParentCategories]", err);
        return res.status(500).json({ success: false, error: "Failed to get Parent Items Category", details: err.message });

    }
}
export async function getItemsSubCategories(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const { itemCategoryId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        const result = await client.query(
            `SELECT * FROM item_categories
            WHERE parent_category_id = $1 AND company_id = $2 AND is_deleted = FALSE ORDER BY category_name ASC
            `,
            [itemCategoryId, companyId]
        );

        return res.status(200).json({ success: true, message: "Sub Item Category Fetch Successfully", ItemsCategory: result.rows });

    } catch (err) {
        console.error("[getItemsSubCategories]", err);
        return res.status(500).json({ success: false, error: "Failed to Get Sub Items Category", details: err.message });

    }
}
export async function getItemsCategoryById(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemCategoryId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {

        const result = await client.query(
            `SELECT c.*, p.category_name AS parent_category_name
            FROM item_categories c
            LEFT JOIN item_categories p ON p.category_id = c.parent_category_id
            WHERE c.category_id = $1 AND c.company_id = $2 AND c.is_deleted = FALSE`,
            [itemCategoryId, companyId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        return res.status(200).json({ success: true, message: "Item Category Fetch Successfully", ItemsCategory: result.rows[0] });

    } catch (err) {
        console.error("[getItemsCategoryById]", err);
        return res.status(500).json({ success: false, error: "Failed to Get Items Category", details: err.message });

    }
}

export async function createItemsCategory(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { category_name, parent_category_id = null, status = 'active' } = req.body
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        if (!category_name || !category_name.trim()) {
            return res.status(400).json({ success: false, message: "Category name is required" });
        }

        // Check parent category
        if (parent_category_id) {
            const parentResult = await client.query(
                `SELECT category_id FROM item_categories WHERE category_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
                [parent_category_id, companyId]
            );

            if (parentResult.rows.length === 0) {
                return res.status(400).json({ success: false, message: "Parent category not found" });
            }
        }

        // Check duplicate category
        const duplicateResult = await client.query(
            `SELECT category_id FROM item_categories
            WHERE LOWER(category_name) = LOWER($1) AND company_id = $2 AND is_deleted = FALSE AND (parent_category_id = $3 OR (parent_category_id IS NULL AND $3 IS NULL))`,
            [category_name.trim(), companyId, parent_category_id]
        );

        if (duplicateResult.rows.length > 0) {
            return res.status(409).json({ success: false, message: "Category already exists" });
        }

        const result = await client.query(
            `INSERT INTO item_categories(category_name,parent_category_id,status,user_id,company_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [category_name.trim(), parent_category_id, status, userId, companyId]
        );

        if (result.rows.length > 0) {
            await logAudit(client, {
                module_name: "Items Category Master",
                page_name: "Create Items Category",
                table_name: "item_categories",
                table_id: result.rows[0].category_id,
                action_type: "CREATE",
                action_description: "Item Category Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Category Created Successfully", ItemsCategory: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createItemsCategory]", err);
        return res.status(500).json({ success: false, error: "Failed to Create Items Category", details: err.message });

    } finally {
        client.release();
    }
}


export async function updateItemsCategory(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemCategoryId } = req.params;
    const { category_name, parent_category_id = null, status = 'active' } = req.body
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        if (!category_name || !category_name.trim()) {
            return res.status(400).json({ success: false, message: "Category name is required" });
        }

        // Check category exists
        const categoryResult = await client.query(
            `SELECT category_id FROM item_categories
            WHERE category_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [itemCategoryId, companyId]
        );

        if (categoryResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        // Category cannot be its own parent
        if (parent_category_id && Number(parent_category_id) === Number(itemCategoryId)) {
            return res.status(400).json({ success: false, message: "Category cannot be its own parent" });
        }


        // Check parent category
        if (parent_category_id) {
            const parentResult = await client.query(
                `SELECT category_id FROM item_categories WHERE category_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
                [parent_category_id, companyId]
            );

            if (parentResult.rows.length === 0) {
                return res.status(400).json({ success: false, message: "Parent category not found" });
            }
        }

        // Check duplicate category
        const duplicateResult = await client.query(
            `SELECT category_id FROM item_categories
            WHERE LOWER(category_name) = LOWER($1) AND company_id = $2 AND category_id != $3 AND is_deleted = FALSE AND (parent_category_id = $4 OR (parent_category_id IS NULL AND $4 IS NULL))`,
            [category_name.trim(), companyId, itemCategoryId, parent_category_id]
        );

        if (duplicateResult.rows.length > 0) {
            return res.status(409).json({ success: false, message: "Category already exists" });
        }

        const result = await client.query(
            `UPDATE item_categories SET category_name=$1, parent_category_id=$2, status=$3 WHERE category_id=$4 AND company_id = $2 AND is_deleted = FALSE RETURNING *`,
            [category_name.trim(), parent_category_id, status, itemCategoryId, companyId]
        );

        if (result.rows.length > 0) {
            await logAudit(client, {
                module_name: "Items Category Master",
                page_name: "Update Items Category",
                table_name: "item_categories",
                table_id: result.rows[0].category_id,
                action_type: "UPDATE",
                action_description: "Item Category Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Category Updated Successfully", ItemsCategory: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updateItemsCategory]", err);
        return res.status(500).json({ success: false, error: "Failed to Update Items Category", details: err.message });

    } finally {
        client.release();
    }
}

export async function deleteItemsCategory(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemCategoryId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        // Check category
        const categoryResult = await client.query(
            `SELECT category_id FROM item_categories WHERE category_id = $1 AND company_id = $2 AND is_deleted = FALSE`,
            [itemCategoryId, companyId]
        );

        if (categoryResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Category not found" });
        }

        // Check child categories
        const childResult = await client.query(
            `SELECT category_id FROM item_categories WHERE parent_category_id = $1 AND company_id = $2 AND is_deleted = FALSE LIMIT 1`,
            [itemCategoryId, companyId]
        );

        if (childResult.rows.length > 0) {
            return res.status(400).json({ success: false, message: "Cannot delete category because it has sub-categories" });
        }

        // Soft delete
        const result = await client.query(
            `UPDATE item_categories SET is_deleted = TRUE, status = 'inactive' WHERE category_id = $1 AND company_id = $2 RETURNING *`,
            [itemCategoryId, companyId]
        );
        if (result.rows.length > 0) {
            await logAudit(client, {
                module_name: "Items Category Master",
                page_name: "Delete Items Category",
                table_name: "item_categories",
                table_id: result.rows[0].category_id,
                action_type: "DELETE",
                action_description: "Item Category Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Category Deleted Successfully", ItemsCategory: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteItemsCategory]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Items Category", details: err.message });

    } finally {
        client.release();
    }
}

///////////////Item Masters Module End////////////////

///////////////Items Module Start/////////////////////

export async function viewItems(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemsId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    let result;

    try {

        if (itemsId) {
            result = await client.query(
                `SELECT * FROM tbl_items WHERE company_id=$1 AND is_deleted = FALSE AND item_id = $2`,
                [companyId, itemsId]
            );
        } else {
            result = await client.query(
                `SELECT * FROM tbl_items WHERE company_id=$1 AND is_deleted = FALSE`,
                [companyId]
            );
        }

        if (result.rows.length < 0) {
            return res.status(400).json({ success: false, message: "Something Went Wrong!!!" });
        }

        return res.status(200).json({ success: true, message: "Item Fetch Successfully", Items: result.rows });

    } catch (err) {
        console.error("[viewItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Fetch Items", details: err.message });
    }
}

export async function createItems(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        const itemsData = { ...req.body };

        if (!itemsData.item_name || !itemsData.item_type || !itemsData.unit_id || !itemsData.conv_unit_id ) {
            return res.status(400).json({ success: false, message: "Item name, type, and details are required" });
        }

        const itemSeriesResult = await getNextSeries(companyPool, {
            documentTypeId: DOCUMENT_TYPES.ITEM,
            companyId,
            userId,
            financialYearId
        });

        const existingItem = await client.query(
            `SELECT item_id, item_code, item_name FROM tbl_items WHERE is_deleted=FALSE AND company_id = $1 AND LOWER(item_name) = LOWER($2)`,
            [companyId, itemsData.item_name]
        );

        if (existingItem.rows.length > 0) {
            return res.status(409).json({ success: false, message: "Item already exists" });
        }

        const query = `INSERT INTO tbl_items 
        (item_code, item_name, item_description, item_specification, item_type, item_perent_category, item_category, hsn_code, 
        unit_id, conv_unit_id, sales_currency_id, sales_qty, sales_convert_qty, sales_rate, sales_conv_rate, 
        purchase_currency_id, purchase_qty, purchase_convert_qty, purchase_rate, purchase_conv_rate, tax_id, status, user_id, company_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`;

        const value = [
            itemSeriesResult.series,
            itemsData.item_name,
            itemsData.item_description ?? null,
            itemsData.item_specification ?? null,
            itemsData.item_type,
            itemsData.item_perent_category,
            itemsData.item_category,
            itemsData.hsn_code,
            itemsData.unit_id,
            itemsData.conv_unit_id,
            itemsData.sales_currency_id,
            itemsData.sales_qty,
            itemsData.sales_convert_qty,
            itemsData.sales_rate,
            itemsData.sales_conv_rate,
            itemsData.purchase_currency_id,
            itemsData.purchase_qty,
            itemsData.purchase_convert_qty,
            itemsData.purchase_rate,
            itemsData.purchase_conv_rate,
            itemsData.tax_id,
            itemsData.status ?? 'active',
            userId,
            companyId
        ]

        const result = await client.query(query, value);

        if (result.rows.length > 0) {
            await logAudit(client, {
                module_name: "Items",
                page_name: "Create Items",
                table_name: "tbl_items",
                table_id: result.rows[0].item_id,
                action_type: "CREATE",
                action_description: "Item Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Created Successfully", Items: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[createItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Create Items", details: err.message });

    } finally {
        client.release();
    }
}

export async function updateItems(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemsId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        const itemsData = { ...req.body };

        const existingItem = await client.query(
            `SELECT item_id, item_code, item_name, status FROM tbl_items WHERE is_deleted=FALSE AND company_id = $1 AND LOWER(item_name) = LOWER($2) AND item_id != $3`,
            [companyId, itemsData.item_name, itemsId]
        );

        if (existingItem.rows.length > 0) {
            return res.status(409).json({ success: false, message: "Item already exists", data: existingItem.rows });
        }

        const query = `UPDATE tbl_items SET  
        item_name = $1, 
        item_description = $2, 
        item_specification = $3, 
        item_type = $4, 
        item_perent_category = $5, 
        item_category = $6, 
        hsn_code = $7, 
        unit_id = $8, 
        conv_unit_id = $9, 
        sales_currency_id = $10, 
        sales_qty = $11, 
        sales_convert_qty = $12, 
        sales_rate = $13, 
        sales_conv_rate = $14, 
        purchase_currency_id = $15, 
        purchase_qty = $16, 
        purchase_convert_qty = $17, 
        purchase_rate = $18, 
        purchase_conv_rate = $19, 
        tax_id = $20, 
        status = $21, 
        updated_at = NOW()
        WHERE is_deleted = FALSE AND item_id = $22 AND company_id = $23
        RETURNING *`;

        const value = [
            itemsData.item_name,
            itemsData.item_description ?? null,
            itemsData.item_specification ?? null,
            itemsData.item_type,
            itemsData.item_perent_category,
            itemsData.item_category,
            itemsData.hsn_code,
            itemsData.unit_id,
            itemsData.conv_unit_id,
            itemsData.sales_currency_id,
            itemsData.sales_qty,
            itemsData.sales_convert_qty,
            itemsData.sales_rate,
            itemsData.sales_conv_rate,
            itemsData.purchase_currency_id,
            itemsData.purchase_qty,
            itemsData.purchase_convert_qty,
            itemsData.purchase_rate,
            itemsData.purchase_conv_rate,
            itemsData.tax_id,
            itemsData.status ?? 'active',
            itemsId,
            companyId
        ]

        const result = await client.query(query, value);

        if (result.rows.length > 0) {
            await logAudit(client, {
                module_name: "Items",
                page_name: "Update Items",
                table_name: "tbl_items",
                table_id: result.rows[0].item_id,
                action_type: "UPDATE",
                action_description: "Item Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Updated Successfully", Items: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[updateItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Updated Items", details: err.message });

    } finally {
        client.release();
    }

}

export async function deleteItems(req,res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user
    const { itemsId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        const query = `UPDATE tbl_items SET status = 'inactive', is_deleted = TRUE, updated_at = NOW()
        WHERE is_deleted = FALSE AND item_id = $1 AND company_id = $2 RETURNING *`;

        const result = await client.query(query, [itemsId, companyId]);

        if (result.rows.length > 0) {
            await logAudit(client, {
                module_name: "Items",
                page_name: "Delete Items",
                table_name: "tbl_items",
                table_id: result.rows[0].item_id,
                action_type: "DELETE",
                action_description: "Item Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Item Deleted Successfully", Items: result.rows[0] });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => { });
        console.error("[deleteItems]", err);
        return res.status(500).json({ success: false, error: "Failed to Delete Items", details: err.message });

    } finally {
        client.release();
    }
    
}

///////////////Items Module End///////////////////////