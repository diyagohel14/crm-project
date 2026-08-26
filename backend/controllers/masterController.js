import { adminPool } from "../config/adminDb.js";
import { getCompanyPool } from "../config/companyPoolManager.js";
import { logAudit } from "../services/authService.js";
import { getRequestInfo } from "../utils/crypto.js";
import { resolveFinancialYearPayload } from "../utils/financialYear.js";

///////////////////Country Master Start///////////////////////////
export async function viewCountryList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM country_mst WHERE is_deleted=FALSE`
        );
        return res.status(201).json({ message: "fetch Country List", countryList: result.rows });

    } catch (err) {
        console.error("[viewCountryList]", err);
        return res.status(500).json({ error: "Failed to fetch Country List", details: err.message });
    }
}

export async function fetchCountryDropdown(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM country_mst WHERE is_deleted=FALSE AND status='active'`
        );
        return res.status(201).json({ message: "fetch Country", countryDropdown: result.rows });

    } catch (err) {
        console.error("[fetchCountryDropdown]", err);
        return res.status(500).json({ error: "Failed to fetch Country", details: err.message });
    }
}

export async function createCountry(req, res) {
    const { country_name, country_code, phone_code } = req.body;
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO country_mst(country_name, country_code, phone_code, user_id) VALUES ($1, $2, $3, $4) RETURNING *`,
            [country_name, country_code, phone_code, userId]
        );
        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Country Master",
                page_name: "Country Create",
                table_name: "country_mst",
                table_id: result.rows[0].country_id,
                action_type: "CREATE",
                action_description: "Country Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Country Created Successfully", country: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createCountry]", err);
        return res.status(500).json({ error: "Failed to Create Country", details: err.message });
    } finally {
        client.release();
    }
}

export async function viewCountry(req, res) {
    const { countryId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM country_mst WHERE is_deleted=FALSE and country_id=$1`,
            [countryId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Country not found" });
        }
        return res.status(200).json({ message: "Country Fetch Successfully", country: result.rows[0] });

    } catch (err) {
        console.error("[viewCountry]", err);
        return res.status(500).json({ error: "Failed to Get Country id", details: err.message });
    }
}

export async function updateCountry(req, res) {
    const { country_name, country_code, phone_code, status } = req.body;
    const { countryId } = req.params;
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE country_mst SET country_name=$1, country_code=$2, phone_code=$3, status=$4 WHERE country_id=$5 and is_deleted=FALSE RETURNING *`,
            [country_name, country_code, phone_code, status, countryId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Country not found" });
        } else {

            await logAudit(client, {
                module_name: "Country Master",
                page_name: "Country Update",
                table_name: "country_mst",
                table_id: result.rows[0].country_id,
                action_type: "UPDATE",
                action_description: "Country Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Country Updated Successfully", country: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateCountry]", err);
        return res.status(500).json({ error: "Failed to Update Country", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deleteCountry(req, res) {
    const { countryId } = req.params;
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE country_mst SET is_deleted=TRUE, status=$1 WHERE country_id=$2 and is_deleted=FALSE RETURNING *`,
            ['inactive', countryId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Country not found" });
        } else {

            await logAudit(client, {
                module_name: "Country Master",
                page_name: "Country Deleted",
                table_name: "country_mst",
                table_id: result.rows[0].country_id,
                action_type: "DELETE",
                action_description: "Country Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Country Deleted Successfully", country: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteCountry]", err);
        return res.status(500).json({ error: "Failed to Delete Country", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////Country Master End///////////////////////////

///////////////////State Master start///////////////////////////
export async function viewStateList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM state_mst WHERE is_deleted=FALSE`
        );
        return res.status(201).json({ message: "fetch State List", stateList: result.rows });

    } catch (err) {
        console.error("[viewStateList]", err);
        return res.status(500).json({ error: "Failed to fetch State List", details: err.message });
    }
}

export async function createState(req, res) {
    const { country_id, state_name, state_code } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO state_mst(country_id, state_name, state_code, user_id) VALUES ($1, $2, $3, $4) RETURNING *`,
            [country_id, state_name, state_code, userId]
        );

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "State Master",
                page_name: "State Create",
                table_name: "state_mst",
                table_id: result.rows[0].state_id,
                action_type: "CREATE",
                action_description: "State Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "State Created Successfully", state: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createState]", err);
        return res.status(500).json({ error: "Failed to Create State", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function viewState(req, res) {
    const { stateId } = req.params;
    const { companyId, userId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM state_mst WHERE is_deleted=FALSE and state_id=$1`,
            [stateId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "State not found" });
        }
        return res.status(200).json({ message: "State Fetch Successfully", state: result.rows[0] });

    } catch (err) {
        console.error("[viewState]", err);
        return res.status(500).json({ error: "Failed to Get State id", details: err.message });
    }
}

export async function updateState(req, res) {
    const { country_id, state_name, state_code, status } = req.body;
    const { stateId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE state_mst SET state_name=$1, state_code=$2, country_id=$3, status=$4 WHERE state_id=$5 and is_deleted=FALSE RETURNING *`,
            [state_name, state_code, country_id, status, stateId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "State not found" });
        } else {

            await logAudit(client, {
                module_name: "State Master",
                page_name: "State Update",
                table_name: "state_mst",
                table_id: result.rows[0].state_id,
                action_type: "UPDATE",
                action_description: "State Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "State Updated Successfully", state: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateState]", err);
        return res.status(500).json({ error: "Failed to Update State", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deleteState(req, res) {
    const { stateId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE state_mst SET is_deleted=TRUE, status=$1 WHERE state_id=$2 and is_deleted=FALSE RETURNING *`,
            ['inactive', stateId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "State not found" });
        } else {

            await logAudit(client, {
                module_name: "State Master",
                page_name: "State Deleted",
                table_name: "state_mst",
                table_id: result.rows[0].state_id,
                action_type: "DELETE",
                action_description: "State Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "State Deleted Successfully", state: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteState]", err);
        return res.status(500).json({ error: "Failed to Delete State", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////State Master End///////////////////////////

///////////////////City Master Start///////////////////////////
export async function viewCityList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM city_mst WHERE is_deleted=FALSE`
        );
        return res.status(201).json({ message: "fetch City List", cityList: result.rows });

    } catch (err) {
        console.error("[viewCityList]", err);
        return res.status(500).json({ error: "Failed to fetch City List", details: err.message });
    }
}

export async function createCity(req, res) {
    const { state_id, city_name, pincode } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO city_mst(state_id, city_name, pincode, user_id) VALUES ($1, $2, $3, $4) RETURNING *`,
            [state_id, city_name, pincode, userId]
        );

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "City Master",
                page_name: "City Create",
                table_name: "city_mst",
                table_id: result.rows[0].city_id,
                action_type: "CREATE",
                action_description: "City Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "City Created Successfully", city: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createCity]", err);
        return res.status(500).json({ error: "Failed to Create City", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function viewCity(req, res) {
    const { cityId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM city_mst WHERE is_deleted=FALSE and city_id=$1`,
            [cityId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "City not found" });
        }
        return res.status(200).json({ message: "City Fetch Successfully", city: result.rows[0] });

    } catch (err) {
        console.error("[viewCity]", err);
        return res.status(500).json({ error: "Failed to Get City id", details: err.message });
    }
}

export async function updateCity(req, res) {
    const { state_id, city_name, pincode, status } = req.body;
    const { cityId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE city_mst SET city_name=$1, pincode=$2, state_id=$3, status=$4 WHERE city_id=$5 and is_deleted=FALSE RETURNING *`,
            [city_name, pincode, state_id, status, cityId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "City not found" });
        } else {

            await logAudit(client, {
                module_name: "City Master",
                page_name: "City Update",
                table_name: "city_mst",
                table_id: result.rows[0].city_id,
                action_type: "UPDATE",
                action_description: "City Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "City Updated Successfully", city: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateCity]", err);
        return res.status(500).json({ error: "Failed to Update City", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deleteCity(req, res) {
    const { cityId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE city_mst SET is_deleted=TRUE, status=$1 WHERE city_id=$2 and is_deleted=FALSE RETURNING *`,
            ['inactive', cityId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "City not found" });
        } else {

            await logAudit(client, {
                module_name: "City Master",
                page_name: "City Deleted",
                table_name: "city_mst",
                table_id: result.rows[0].city_id,
                action_type: "DELETE",
                action_description: "City Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "City Deleted Successfully", city: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteCity]", err);
        return res.status(500).json({ error: "Failed to Delete City", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////City Master End///////////////////////////

///////////////////Currency Master Start///////////////////////////
export async function viewCurrencyList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM currency_mst WHERE is_deleted=FALSE`
        );
        return res.status(201).json({ message: "fetch Currency List", currencyList: result.rows });

    } catch (err) {
        console.error("[viewCurrencyList]", err);
        return res.status(500).json({ error: "Failed to fetch Currency List", details: err.message });
    }
}

export async function createCurrency(req, res) {
    const { currency_name, currency_code, symbol, exchange_rate, is_base_currency } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO currency_mst(currency_name, currency_code, symbol, exchange_rate, is_base_currency, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [currency_name, currency_code, symbol, exchange_rate, is_base_currency, userId]
        );

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Currency Master",
                page_name: "Currency Create",
                table_name: "currency_mst",
                table_id: result.rows[0].currency_id,
                action_type: "CREATE",
                action_description: "Currency Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Currency Created Successfully", currency: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createCurrency]", err);
        return res.status(500).json({ error: "Failed to Create Currency", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function viewCurrency(req, res) {
    const { currencyId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM currency_mst WHERE is_deleted=FALSE and currency_id=$1`,
            [currencyId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Currency not found" });
        }
        return res.status(200).json({ message: "Currency Fetch Successfully", currency: result.rows[0] });

    } catch (err) {
        console.error("[viewCurrency]", err);
        return res.status(500).json({ error: "Failed to Get Currency id", details: err.message });
    }
}

export async function updateCurrency(req, res) {
    const { currency_name, currency_code, symbol, exchange_rate, is_base_currency, status } = req.body;
    const { currencyId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE currency_mst SET currency_name=$1, currency_code=$2, symbol=$3, exchange_rate=$4, is_base_currency=$5, status=$6 WHERE currency_id=$7 and is_deleted=FALSE RETURNING *`,
            [currency_name, currency_code, symbol, exchange_rate, is_base_currency, status, currencyId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Currency not found" });
        } else {

            await logAudit(client, {
                module_name: "Currency Master",
                page_name: "Currency Update",
                table_name: "currency_mst",
                table_id: result.rows[0].currency_id,
                action_type: "UPDATE",
                action_description: "Currency Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Currency Updated Successfully", currency: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateCurrency]", err);
        return res.status(500).json({ error: "Failed to Update Currency", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deleteCurrency(req, res) {
    const { currencyId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE currency_mst SET is_deleted=TRUE, status=$1 WHERE currency_id=$2 and is_deleted=FALSE RETURNING *`,
            ['inactive', currencyId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Currency not found" });
        } else {

            await logAudit(client, {
                module_name: "Currency Master",
                page_name: "Currency Deleted",
                table_name: "currency_mst",
                table_id: result.rows[0].currency_id,
                action_type: "DELETE",
                action_description: "Currency Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Currency Deleted Successfully", currency: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteCurrency]", err);
        return res.status(500).json({ error: "Failed to Delete Currency", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////Currency Master End///////////////////////////

///////////////////Tax Types Master Start///////////////////////////
export async function viewTaxTypesList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM tax_types WHERE is_deleted=FALSE`
        );
        return res.status(201).json({ message: "fetch TaxTypes List", taxList: result.rows });

    } catch (err) {
        console.error("[viewTaxTypesList]", err);
        return res.status(500).json({ error: "Failed to fetch TaxTypes List", details: err.message });
    }
}

export async function createTaxTypes(req, res) {
    const { tax_name, tax_percentage, tax_type, applicable_on } = req.body; //tax_type('percentage' or 'fixed')  //applicable_on('sales' or 'purchase' or 'both') values
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO tax_types(tax_name, tax_percentage, tax_type, applicable_on, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [tax_name, tax_percentage, tax_type, applicable_on, userId]
        );

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "TaxTypes Master",
                page_name: "TaxTypes Create",
                table_name: "tax_types",
                table_id: result.rows[0].tax_id,
                action_type: "CREATE",
                action_description: "TaxTypes Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "TaxTypes Created Successfully", taxdetails: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createTaxTypes]", err);
        return res.status(500).json({ error: "Failed to Create TaxTypes", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function viewTaxTypes(req, res) {
    const { taxId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM tax_types WHERE is_deleted=FALSE and tax_id=$1`,
            [taxId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "TaxTypes not found" });
        }
        return res.status(200).json({ message: "TaxTypes Fetch Successfully", taxdetails: result.rows[0] });

    } catch (err) {
        console.error("[viewTaxTypes]", err);
        return res.status(500).json({ error: "Failed to Get TaxTypes id", details: err.message });
    }
}

export async function updateTaxTypes(req, res) {
    const { tax_name, tax_percentage, tax_type, applicable_on, status } = req.body;
    const { taxId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE tax_types SET tax_name=$1, tax_percentage=$2, tax_type=$3, applicable_on=$4, status=$5 WHERE tax_id=$6 and is_deleted=FALSE RETURNING *`,
            [tax_name, tax_percentage, tax_type, applicable_on, status, taxId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "TaxTypes not found" });
        } else {

            await logAudit(client, {
                module_name: "TaxTypes Master",
                page_name: "TaxTypes Update",
                table_name: "tax_types",
                table_id: result.rows[0].tax_id,
                action_type: "UPDATE",
                action_description: "TaxTypes Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "TaxTypes Updated Successfully", taxdetails: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateTaxTypes]", err);
        return res.status(500).json({ error: "Failed to Update TaxTypes", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deleteTaxTypes(req, res) {
    const { taxId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE tax_types SET is_deleted=TRUE, status=$1 WHERE tax_id=$2 and is_deleted=FALSE RETURNING *`,
            ['inactive', taxId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "TaxTypes not found" });
        } else {

            await logAudit(client, {
                module_name: "TaxTypes Master",
                page_name: "TaxTypes Deleted",
                table_name: "tax_types",
                table_id: result.rows[0].tax_id,
                action_type: "DELETE",
                action_description: "TaxTypes Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "TaxTypes Deleted Successfully", taxdetails: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteTaxTypes]", err);
        return res.status(500).json({ error: "Failed to Delete TaxTypes", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////Tax Types Master End///////////////////////////

///////////////////Units(UOM) Master Start///////////////////////////
export async function viewUnitsList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM units_of_measure WHERE is_deleted=FALSE`
        );
        return res.status(201).json({ message: "fetch Units List", currencyList: result.rows });

    } catch (err) {
        console.error("[viewUnitsList]", err);
        return res.status(500).json({ error: "Failed to fetch Units List", details: err.message });
    }
}

export async function createUnits(req, res) {
    const { unit_name, unit_code, unit_type } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO units_of_measure(unit_name, unit_code, unit_type, user_id) VALUES ($1, $2, $3, $4) RETURNING *`,
            [unit_name, unit_code, unit_type, userId]
        );

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Units Master",
                page_name: "Units Create",
                table_name: "units_of_measure",
                table_id: result.rows[0].unit_id,
                action_type: "CREATE",
                action_description: "Units Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Units Created Successfully", units_of_measure: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createUnits]", err);
        return res.status(500).json({ error: "Failed to Create Units", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function viewUnits(req, res) {
    const { unitId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM units_of_measure WHERE is_deleted=FALSE and unit_id=$1`,
            [unitId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Units not found" });
        }
        return res.status(200).json({ message: "Units Fetch Successfully", units_of_measure: result.rows[0] });

    } catch (err) {
        console.error("[viewUnits]", err);
        return res.status(500).json({ error: "Failed to Get Units id", details: err.message });
    }
}

export async function updateUnits(req, res) {
    const { unit_name, unit_code, unit_type, status } = req.body;
    const { unitId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE units_of_measure SET unit_name=$1, unit_code=$2, unit_type=$3, status=$4 WHERE unit_id=$5 and is_deleted=FALSE RETURNING *`,
            [unit_name, unit_code, unit_type, status, unitId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Units not found" });
        } else {

            await logAudit(client, {
                module_name: "Units Master",
                page_name: "Units Update",
                table_name: "units_of_measure",
                table_id: result.rows[0].unit_id,
                action_type: "UPDATE",
                action_description: "Units Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Units Updated Successfully", units_of_measure: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateUnits]", err);
        return res.status(500).json({ error: "Failed to Update Units", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deleteUnits(req, res) {
    const { unitId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE units_of_measure SET is_deleted=TRUE, status=$1 WHERE unit_id=$2 and is_deleted=FALSE RETURNING *`,
            ['inactive', unitId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Units not found" });
        } else {

            await logAudit(client, {
                module_name: "Units Master",
                page_name: "Units Deleted",
                table_name: "units_of_measure",
                table_id: result.rows[0].unit_id,
                action_type: "DELETE",
                action_description: "Units Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Units Deleted Successfully", units_of_measure: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteUnits]", err);
        return res.status(500).json({ error: "Failed to Delete Units", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////Units(UOM) Master End///////////////////////////

///////////////////Financial Year Master Start///////////////////////////
export async function viewFinancialYearList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM financial_years WHERE is_deleted=FALSE ORDER BY start_date DESC`
        );
        return res.status(200).json({ message: "fetch Financial Year List", financialYearList: result.rows });
    } catch (err) {
        console.error("[viewFinancialYearList]", err);
        return res.status(500).json({ error: "Failed to fetch Financial Year List", details: err.message });
    }
}

export async function createFinancialYear(req, res) {
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    const financialYearPayload = resolveFinancialYearPayload(req.body);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO financial_years(fy_name, start_date, end_date, is_current, status, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [financialYearPayload.fy_name, financialYearPayload.start_date, financialYearPayload.end_date, financialYearPayload.is_current, financialYearPayload.status, userId]
        );

        if (financialYearPayload.is_current) {
            await client.query(
                `UPDATE financial_years SET is_current=FALSE, status=CASE WHEN status='active' THEN 'closed' ELSE status END WHERE is_deleted=FALSE AND financial_year_id <> $1`,
                [result.rows[0].financial_year_id]
            );
        }

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Financial Year Master",
                page_name: "Financial Year Create",
                table_name: "financial_years",
                table_id: result.rows[0].financial_year_id,
                action_type: "CREATE",
                action_description: "Financial Year Created Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(201).json({ message: "Financial Year Created Successfully", financialYear: result.rows[0] });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createFinancialYear]", err);
        return res.status(500).json({ error: "Failed to Create Financial Year", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function viewFinancialYear(req, res) {
    const { financialYearId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM financial_years WHERE is_deleted=FALSE AND financial_year_id=$1`,
            [financialYearId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Financial Year not found" });
        }
        return res.status(200).json({ message: "Financial Year Fetch Successfully", financialYear: result.rows[0] });
    } catch (err) {
        console.error("[viewFinancialYear]", err);
        return res.status(500).json({ error: "Failed to Get Financial Year", details: err.message });
    }
}

export async function updateFinancialYear(req, res) {
    const { financialYearId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    const financialYearPayload = resolveFinancialYearPayload(req.body);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE financial_years SET fy_name=$1, start_date=$2, end_date=$3, is_current=$4, status=$5 WHERE financial_year_id=$6 AND is_deleted=FALSE RETURNING *`,
            [financialYearPayload.fy_name, financialYearPayload.start_date, financialYearPayload.end_date, financialYearPayload.is_current, financialYearPayload.status, financialYearId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Financial Year not found" });
        }

        if (financialYearPayload.is_current) {
            await client.query(
                `UPDATE financial_years SET is_current=FALSE, status=CASE WHEN status='active' THEN 'closed' ELSE status END WHERE is_deleted=FALSE AND financial_year_id <> $1`,
                [result.rows[0].financial_year_id]
            );
        }

        if (result.rows.length !== 0) {
            await logAudit(client, {
                module_name: "Financial Year Master",
                page_name: "Financial Year Update",
                table_name: "financial_years",
                table_id: result.rows[0].financial_year_id,
                action_type: "UPDATE",
                action_description: "Financial Year Updated Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(200).json({ message: "Financial Year Updated Successfully", financialYear: result.rows[0] });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updateFinancialYear]", err);
        return res.status(500).json({ error: "Failed to Update Financial Year", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deleteFinancialYear(req, res) {
    const { financialYearId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE financial_years SET is_deleted=TRUE, status=$1, is_current=FALSE WHERE financial_year_id=$2 AND is_deleted=FALSE RETURNING *`,
            ['closed', financialYearId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "FinancialYear not found" });
        } else {

            await logAudit(client, {
                module_name: "Financial Year Master",
                page_name: "Financial Year Deleted",
                table_name: "financial_years",
                table_id: result.rows[0].financial_year_id,
                action_type: "DELETE",
                action_description: "Financial Year Deleted Successfully",
                new_value: JSON.stringify(result.rows[0]),
                user_id: userId,
                role_id: roleId,
                ip_address: ipAddress,
                device_info: deviceInfo,
                company_id: companyId
            });
        }

        await client.query("COMMIT");
        return res.status(200).json({ message: "Financial Year Deleted Successfully", financialYear: result.rows[0] });
    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deleteFinancialYear]", err);
        return res.status(500).json({ error: "Failed to Delete Financial Year", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////Financial Year Master End///////////////////////////

///////////////////Payment Terms Master Start///////////////////////////
export async function viewPaymentTermsList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM payment_terms WHERE is_deleted=FALSE AND company_id=$1`,
            [companyId]
        );
        return res.status(201).json({ message: "fetch PaymentTerms List", paymentTemsList: result.rows });

    } catch (err) {
        console.error("[viewPaymentTermsList]", err);
        return res.status(500).json({ error: "Failed to fetch PaymentTerms List", details: err.message });
    }
}

export async function createPaymentTerms(req, res) {
    const { term_name, days, status } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `INSERT INTO payment_terms(term_name, days, status, company_id, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [term_name, days, status, companyId, userId]
        );

        await logAudit(client, {
            module_name: "PaymentTerms Master",
            page_name: "PaymentTerms Create",
            table_name: "payment_terms",
            table_id: result.rows[0].payment_term_id,
            action_type: "CREATE",
            action_description: "PaymentTerms Created Successfully",
            new_value: JSON.stringify(result.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");
        return res.status(201).json({ message: "PaymentTerms Created Successfully", paymentTems: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[createPaymentTerms]", err);
        return res.status(500).json({ error: "Failed to Create PaymentTerms", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function viewPaymentTerms(req, res) {
    const { paymentTermId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM payment_terms WHERE is_deleted=FALSE and payment_term_id=$1`,
            [paymentTermId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "PaymentTerms not found" });
        }
        return res.status(200).json({ message: "PaymentTerms Fetch Successfully", paymentTems: result.rows[0] });

    } catch (err) {
        console.error("[viewPaymentTerms]", err);
        return res.status(500).json({ error: "Failed to Get PaymentTerms id", details: err.message });
    }
}

export async function updatePaymentTerms(req, res) {
    const { term_name, days, status } = req.body;
    const { paymentTermId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE payment_terms SET term_name=$1, days=$2, status=$3 WHERE payment_term_id=$4 and is_deleted=FALSE RETURNING *`,
            [term_name, days, status, paymentTermId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "PaymentTerms not found" });
        }

        await logAudit(client, {
            module_name: "PaymentTerms Master",
            page_name: "PaymentTerms Update",
            table_name: "payment_terms",
            table_id: result.rows[0].payment_term_id,
            action_type: "UPDATE",
            action_description: "PaymentTerms Updated Successfully",
            new_value: JSON.stringify(result.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");
        return res.status(201).json({ message: "PaymentTerms Updated Successfully", paymentTems: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[updatePaymentTerms]", err);
        return res.status(500).json({ error: "Failed to Update PaymentTerms", details: err.message });
    }
    finally {
        client.release();
    }
}

export async function deletePaymentTerms(req, res) {
    const { paymentTermId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const client = await companyPool.connect();
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        await client.query("BEGIN");
        const result = await client.query(
            `UPDATE payment_terms SET is_deleted=TRUE, status=$1 WHERE payment_term_id=$2 and is_deleted=FALSE RETURNING *`,
            ['inactive', paymentTermId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "PaymentTerms not found" });
        }

        await logAudit(client, {
            module_name: "PaymentTerms Master",
            page_name: "PaymentTerms Deleted",
            table_name: "currency_mst",
            table_id: result.rows[0].payment_term_id,
            action_type: "DELETE",
            action_description: "PaymentTerms Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });

        await client.query("COMMIT");
        return res.status(201).json({ message: "PaymentTerms Deleted Successfully", paymentTems: result.rows[0] });

    } catch (err) {
        await client.query("ROLLBACK").catch(() => { });
        console.error("[deletePaymentTerms]", err);
        return res.status(500).json({ error: "Failed to Delete PaymentTerms", details: err.message });
    }
    finally {
        client.release();
    }
}

///////////////////Payment Terms Master End///////////////////////////

//AUTO
///////////////////Bank Master Start///////////////////////////
export async function viewBankList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM bank_mst WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch Bank List", bankList: result.rows });
    } catch (err) {
        console.error("[viewBankList]", err);
        return res.status(500).json({ error: "Failed to fetch Bank List", details: err.message });
    }
}

export async function createBank(req, res) {
    const { bank_name } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO bank_mst(bank_name, user_id) VALUES ($1, $2) RETURNING *`,
            [bank_name, userId]
        );
        await logAudit(companyPool, {
            module_name: "Bank Master",
            page_name: "Bank Create",
            table_name: "bank_mst",
            table_id: result.rows[0].bank_id,
            action_type: "CREATE",
            action_description: "Bank Created Successfully",
            new_value: JSON.stringify(result.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });
        return res.status(201).json({ message: "Bank Created Successfully", bank: result.rows[0] });
    } catch (err) {
        console.error("[createBank]", err);
        return res.status(500).json({ error: "Failed to Create Bank", details: err.message });
    }
}

export async function viewBank(req, res) {
    const { bankId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM bank_mst WHERE is_deleted=FALSE and bank_id=$1`, [bankId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Bank not found" });
        return res.status(200).json({ message: "Bank Fetch Successfully", bank: result.rows[0] });
    } catch (err) {
        console.error("[viewBank]", err);
        return res.status(500).json({ error: "Failed to Get Bank", details: err.message });
    }
}

export async function updateBank(req, res) {
    const { bank_name, status } = req.body;
    const { bankId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE bank_mst SET bank_name=$1, status=$2 WHERE bank_id=$3 and is_deleted=FALSE RETURNING *`,
            [bank_name, status, bankId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Bank not found" });
        await logAudit(companyPool, {
            module_name: "Bank Master", page_name: "Bank Update", table_name: "bank_mst",
            table_id: result.rows[0].bank_id, action_type: "UPDATE", action_description: "Bank Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Bank Updated Successfully", bank: result.rows[0] });
    } catch (err) {
        console.error("[updateBank]", err);
        return res.status(500).json({ error: "Failed to Update Bank", details: err.message });
    }
}

export async function deleteBank(req, res) {
    const { bankId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE bank_mst SET is_deleted=TRUE, status='inactive' WHERE bank_id=$1 and is_deleted=FALSE RETURNING *`,
            [bankId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Bank not found" });
        await logAudit(companyPool, {
            module_name: "Bank Master", page_name: "Bank Deleted", table_name: "bank_mst",
            table_id: result.rows[0].bank_id, action_type: "DELETE", action_description: "Bank Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Bank Deleted Successfully", bank: result.rows[0] });
    } catch (err) {
        console.error("[deleteBank]", err);
        return res.status(500).json({ error: "Failed to Delete Bank", details: err.message });
    }
}
///////////////////Bank Master End///////////////////////////

///////////////////CR/DR Reason Master Start///////////////////////////
export async function viewCrDrReasonList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM cr_dr_reason_mst WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch CrDrReason List", crDrReasonList: result.rows });
    } catch (err) {
        console.error("[viewCrDrReasonList]", err);
        return res.status(500).json({ error: "Failed to fetch CrDrReason List", details: err.message });
    }
}

export async function createCrDrReason(req, res) {
    const { form_type, reason_name } = req.body; // form_type: 'credit' | 'debit'
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO cr_dr_reason_mst(form_type, reason_name, user_id) VALUES ($1, $2, $3) RETURNING *`,
            [form_type, reason_name, userId]
        );
        await logAudit(companyPool, {
            module_name: "CrDrReason Master", page_name: "CrDrReason Create", table_name: "cr_dr_reason_mst",
            table_id: result.rows[0].reason_id, action_type: "CREATE", action_description: "CrDrReason Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "CrDrReason Created Successfully", reason: result.rows[0] });
    } catch (err) {
        console.error("[createCrDrReason]", err);
        return res.status(500).json({ error: "Failed to Create CrDrReason", details: err.message });
    }
}

export async function viewCrDrReason(req, res) {
    const { reasonId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM cr_dr_reason_mst WHERE is_deleted=FALSE and reason_id=$1`, [reasonId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Reason not found" });
        return res.status(200).json({ message: "CrDrReason Fetch Successfully", reason: result.rows[0] });
    } catch (err) {
        console.error("[viewCrDrReason]", err);
        return res.status(500).json({ error: "Failed to Get CrDrReason", details: err.message });
    }
}

export async function updateCrDrReason(req, res) {
    const { form_type, reason_name, status } = req.body;
    const { reasonId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE cr_dr_reason_mst SET form_type=$1, reason_name=$2, status=$3 WHERE reason_id=$4 and is_deleted=FALSE RETURNING *`,
            [form_type, reason_name, status, reasonId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Reason not found" });
        await logAudit(companyPool, {
            module_name: "CrDrReason Master", page_name: "CrDrReason Update", table_name: "cr_dr_reason_mst",
            table_id: result.rows[0].reason_id, action_type: "UPDATE", action_description: "CrDrReason Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "CrDrReason Updated Successfully", reason: result.rows[0] });
    } catch (err) {
        console.error("[updateCrDrReason]", err);
        return res.status(500).json({ error: "Failed to Update CrDrReason", details: err.message });
    }
}

export async function deleteCrDrReason(req, res) {
    const { reasonId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE cr_dr_reason_mst SET is_deleted=TRUE, status='inactive' WHERE reason_id=$1 and is_deleted=FALSE RETURNING *`,
            [reasonId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Reason not found" });
        await logAudit(companyPool, {
            module_name: "CrDrReason Master", page_name: "CrDrReason Deleted", table_name: "cr_dr_reason_mst",
            table_id: result.rows[0].reason_id, action_type: "DELETE", action_description: "CrDrReason Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "CrDrReason Deleted Successfully", reason: result.rows[0] });
    } catch (err) {
        console.error("[deleteCrDrReason]", err);
        return res.status(500).json({ error: "Failed to Delete CrDrReason", details: err.message });
    }
}
///////////////////CR/DR Reason Master End///////////////////////////

///////////////////Chart Of Accounts Start///////////////////////////
export async function viewChartOfAccountsList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM chart_of_accounts WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch ChartOfAccounts List", accountList: result.rows });
    } catch (err) {
        console.error("[viewChartOfAccountsList]", err);
        return res.status(500).json({ error: "Failed to fetch ChartOfAccounts List", details: err.message });
    }
}

export async function createChartOfAccounts(req, res) {
    const { account_code, account_name, account_type, parent_account_id } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO chart_of_accounts(account_code, account_name, account_type, parent_account_id, user_id)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [account_code, account_name, account_type, parent_account_id ?? null, userId]
        );
        await logAudit(companyPool, {
            module_name: "Chart Of Accounts", page_name: "Account Create", table_name: "chart_of_accounts",
            table_id: result.rows[0].account_id, action_type: "CREATE", action_description: "Account Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "Account Created Successfully", account: result.rows[0] });
    } catch (err) {
        console.error("[createChartOfAccounts]", err);
        return res.status(500).json({ error: "Failed to Create Account", details: err.message });
    }
}

export async function viewChartOfAccounts(req, res) {
    const { accountId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM chart_of_accounts WHERE is_deleted=FALSE and account_id=$1`, [accountId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
        return res.status(200).json({ message: "Account Fetch Successfully", account: result.rows[0] });
    } catch (err) {
        console.error("[viewChartOfAccounts]", err);
        return res.status(500).json({ error: "Failed to Get Account", details: err.message });
    }
}

export async function updateChartOfAccounts(req, res) {
    const { account_code, account_name, account_type, parent_account_id, status } = req.body;
    const { accountId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        // guard against an account being made its own ancestor
        if (parent_account_id && Number(parent_account_id) === Number(accountId)) {
            return res.status(400).json({ error: "An account cannot be its own parent" });
        }
        const result = await companyPool.query(
            `UPDATE chart_of_accounts SET account_code=$1, account_name=$2, account_type=$3, parent_account_id=$4, status=$5
             WHERE account_id=$6 and is_deleted=FALSE RETURNING *`,
            [account_code, account_name, account_type, parent_account_id ?? null, status, accountId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
        await logAudit(companyPool, {
            module_name: "Chart Of Accounts", page_name: "Account Update", table_name: "chart_of_accounts",
            table_id: result.rows[0].account_id, action_type: "UPDATE", action_description: "Account Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Account Updated Successfully", account: result.rows[0] });
    } catch (err) {
        console.error("[updateChartOfAccounts]", err);
        return res.status(500).json({ error: "Failed to Update Account", details: err.message });
    }
}

export async function deleteChartOfAccounts(req, res) {
    const { accountId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const childCheck = await companyPool.query(
            `SELECT COUNT(*)::int AS count FROM chart_of_accounts WHERE parent_account_id=$1 AND is_deleted=FALSE`,
            [accountId]
        );
        if (childCheck.rows[0].count > 0) {
            return res.status(409).json({ error: "Cannot delete an account that has child accounts" });
        }
        const result = await companyPool.query(
            `UPDATE chart_of_accounts SET is_deleted=TRUE, status='inactive' WHERE account_id=$1 and is_deleted=FALSE RETURNING *`,
            [accountId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Account not found" });
        await logAudit(companyPool, {
            module_name: "Chart Of Accounts", page_name: "Account Deleted", table_name: "chart_of_accounts",
            table_id: result.rows[0].account_id, action_type: "DELETE", action_description: "Account Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Account Deleted Successfully", account: result.rows[0] });
    } catch (err) {
        console.error("[deleteChartOfAccounts]", err);
        return res.status(500).json({ error: "Failed to Delete Account", details: err.message });
    }
}
///////////////////Chart Of Accounts End///////////////////////////

///////////////////Department Master Start///////////////////////////
export async function viewDepartmentList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM departments WHERE is_deleted=FALSE AND company_id=$1`, [companyId]);
        return res.status(200).json({ message: "fetch Department List", departmentList: result.rows });
    } catch (err) {
        console.error("[viewDepartmentList]", err);
        return res.status(500).json({ error: "Failed to fetch Department List", details: err.message });
    }
}

export async function createDepartment(req, res) {
    const { department_name } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO departments(department_name, user_id, company_id) VALUES ($1, $2, $3) RETURNING *`,
            [department_name, userId, companyId]
        );
        await logAudit(companyPool, {
            module_name: "Department Master", page_name: "Department Create", table_name: "departments",
            table_id: result.rows[0].department_id, action_type: "CREATE", action_description: "Department Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "Department Created Successfully", department: result.rows[0] });
    } catch (err) {
        console.error("[createDepartment]", err);
        return res.status(500).json({ error: "Failed to Create Department", details: err.message });
    }
}

export async function viewDepartment(req, res) {
    const { departmentId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM departments WHERE is_deleted=FALSE and department_id=$1 AND company_id=$2`,
            [departmentId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Department not found" });
        return res.status(200).json({ message: "Department Fetch Successfully", department: result.rows[0] });
    } catch (err) {
        console.error("[viewDepartment]", err);
        return res.status(500).json({ error: "Failed to Get Department", details: err.message });
    }
}

export async function updateDepartment(req, res) {
    const { department_name } = req.body;
    const { departmentId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE departments SET department_name=$1 WHERE department_id=$2 and is_deleted=FALSE AND company_id=$3 RETURNING *`,
            [department_name, departmentId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Department not found" });
        await logAudit(companyPool, {
            module_name: "Department Master", page_name: "Department Update", table_name: "departments",
            table_id: result.rows[0].department_id, action_type: "UPDATE", action_description: "Department Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Department Updated Successfully", department: result.rows[0] });
    } catch (err) {
        console.error("[updateDepartment]", err);
        return res.status(500).json({ error: "Failed to Update Department", details: err.message });
    }
}

export async function deleteDepartment(req, res) {
    const { departmentId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const inUse = await companyPool.query(
            `SELECT COUNT(*)::int AS count FROM users WHERE department_id=$1 AND is_deleted=FALSE`,
            [departmentId]
        );
        if (inUse.rows[0].count > 0) {
            return res.status(409).json({ error: "Cannot delete department - users are still assigned to it" });
        }
        const result = await companyPool.query(
            `UPDATE departments SET is_deleted=TRUE WHERE department_id=$1 and is_deleted=FALSE AND company_id=$2 RETURNING *`,
            [departmentId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Department not found" });
        await logAudit(companyPool, {
            module_name: "Department Master", page_name: "Department Deleted", table_name: "departments",
            table_id: result.rows[0].department_id, action_type: "DELETE", action_description: "Department Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Department Deleted Successfully", department: result.rows[0] });
    } catch (err) {
        console.error("[deleteDepartment]", err);
        return res.status(500).json({ error: "Failed to Delete Department", details: err.message });
    }
}
///////////////////Department Master End///////////////////////////

///////////////////Branch Master Start///////////////////////////
export async function viewBranchList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM branch_mst WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch Branch List", branchList: result.rows });
    } catch (err) {
        console.error("[viewBranchList]", err);
        return res.status(500).json({ error: "Failed to fetch Branch List", details: err.message });
    }
}

export async function createBranch(req, res) {
    const { branch_name, city_id } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO branch_mst(branch_name, city_id, user_id) VALUES ($1, $2, $3) RETURNING *`,
            [branch_name, city_id ?? null, userId]
        );
        await logAudit(companyPool, {
            module_name: "Branch Master", page_name: "Branch Create", table_name: "branch_mst",
            table_id: result.rows[0].branch_id, action_type: "CREATE", action_description: "Branch Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "Branch Created Successfully", branch: result.rows[0] });
    } catch (err) {
        console.error("[createBranch]", err);
        return res.status(500).json({ error: "Failed to Create Branch", details: err.message });
    }
}

export async function viewBranch(req, res) {
    const { branchId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM branch_mst WHERE is_deleted=FALSE and branch_id=$1`, [branchId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Branch not found" });
        return res.status(200).json({ message: "Branch Fetch Successfully", branch: result.rows[0] });
    } catch (err) {
        console.error("[viewBranch]", err);
        return res.status(500).json({ error: "Failed to Get Branch", details: err.message });
    }
}

export async function updateBranch(req, res) {
    const { branch_name, city_id, status } = req.body;
    const { branchId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE branch_mst SET branch_name=$1, city_id=$2, status=$3 WHERE branch_id=$4 and is_deleted=FALSE RETURNING *`,
            [branch_name, city_id ?? null, status, branchId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Branch not found" });
        await logAudit(companyPool, {
            module_name: "Branch Master", page_name: "Branch Update", table_name: "branch_mst",
            table_id: result.rows[0].branch_id, action_type: "UPDATE", action_description: "Branch Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Branch Updated Successfully", branch: result.rows[0] });
    } catch (err) {
        console.error("[updateBranch]", err);
        return res.status(500).json({ error: "Failed to Update Branch", details: err.message });
    }
}

export async function deleteBranch(req, res) {
    const { branchId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE branch_mst SET is_deleted=TRUE, status='inactive' WHERE branch_id=$1 and is_deleted=FALSE RETURNING *`,
            [branchId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Branch not found" });
        await logAudit(companyPool, {
            module_name: "Branch Master", page_name: "Branch Deleted", table_name: "branch_mst",
            table_id: result.rows[0].branch_id, action_type: "DELETE", action_description: "Branch Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Branch Deleted Successfully", branch: result.rows[0] });
    } catch (err) {
        console.error("[deleteBranch]", err);
        return res.status(500).json({ error: "Failed to Delete Branch", details: err.message });
    }
}
///////////////////Branch Master End///////////////////////////

///////////////////Designation Master Start///////////////////////////
export async function viewDesignationList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM designations WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch Designation List", designationList: result.rows });
    } catch (err) {
        console.error("[viewDesignationList]", err);
        return res.status(500).json({ error: "Failed to fetch Designation List", details: err.message });
    }
}

export async function createDesignation(req, res) {
    const { designation_name, department_id } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO designations(designation_name, department_id) VALUES ($1, $2) RETURNING *`,
            [designation_name, department_id ?? null]
        );
        await logAudit(companyPool, {
            module_name: "Designation Master", page_name: "Designation Create", table_name: "designations",
            table_id: result.rows[0].designation_id, action_type: "CREATE", action_description: "Designation Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "Designation Created Successfully", designation: result.rows[0] });
    } catch (err) {
        console.error("[createDesignation]", err);
        return res.status(500).json({ error: "Failed to Create Designation", details: err.message });
    }
}

export async function viewDesignation(req, res) {
    const { designationId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM designations WHERE is_deleted=FALSE and designation_id=$1`, [designationId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Designation not found" });
        return res.status(200).json({ message: "Designation Fetch Successfully", designation: result.rows[0] });
    } catch (err) {
        console.error("[viewDesignation]", err);
        return res.status(500).json({ error: "Failed to Get Designation", details: err.message });
    }
}

export async function updateDesignation(req, res) {
    const { designation_name, department_id, status } = req.body;
    const { designationId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE designations SET designation_name=$1, department_id=$2, status=$3 WHERE designation_id=$4 and is_deleted=FALSE RETURNING *`,
            [designation_name, department_id ?? null, status, designationId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Designation not found" });
        await logAudit(companyPool, {
            module_name: "Designation Master", page_name: "Designation Update", table_name: "designations",
            table_id: result.rows[0].designation_id, action_type: "UPDATE", action_description: "Designation Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Designation Updated Successfully", designation: result.rows[0] });
    } catch (err) {
        console.error("[updateDesignation]", err);
        return res.status(500).json({ error: "Failed to Update Designation", details: err.message });
    }
}

export async function deleteDesignation(req, res) {
    const { designationId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE designations SET is_deleted=TRUE, status='inactive' WHERE designation_id=$1 and is_deleted=FALSE RETURNING *`,
            [designationId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Designation not found" });
        await logAudit(companyPool, {
            module_name: "Designation Master", page_name: "Designation Deleted", table_name: "designations",
            table_id: result.rows[0].designation_id, action_type: "DELETE", action_description: "Designation Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Designation Deleted Successfully", designation: result.rows[0] });
    } catch (err) {
        console.error("[deleteDesignation]", err);
        return res.status(500).json({ error: "Failed to Delete Designation", details: err.message });
    }
}
///////////////////Designation Master End///////////////////////////

///////////////////Shift Master Start///////////////////////////
export async function viewShiftList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM shift_master WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch Shift List", shiftList: result.rows });
    } catch (err) {
        console.error("[viewShiftList]", err);
        return res.status(500).json({ error: "Failed to fetch Shift List", details: err.message });
    }
}

export async function createShift(req, res) {
    const { shift_name, start_time, end_time } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO shift_master(shift_name, start_time, end_time) VALUES ($1, $2, $3) RETURNING *`,
            [shift_name, start_time, end_time]
        );
        await logAudit(companyPool, {
            module_name: "Shift Master", page_name: "Shift Create", table_name: "shift_master",
            table_id: result.rows[0].shift_id, action_type: "CREATE", action_description: "Shift Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "Shift Created Successfully", shift: result.rows[0] });
    } catch (err) {
        console.error("[createShift]", err);
        return res.status(500).json({ error: "Failed to Create Shift", details: err.message });
    }
}

export async function viewShift(req, res) {
    const { shiftId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM shift_master WHERE is_deleted=FALSE and shift_id=$1`, [shiftId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Shift not found" });
        return res.status(200).json({ message: "Shift Fetch Successfully", shift: result.rows[0] });
    } catch (err) {
        console.error("[viewShift]", err);
        return res.status(500).json({ error: "Failed to Get Shift", details: err.message });
    }
}

export async function updateShift(req, res) {
    const { shift_name, start_time, end_time, status } = req.body;
    const { shiftId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE shift_master SET shift_name=$1, start_time=$2, end_time=$3, status=$4 WHERE shift_id=$5 and is_deleted=FALSE RETURNING *`,
            [shift_name, start_time, end_time, status, shiftId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Shift not found" });
        await logAudit(companyPool, {
            module_name: "Shift Master",
            page_name: "Shift Update",
            table_name: "shift_master",
            table_id: result.rows[0].shift_id,
            action_type: "UPDATE",
            action_description: "Shift Updated Successfully",
            new_value: JSON.stringify(result.rows[0]),
            user_id: userId,
            role_id: roleId,
            ip_address: ipAddress,
            device_info: deviceInfo,
            company_id: companyId
        });
        return res.status(200).json({ message: "Shift Updated Successfully", shift: result.rows[0] });
    } catch (err) {
        console.error("[updateShift]", err);
        return res.status(500).json({ error: "Failed to Update Shift", details: err.message });
    }
}

export async function deleteShift(req, res) {
    const { shiftId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE shift_master SET is_deleted=TRUE, status='inactive' WHERE shift_id=$1 and is_deleted=FALSE RETURNING *`,
            [shiftId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Shift not found" });
        await logAudit(companyPool, {
            module_name: "Shift Master", page_name: "Shift Deleted", table_name: "shift_master",
            table_id: result.rows[0].shift_id, action_type: "DELETE", action_description: "Shift Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Shift Deleted Successfully", shift: result.rows[0] });
    } catch (err) {
        console.error("[deleteShift]", err);
        return res.status(500).json({ error: "Failed to Delete Shift", details: err.message });
    }
}
///////////////////Shift Master End///////////////////////////

///////////////////Holiday Master Start///////////////////////////
export async function viewHolidayList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM holiday_master WHERE is_deleted=FALSE ORDER BY holiday_date`);
        return res.status(200).json({ message: "fetch Holiday List", holidayList: result.rows });
    } catch (err) {
        console.error("[viewHolidayList]", err);
        return res.status(500).json({ error: "Failed to fetch Holiday List", details: err.message });
    }
}

export async function createHoliday(req, res) {
    const { holiday_name, holiday_date, branch_id } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO holiday_master(holiday_name, holiday_date, branch_id) VALUES ($1, $2, $3) RETURNING *`,
            [holiday_name, holiday_date, branch_id ?? null]
        );
        await logAudit(companyPool, {
            module_name: "Holiday Master", page_name: "Holiday Create", table_name: "holiday_master",
            table_id: result.rows[0].holiday_id, action_type: "CREATE", action_description: "Holiday Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "Holiday Created Successfully", holiday: result.rows[0] });
    } catch (err) {
        console.error("[createHoliday]", err);
        return res.status(500).json({ error: "Failed to Create Holiday", details: err.message });
    }
}

export async function viewHoliday(req, res) {
    const { holidayId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM holiday_master WHERE is_deleted=FALSE and holiday_id=$1`, [holidayId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Holiday not found" });
        return res.status(200).json({ message: "Holiday Fetch Successfully", holiday: result.rows[0] });
    } catch (err) {
        console.error("[viewHoliday]", err);
        return res.status(500).json({ error: "Failed to Get Holiday", details: err.message });
    }
}

export async function updateHoliday(req, res) {
    const { holiday_name, holiday_date, branch_id, status } = req.body;
    const { holidayId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE holiday_master SET holiday_name=$1, holiday_date=$2, branch_id=$3, status=$4 WHERE holiday_id=$5 and is_deleted=FALSE RETURNING *`,
            [holiday_name, holiday_date, branch_id ?? null, status, holidayId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Holiday not found" });
        await logAudit(companyPool, {
            module_name: "Holiday Master", page_name: "Holiday Update", table_name: "holiday_master",
            table_id: result.rows[0].holiday_id, action_type: "UPDATE", action_description: "Holiday Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Holiday Updated Successfully", holiday: result.rows[0] });
    } catch (err) {
        console.error("[updateHoliday]", err);
        return res.status(500).json({ error: "Failed to Update Holiday", details: err.message });
    }
}

export async function deleteHoliday(req, res) {
    const { holidayId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE holiday_master SET is_deleted=TRUE, status='inactive' WHERE holiday_id=$1 and is_deleted=FALSE RETURNING *`,
            [holidayId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Holiday not found" });
        await logAudit(companyPool, {
            module_name: "Holiday Master", page_name: "Holiday Deleted", table_name: "holiday_master",
            table_id: result.rows[0].holiday_id, action_type: "DELETE", action_description: "Holiday Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "Holiday Deleted Successfully", holiday: result.rows[0] });
    } catch (err) {
        console.error("[deleteHoliday]", err);
        return res.status(500).json({ error: "Failed to Delete Holiday", details: err.message });
    }
}
///////////////////Holiday Master End///////////////////////////

///////////////////Cost Center Master Start///////////////////////////
export async function viewCostCenterList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM cost_centers WHERE is_deleted=FALSE`);
        return res.status(200).json({ message: "fetch CostCenter List", costCenterList: result.rows });
    } catch (err) {
        console.error("[viewCostCenterList]", err);
        return res.status(500).json({ error: "Failed to fetch CostCenter List", details: err.message });
    }
}

export async function createCostCenter(req, res) {
    const { cost_center_name, department_id } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO cost_centers(cost_center_name, department_id) VALUES ($1, $2) RETURNING *`,
            [cost_center_name, department_id ?? null]
        );
        await logAudit(companyPool, {
            module_name: "Cost Center Master", page_name: "CostCenter Create", table_name: "cost_centers",
            table_id: result.rows[0].cost_center_id, action_type: "CREATE", action_description: "CostCenter Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "CostCenter Created Successfully", costCenter: result.rows[0] });
    } catch (err) {
        console.error("[createCostCenter]", err);
        return res.status(500).json({ error: "Failed to Create CostCenter", details: err.message });
    }
}

export async function viewCostCenter(req, res) {
    const { costCenterId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM cost_centers WHERE is_deleted=FALSE and cost_center_id=$1`, [costCenterId]);
        if (result.rows.length === 0) return res.status(404).json({ error: "CostCenter not found" });
        return res.status(200).json({ message: "CostCenter Fetch Successfully", costCenter: result.rows[0] });
    } catch (err) {
        console.error("[viewCostCenter]", err);
        return res.status(500).json({ error: "Failed to Get CostCenter", details: err.message });
    }
}

export async function updateCostCenter(req, res) {
    const { cost_center_name, department_id, status } = req.body;
    const { costCenterId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE cost_centers SET cost_center_name=$1, department_id=$2, status=$3 WHERE cost_center_id=$4 and is_deleted=FALSE RETURNING *`,
            [cost_center_name, department_id ?? null, status, costCenterId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "CostCenter not found" });
        await logAudit(companyPool, {
            module_name: "Cost Center Master", page_name: "CostCenter Update", table_name: "cost_centers",
            table_id: result.rows[0].cost_center_id, action_type: "UPDATE", action_description: "CostCenter Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "CostCenter Updated Successfully", costCenter: result.rows[0] });
    } catch (err) {
        console.error("[updateCostCenter]", err);
        return res.status(500).json({ error: "Failed to Update CostCenter", details: err.message });
    }
}

export async function deleteCostCenter(req, res) {
    const { costCenterId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE cost_centers SET is_deleted=TRUE, status='inactive' WHERE cost_center_id=$1 and is_deleted=FALSE RETURNING *`,
            [costCenterId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "CostCenter not found" });
        await logAudit(companyPool, {
            module_name: "Cost Center Master", page_name: "CostCenter Deleted", table_name: "cost_centers",
            table_id: result.rows[0].cost_center_id, action_type: "DELETE", action_description: "CostCenter Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "CostCenter Deleted Successfully", costCenter: result.rows[0] });
    } catch (err) {
        console.error("[deleteCostCenter]", err);
        return res.status(500).json({ error: "Failed to Delete CostCenter", details: err.message });
    }
}
///////////////////Cost Center Master End///////////////////////////

///////////////////Document Type Master Start///////////////////////////
export async function viewDocumentTypeList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM document_type WHERE is_deleted=FALSE AND company_id=$1`, [companyId]);
        return res.status(200).json({ message: "fetch DocumentType List", documentTypeList: result.rows });
    } catch (err) {
        console.error("[viewDocumentTypeList]", err);
        return res.status(500).json({ error: "Failed to fetch DocumentType List", details: err.message });
    }
}

export async function createDocumentType(req, res) {
    const { document_type_name } = req.body;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `INSERT INTO document_type(document_type_name, company_id, user_id) VALUES ($1, $2, $3) RETURNING *`,
            [document_type_name, companyId, userId]
        );
        await logAudit(companyPool, {
            module_name: "Document Type Master", page_name: "DocumentType Create", table_name: "document_type",
            table_id: result.rows[0].doc_type_id, action_type: "CREATE", action_description: "DocumentType Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "DocumentType Created Successfully", documentType: result.rows[0] });
    } catch (err) {
        console.error("[createDocumentType]", err);
        return res.status(500).json({ error: "Failed to Create DocumentType", details: err.message });
    }
}

export async function viewDocumentType(req, res) {
    const { docTypeId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM document_type WHERE is_deleted=FALSE and doc_type_id=$1 AND company_id=$2`,
            [docTypeId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "DocumentType not found" });
        return res.status(200).json({ message: "DocumentType Fetch Successfully", documentType: result.rows[0] });
    } catch (err) {
        console.error("[viewDocumentType]", err);
        return res.status(500).json({ error: "Failed to Get DocumentType", details: err.message });
    }
}

export async function updateDocumentType(req, res) {
    const { document_type_name } = req.body;
    const { docTypeId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE document_type SET document_type_name=$1 WHERE doc_type_id=$2 and is_deleted=FALSE AND company_id=$3 RETURNING *`,
            [document_type_name, docTypeId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "DocumentType not found" });
        await logAudit(companyPool, {
            module_name: "Document Type Master", page_name: "DocumentType Update", table_name: "document_type",
            table_id: result.rows[0].doc_type_id, action_type: "UPDATE", action_description: "DocumentType Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "DocumentType Updated Successfully", documentType: result.rows[0] });
    } catch (err) {
        console.error("[updateDocumentType]", err);
        return res.status(500).json({ error: "Failed to Update DocumentType", details: err.message });
    }
}

export async function deleteDocumentType(req, res) {
    const { docTypeId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const inUse = await companyPool.query(
            `SELECT COUNT(*)::int AS count FROM document_series WHERE document_type_id=$1 AND is_deleted=FALSE`,
            [docTypeId]
        );
        if (inUse.rows[0].count > 0) {
            return res.status(409).json({ error: "Cannot delete - document series still reference this type" });
        }
        const result = await companyPool.query(
            `UPDATE document_type SET is_deleted=TRUE WHERE doc_type_id=$1 and is_deleted=FALSE AND company_id=$2 RETURNING *`,
            [docTypeId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "DocumentType not found" });
        await logAudit(companyPool, {
            module_name: "Document Type Master", page_name: "DocumentType Deleted", table_name: "document_type",
            table_id: result.rows[0].doc_type_id, action_type: "DELETE", action_description: "DocumentType Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "DocumentType Deleted Successfully", documentType: result.rows[0] });
    } catch (err) {
        console.error("[deleteDocumentType]", err);
        return res.status(500).json({ error: "Failed to Delete DocumentType", details: err.message });
    }
}
///////////////////Document Type Master End///////////////////////////

///////////////////Document Series Master Start///////////////////////////
export async function viewDocumentSeriesList(req, res) {
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(`SELECT * FROM document_series WHERE is_deleted=FALSE AND company_id=$1`, [companyId]);
        return res.status(200).json({ message: "fetch DocumentSeries List", documentSeriesList: result.rows });
    } catch (err) {
        console.error("[viewDocumentSeriesList]", err);
        return res.status(500).json({ error: "Failed to fetch DocumentSeries List", details: err.message });
    }
}

export async function createDocumentSeries(req, res) {
    const { document_type_id, prefix, postfix, financial_year_id, padding_length } = req.body;
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    const financialyear_id = financial_year_id ?? financialYearId;
    if (!document_type_id) return res.status(400).json({ error: "document_type_id is required" });
    try {
        const result = await companyPool.query(
            `INSERT INTO document_series(document_type_id, prefix, postfix, financial_year_id, padding_length, company_id, user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [document_type_id, prefix ?? null, postfix ?? null, financialyear_id ?? null, padding_length ?? 5, companyId, userId]
        );
        await logAudit(companyPool, {
            module_name: "Document Series Master", page_name: "DocumentSeries Create", table_name: "document_series",
            table_id: result.rows[0].sequence_id, action_type: "CREATE", action_description: "DocumentSeries Created Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(201).json({ message: "DocumentSeries Created Successfully", documentSeries: result.rows[0] });
    } catch (err) {
        console.error("[createDocumentSeries]", err);
        return res.status(500).json({ error: "Failed to Create DocumentSeries", details: err.message });
    }
}

export async function viewDocumentSeries(req, res) {
    const { sequenceId } = req.params;
    const { companyId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    try {
        const result = await companyPool.query(
            `SELECT * FROM document_series WHERE is_deleted=FALSE and sequence_id=$1 AND company_id=$2`,
            [sequenceId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "DocumentSeries not found" });
        return res.status(200).json({ message: "DocumentSeries Fetch Successfully", documentSeries: result.rows[0] });
    } catch (err) {
        console.error("[viewDocumentSeries]", err);
        return res.status(500).json({ error: "Failed to Get DocumentSeries", details: err.message });
    }
}

export async function updateDocumentSeries(req, res) {
    const { prefix, postfix, financial_year_id, padding_length, status } = req.body;
    const { sequenceId } = req.params;
    const { companyId, userId, roleId, financialYearId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    const financialyear_id = financial_year_id ?? financialYearId;
    try {
        // current_number is deliberately NOT editable here - it's advanced only by the
        // numbering-generation logic elsewhere, never by a manual master-data edit.
        const result = await companyPool.query(
            `UPDATE document_series SET prefix=$1, postfix=$2, financial_year_id=$3, padding_length=$4, status=$5
             WHERE sequence_id=$6 and is_deleted=FALSE AND company_id=$7 RETURNING *`,
            [prefix ?? null, postfix ?? null, financialyear_id ?? null, padding_length ?? 5, status, sequenceId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "DocumentSeries not found" });
        await logAudit(companyPool, {
            module_name: "Document Series Master", page_name: "DocumentSeries Update", table_name: "document_series",
            table_id: result.rows[0].sequence_id, action_type: "UPDATE", action_description: "DocumentSeries Updated Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "DocumentSeries Updated Successfully", documentSeries: result.rows[0] });
    } catch (err) {
        console.error("[updateDocumentSeries]", err);
        return res.status(500).json({ error: "Failed to Update DocumentSeries", details: err.message });
    }
}

export async function deleteDocumentSeries(req, res) {
    const { sequenceId } = req.params;
    const { companyId, userId, roleId } = req.session.user;
    const companyPool = await getCompanyPool(companyId);
    const { ipAddress, deviceInfo } = getRequestInfo(req);
    try {
        const result = await companyPool.query(
            `UPDATE document_series SET is_deleted=TRUE, status='inactive' WHERE sequence_id=$1 and is_deleted=FALSE AND company_id=$2 RETURNING *`,
            [sequenceId, companyId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "DocumentSeries not found" });
        await logAudit(companyPool, {
            module_name: "Document Series Master", page_name: "DocumentSeries Deleted", table_name: "document_series",
            table_id: result.rows[0].sequence_id, action_type: "DELETE", action_description: "DocumentSeries Deleted Successfully",
            new_value: JSON.stringify(result.rows[0]), user_id: userId, role_id: roleId,
            ip_address: ipAddress, device_info: deviceInfo, company_id: companyId
        });
        return res.status(200).json({ message: "DocumentSeries Deleted Successfully", documentSeries: result.rows[0] });
    } catch (err) {
        console.error("[deleteDocumentSeries]", err);
        return res.status(500).json({ error: "Failed to Delete DocumentSeries", details: err.message });
    }
}
///////////////////Document Series Master End///////////////////////////