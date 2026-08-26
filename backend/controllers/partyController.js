//  controllers/partyController.js

import { getCompanyPool } from "../config/companyPoolManager.js";
import { logAudit } from "../services/authService.js";
import { getRequestInfo } from "../utils/crypto.js";
import { addParty, UpdateParty, DeleteParty } from "../services/partyService.js";
import { DOCUMENT_TYPES } from "../constants/documentTypes.js";

///////////////Customer Module Start///////////////
export async function viewCustomers(req, res) {
    const { companyId, userId } = req.session.user;
    const { customerId } = req.params;
    // const { financialYearId } = resolveFinancialYearPayload(req);
    const companyPool = await getCompanyPool(companyId);
    let result;
    // let partyResult; let addressResult; let contactResult;

    try{
        if(customerId){

            const query = `SELECT p.* ,COALESCE(
            (SELECT json_agg(addr) FROM tbl_party_addresses AS addr 
            WHERE addr.party_id = p.party_id AND addr.company_id = p.company_id AND addr.is_deleted = FALSE),'[]'::json) as addresses,
            COALESCE(
            (SELECT json_agg(cont) FROM tbl_party_contact_person AS cont 
            WHERE cont.party_id = p.party_id AND cont.company_id = p.company_id AND cont.is_deleted = FALSE),'[]'::json) as contactPersons
            FROM tbl_party AS p 
            WHERE p.party_id = $1 AND p.company_id = $2 AND p.is_deleted = FALSE AND p.party_type = 'CUSTOMER'
            ORDER BY p.party_name ASC
            `;
            result = await companyPool.query(query, [customerId, companyId]);

        }else{

            const query = `SELECT p.* ,COALESCE(
            (SELECT json_agg(addr) FROM tbl_party_addresses AS addr 
            WHERE addr.party_id = p.party_id AND addr.company_id = p.company_id AND addr.is_deleted = FALSE),'[]'::json) as addresses,
            COALESCE(
            (SELECT json_agg(cont) FROM tbl_party_contact_person AS cont 
            WHERE cont.party_id = p.party_id AND cont.company_id = p.company_id AND cont.is_deleted = FALSE),'[]'::json) as contactPersons
            FROM tbl_party AS p 
            WHERE p.company_id = $1 AND p.is_deleted = FALSE AND p.party_type = 'CUSTOMER'
            ORDER BY p.party_name ASC
            `;
            result = await companyPool.query(query, [companyId]);
        }

        return res.status(200).json({ customers: result.rows });

    }catch (err){
        console.error("[viewCustomers]", err);
        return res.status(500).json({ error: "Failed to fetch Customers List", details: err.message });
    }
}

export async function createCustomers(req, res) {
    // console.log("createCustomers called", req.session.user);
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        const customerData = { ...req.body, party_type: "CUSTOMER", document_type_id: DOCUMENT_TYPES.CUSTOMER };
        const customerDetails = await addParty(customerData, companyId, userId, financialYearId, { client });

        await logAudit(client, {
            module_name: "Customers",
            page_name: "Create Customer",
            table_name: "tbl_party",
            table_id: customerDetails.basic.party_id,
            action_type: "CREATE",
            action_description: "Customer Created Successfully",
            new_value: JSON.stringify(customerDetails),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({
            message: "Customer created successfully",
            customerId: customerDetails.basic.party_id,
            partyCode: customerDetails.basic.party_code,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error("[createCustomers]", err);
        return res.status(500).json({ error: "Failed to create customer", details: err.message });
    } finally {
        client.release();
    }
}

export async function updateCustomers(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const { customerId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query('BEGIN');

        const customerData = { ...req.body, party_type: "CUSTOMER", document_type_id: DOCUMENT_TYPES.CUSTOMER };
        const customerDetails = await UpdateParty(customerId, customerData, companyId, userId, financialYearId, { client });

        await logAudit(client, {
            module_name: "Customers",
            page_name: "Update Customer",
            table_name: "tbl_party",
            table_id: customerDetails.basic.party_id,
            action_type: "UPDATE",
            action_description: "Customer Updated Successfully",
            new_value: JSON.stringify(customerDetails),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({
            message: "Customer updated successfully",
            customerId: customerDetails.basic.party_id,
            partyCode: customerDetails.basic.party_code,
        });

    }   catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error("[updateCustomers]", err);
        return res.status(500).json({ error: "Failed to Update customer", details: err.message });
    } finally {
        client.release();
    }

}

export async function deleteCustomers(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const { customerId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try{
        await client.query('BEGIN');
        const customerData = { party_type: "CUSTOMER", document_type_id: DOCUMENT_TYPES.CUSTOMER };
        const customerDetails = await DeleteParty(customerId, customerData, companyId, userId, financialYearId, { client });

        
        await logAudit(client, {
            module_name: "Customers",
            page_name: "Delete Customer",
            table_name: "tbl_party",
            table_id: customerDetails.basic.party_id,
            action_type: "DELETE",
            action_description: "Customer Delete Successfully",
            new_value: JSON.stringify(customerDetails),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({
            message: "Customer deleted successfully",
            customerId: customerDetails.basic.party_id,
            partyCode: customerDetails.basic.party_code,
        });
    }catch(err){
        await client.query('ROLLBACK').catch(() => {});
        console.error("[deleteCustomers]", err);
        return res.status(500).json({ error: "Failed to delete customer", details: err.message });
    }finally{
        client.release();
    }
}

///////////////Customer Module End///////////////

///////////////Vendor Module Start///////////////
export async function createVendors(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try {
        await client.query('BEGIN');

        const vendorData = { ...req.body, party_type: "VENDOR", document_type_id: DOCUMENT_TYPES.VENDOR };
        const vendorDetails = await addParty(vendorData, companyId, userId, financialYearId, { client });

        await logAudit(client, {
            module_name: "Vendors",
            page_name: "Create Vendor",
            table_name: "tbl_party",
            table_id: vendorDetails.basic.party_id,
            action_type: "CREATE",
            action_description: "Vendor Created Successfully",
            new_value: JSON.stringify(vendorDetails.basic),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({
            message: "Vendor created successfully",
            vendorId: vendorDetails.basic.party_id,
            partyCode: vendorDetails.basic.party_code,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error("[createVendors]", err);
        return res.status(500).json({ error: "Failed to create vendor", details: err.message });
    } finally {
        client.release();
    }
}

export async function viewVendors(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const { vendorId } = req.params;
    // const { financialYearId } = resolveFinancialYearPayload(req);
    const companyPool = await getCompanyPool(companyId);
    let result;
    try{
        if(vendorId){
            const query = `SELECT p.* ,COALESCE(
            (SELECT json_agg(addr) FROM tbl_party_addresses AS addr 
            WHERE addr.party_id = p.party_id AND addr.company_id = p.company_id AND addr.is_deleted = FALSE),'[]'::json) as addresses,
            COALESCE(
            (SELECT json_agg(cont) FROM tbl_party_contact_person AS cont 
            WHERE cont.party_id = p.party_id AND cont.company_id = p.company_id AND cont.is_deleted = FALSE),'[]'::json) as contactPerson
            FROM tbl_party AS p 
            WHERE p.party_id = $1 AND p.company_id = $2 AND p.is_deleted = FALSE AND p.party_type = 'VENDOR'
            ORDER BY p.party_name ASC
            `;
            result = await companyPool.query(query, [vendorId, companyId]);

        }else{
            const query = `SELECT p.* ,COALESCE(
            (SELECT json_agg(addr) FROM tbl_party_addresses AS addr 
            WHERE addr.party_id = p.party_id AND addr.company_id = p.company_id AND addr.is_deleted = FALSE),'[]'::json) as addresses,
            COALESCE(
            (SELECT json_agg(cont) FROM tbl_party_contact_person AS cont 
            WHERE cont.party_id = p.party_id AND cont.company_id = p.company_id AND cont.is_deleted = FALSE),'[]'::json) as contactPerson
            FROM tbl_party AS p 
            WHERE p.company_id = $1 AND p.is_deleted = FALSE AND p.party_type = 'VENDOR'
            ORDER BY p.party_name ASC
            `;
            result = await companyPool.query(query, [companyId]);
        }
        
        return res.status(200).json({ vendors: result.rows });

    }catch (err){
        console.error("[viewVendors]", err);
        return res.status(500).json({ error: "Failed to fetch Vendors List", details: err.message });
    }
}

export async function updateVendors(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const { vendorId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query('BEGIN');

        const vendorData = { ...req.body, party_type: "VENDOR", document_type_id: DOCUMENT_TYPES.VENDOR };
        const vendorDetails = await UpdateParty(vendorId, vendorData, companyId, userId, financialYearId, { client });

        await logAudit(client, {
            module_name: "Vendors",
            page_name: "Update Vendor",
            table_name: "tbl_party",
            table_id: vendorDetails.basic.party_id,
            action_type: "UPDATE",
            action_description: "Vendor Updated Successfully",
            new_value: JSON.stringify(vendorDetails.basic),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({
            message: "Vendor Updated successfully",
            vendorId: vendorDetails.basic.party_id,
            partyCode: vendorDetails.basic.party_code,
        });

    }   catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error("[updateVendors]", err);
        return res.status(500).json({ error: "Failed to Update vendor", details: err.message });
    } finally {
        client.release();
    }

}

export async function deleteVendors(req, res) {
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const { vendorId } = req.params;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);

    try{
        await client.query('BEGIN');
        const vendorData = { party_type: "VENDOR", document_type_id: DOCUMENT_TYPES.VENDOR };
        const vendorDetails = await DeleteParty(vendorId, vendorData, companyId, userId, financialYearId, { client });
        
         await logAudit(client, {
            module_name: "Vendors",
            page_name: "Delete Vendor",
            table_name: "tbl_party",
            table_id: vendorDetails.basic.party_id,
            action_type: "DELETE",
            action_description: "Vendor Deleted Successfully",
            new_value: JSON.stringify(vendorDetails.basic),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query('COMMIT');
        return res.status(201).json({
            message: "Vendor deleted successfully",
            vendorId: vendorDetails.basic.party_id,
            partyCode: vendorDetails.basic.party_code,
        });
    }catch(err){
        await client.query('ROLLBACK').catch(() => {});
        console.error("[deleteVendors]", err);
        return res.status(500).json({ error: "Failed to delete vendor", details: err.message });
    }finally{
        client.release();
    }
}

///////////////Vendor Module End///////////////