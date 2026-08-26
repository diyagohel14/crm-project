// routes/masterRoutes.js
import { Router } from "express";
import {
    viewCountryList, fetchCountryDropdown, createCountry, viewCountry, updateCountry, deleteCountry,   //country
    viewStateList, createState, viewState, updateState, deleteState,        //State
    viewCityList, createCity, viewCity, updateCity, deleteCity,        //City
    viewCurrencyList, createCurrency, viewCurrency, updateCurrency, deleteCurrency,        //Currency
    viewTaxTypesList, createTaxTypes, viewTaxTypes, updateTaxTypes, deleteTaxTypes,        //TaxTypes
    viewUnitsList, createUnits, viewUnits, updateUnits, deleteUnits,        //Units
    viewFinancialYearList, createFinancialYear, viewFinancialYear, updateFinancialYear, deleteFinancialYear,        //Financial Year
    viewPaymentTermsList, createPaymentTerms, viewPaymentTerms, updatePaymentTerms, deletePaymentTerms,        //Payment terms
    viewBankList, createBank, viewBank, updateBank, deleteBank,     //bank
    viewCrDrReasonList, createCrDrReason, viewCrDrReason, updateCrDrReason, deleteCrDrReason,   //cr dr reason master
    viewChartOfAccountsList, createChartOfAccounts, viewChartOfAccounts, updateChartOfAccounts, deleteChartOfAccounts,  //chart of account
    viewDepartmentList, createDepartment, viewDepartment, updateDepartment, deleteDepartment,   //Department
    viewBranchList, createBranch, viewBranch, updateBranch, deleteBranch,   //Branch
    viewDesignationList, createDesignation, viewDesignation, updateDesignation, deleteDesignation,  //Designation
    viewShiftList, createShift, viewShift, updateShift, deleteShift,    //Shift
    viewHolidayList, createHoliday, viewHoliday, updateHoliday, deleteHoliday,  //Holiday
    viewCostCenterList, createCostCenter, viewCostCenter, updateCostCenter, deleteCostCenter,   //Cost Center
    viewDocumentTypeList, createDocumentType, viewDocumentType, updateDocumentType, deleteDocumentType, //Document Type
    viewDocumentSeriesList, createDocumentSeries, viewDocumentSeries, updateDocumentSeries, deleteDocumentSeries,   //Document Series

} from "../controllers/masterController.js";

import { requireAuth, requirePermission, requireRole } from "../middleware/authMiddleware.js";

const router = Router();

//Country Master
router.get("/country", requireAuth, requirePermission("country:view"), viewCountryList);    //13    //User for country list
router.get("/countrydd", requireAuth, fetchCountryDropdown);    //User for fetch country DropDown
router.post("/country", requireAuth, requirePermission("country:create"), createCountry);   //14
router.get("/country/:countryId", requireAuth, requirePermission("country:view"), viewCountry);
router.put("/country/:countryId", requireAuth, requirePermission("country:update"), updateCountry);     //15
router.delete("/country/:countryId", requireAuth, requirePermission("country:delete"), deleteCountry);      //16

//State Master
router.get("/state", requireAuth, requirePermission("state:view"), viewStateList);    //17    //User for State list
router.post("/state", requireAuth, requirePermission("state:create"), createState);   //18
router.get("/state/:stateId", requireAuth, requirePermission("state:view"), viewState);
router.put("/state/:stateId", requireAuth, requirePermission("state:update"), updateState);     //19
router.delete("/state/:stateId", requireAuth, requirePermission("state:delete"), deleteState);      //20

//City Master
router.get("/city", requireAuth, requirePermission("city:view"), viewCityList);    //21    //User for City list
router.post("/city", requireAuth, requirePermission("city:create"), createCity);   //22
router.get("/city/:cityId", requireAuth, requirePermission("city:view"), viewCity);
router.put("/city/:cityId", requireAuth, requirePermission("city:update"), updateCity);     //23
router.delete("/city/:cityId", requireAuth, requirePermission("city:delete"), deleteCity);      //24

//Currency Master
router.get("/currency", requireAuth, requirePermission("currency:view"), viewCurrencyList);    //25    //User for Currency list
router.post("/currency", requireAuth, requirePermission("currency:create"), createCurrency);   //26
router.get("/currency/:currencyId", requireAuth, requirePermission("currency:view"), viewCurrency);
router.put("/currency/:currencyId", requireAuth, requirePermission("currency:update"), updateCurrency);     //27
router.delete("/currency/:currencyId", requireAuth, requirePermission("currency:delete"), deleteCurrency);      //28

//TaxTypes Master
router.get("/tax-types", requireAuth, requirePermission("tax_types:view"), viewTaxTypesList);    //29    //User for TaxTypes list
router.post("/tax-types", requireAuth, requirePermission("tax_types:create"), createTaxTypes);   //30
router.get("/tax-types/:taxId", requireAuth, requirePermission("tax_types:view"), viewTaxTypes);
router.put("/tax-types/:taxId", requireAuth, requirePermission("tax_types:update"), updateTaxTypes);     //31
router.delete("/tax-types/:taxId", requireAuth, requirePermission("tax_types:delete"), deleteTaxTypes);      //32

//UOM Master
router.get("/units", requireAuth, requirePermission("units:view"), viewUnitsList);    //33    //User for Units list
router.post("/units", requireAuth, requirePermission("units:create"), createUnits);   //34
router.get("/units/:unitId", requireAuth, requirePermission("units:view"), viewUnits);
router.put("/units/:unitId", requireAuth, requirePermission("units:update"), updateUnits);     //35
router.delete("/units/:unitId", requireAuth, requirePermission("units:delete"), deleteUnits);      //36

//Financial Year Master
router.get("/financial-years", requireAuth, requirePermission("financial_year:view"), viewFinancialYearList);   //37
router.post("/financial-years", requireAuth, requirePermission("financial_year:create"), createFinancialYear);  //38
router.get("/financial-years/:financialYearId", requireAuth, requirePermission("financial_year:view"), viewFinancialYear);
router.put("/financial-years/:financialYearId", requireAuth, requirePermission("financial_year:update"), updateFinancialYear);  //39
router.delete("/financial-years/:financialYearId", requireAuth, requirePermission("financial_year:delete"), deleteFinancialYear);   //40

//Payment Terms Master
router.get("/payment-terms", requireAuth, requirePermission("payment_terms:view"), viewPaymentTermsList);   //41
router.post("/payment-terms", requireAuth, requirePermission("payment_terms:create"), createPaymentTerms);  //42
router.get("/payment-terms/:paymentTermId", requireAuth, requirePermission("payment_terms:view"), viewPaymentTerms);
router.put("/payment-terms/:paymentTermId", requireAuth, requirePermission("payment_terms:update"), updatePaymentTerms);  //43
router.delete("/payment-terms/:paymentTermId", requireAuth, requirePermission("payment_terms:delete"), deletePaymentTerms);   //44

//AUTO
//Bank Master
router.get("/bank", requireAuth, requirePermission("bank:view"), viewBankList);     //45
router.post("/bank", requireAuth, requirePermission("bank:create"), createBank);    //46
router.get("/bank/:bankId", requireAuth, requirePermission("bank:view"), viewBank);
router.put("/bank/:bankId", requireAuth, requirePermission("bank:update"), updateBank); //47
router.delete("/bank/:bankId", requireAuth, requirePermission("bank:delete"), deleteBank);  //48

//CR/DR Reason Master
router.get("/cr-dr-reason", requireAuth, requirePermission("cr_dr_reason:view"), viewCrDrReasonList);   //49
router.post("/cr-dr-reason", requireAuth, requirePermission("cr_dr_reason:create"), createCrDrReason);  //50
router.get("/cr-dr-reason/:reasonId", requireAuth, requirePermission("cr_dr_reason:view"), viewCrDrReason);
router.put("/cr-dr-reason/:reasonId", requireAuth, requirePermission("cr_dr_reason:update"), updateCrDrReason);     //51
router.delete("/cr-dr-reason/:reasonId", requireAuth, requirePermission("cr_dr_reason:delete"), deleteCrDrReason);  //52

//Chart Of Accounts
router.get("/chart-of-accounts", requireAuth, requirePermission("chart_of_accounts:view"), viewChartOfAccountsList);    //53
router.post("/chart-of-accounts", requireAuth, requirePermission("chart_of_accounts:create"), createChartOfAccounts);   //54
router.get("/chart-of-accounts/:accountId", requireAuth, requirePermission("chart_of_accounts:view"), viewChartOfAccounts);
router.put("/chart-of-accounts/:accountId", requireAuth, requirePermission("chart_of_accounts:update"), updateChartOfAccounts);     //55
router.delete("/chart-of-accounts/:accountId", requireAuth, requirePermission("chart_of_accounts:delete"), deleteChartOfAccounts);  //56

//Department Master
router.get("/departments", requireAuth, requirePermission("department:view"), viewDepartmentList);  //57
router.post("/departments", requireAuth, requirePermission("department:create"), createDepartment); //58
router.get("/departments/:departmentId", requireAuth, requirePermission("department:view"), viewDepartment);
router.put("/departments/:departmentId", requireAuth, requirePermission("department:update"), updateDepartment);    //59
router.delete("/departments/:departmentId", requireAuth, requirePermission("department:delete"), deleteDepartment); //60

//Branch Master
router.get("/branch", requireAuth, requirePermission("branch:view"), viewBranchList);   //61
router.post("/branch", requireAuth, requirePermission("branch:create"), createBranch);  //62
router.get("/branch/:branchId", requireAuth, requirePermission("branch:view"), viewBranch);
router.put("/branch/:branchId", requireAuth, requirePermission("branch:update"), updateBranch);     //63
router.delete("/branch/:branchId", requireAuth, requirePermission("branch:delete"), deleteBranch);  //64

//Designation Master
router.get("/designations", requireAuth, requirePermission("designation:view"), viewDesignationList);   //65
router.post("/designations", requireAuth, requirePermission("designation:create"), createDesignation);  //66
router.get("/designations/:designationId", requireAuth, requirePermission("designation:view"), viewDesignation);
router.put("/designations/:designationId", requireAuth, requirePermission("designation:update"), updateDesignation);    //67
router.delete("/designations/:designationId", requireAuth, requirePermission("designation:delete"), deleteDesignation); //68

//Shift Master
router.get("/shifts", requireAuth, requirePermission("shift:view"), viewShiftList);    //69
router.post("/shifts", requireAuth, requirePermission("shift:create"), createShift);    //70
router.get("/shifts/:shiftId", requireAuth, requirePermission("shift:view"), viewShift);
router.put("/shifts/:shiftId", requireAuth, requirePermission("shift:update"), updateShift);    //71
router.delete("/shifts/:shiftId", requireAuth, requirePermission("shift:delete"), deleteShift); //72

//Holiday Master
router.get("/holidays", requireAuth, requirePermission("holiday:view"), viewHolidayList);   //73
router.post("/holidays", requireAuth, requirePermission("holiday:create"), createHoliday);  //74
router.get("/holidays/:holidayId", requireAuth, requirePermission("holiday:view"), viewHoliday);
router.put("/holidays/:holidayId", requireAuth, requirePermission("holiday:update"), updateHoliday);    //75
router.delete("/holidays/:holidayId", requireAuth, requirePermission("holiday:delete"), deleteHoliday); //76

//Cost Center Master
router.get("/cost-centers", requireAuth, requirePermission("cost_center:view"), viewCostCenterList);    //77
router.post("/cost-centers", requireAuth, requirePermission("cost_center:create"), createCostCenter);   //78
router.get("/cost-centers/:costCenterId", requireAuth, requirePermission("cost_center:view"), viewCostCenter);
router.put("/cost-centers/:costCenterId", requireAuth, requirePermission("cost_center:update"), updateCostCenter);  //79
router.delete("/cost-centers/:costCenterId", requireAuth, requirePermission("cost_center:delete"), deleteCostCenter);   //80

//Document Type Master
router.get("/document-types", requireAuth, requirePermission("document_type:view"), viewDocumentTypeList);  //81
router.post("/document-types", requireAuth, requirePermission("document_type:create"), createDocumentType); //82
router.get("/document-types/:docTypeId", requireAuth, requirePermission("document_type:view"), viewDocumentType);
router.put("/document-types/:docTypeId", requireAuth, requirePermission("document_type:update"), updateDocumentType);   //83
router.delete("/document-types/:docTypeId", requireAuth, requirePermission("document_type:delete"), deleteDocumentType);    //84

//Document Series Master
router.get("/document-series", requireAuth, requirePermission("document_series:view"), viewDocumentSeriesList);     //85
router.post("/document-series", requireAuth, requirePermission("document_series:create"), createDocumentSeries);    //86
router.get("/document-series/:sequenceId", requireAuth, requirePermission("document_series:view"), viewDocumentSeries);
router.put("/document-series/:sequenceId", requireAuth, requirePermission("document_series:update"), updateDocumentSeries);     //87
router.delete("/document-series/:sequenceId", requireAuth, requirePermission("document_series:delete"), deleteDocumentSeries);  ///88




export default router;