// constants/defaultPermissions.js

export const DEFAULT_PERMISSIONS = [
  { permissionName: "company:profile:update", moduleName: "Company" },  //1
  { permissionName: "users:view", moduleName: "Users" },  //2
  { permissionName: "users:create", moduleName: "Users" },  //3
  { permissionName: "users:update", moduleName: "Users" },    //4
  { permissionName: "users:delete", moduleName: "Users" },  //5
  { permissionName: "users:password:update", moduleName: "Users" },   //6
  { permissionName: "roles:view", moduleName: "Roles" },  //7
  { permissionName: "roles:create", moduleName: "Roles" },   //8
  { permissionName: "roles:update", moduleName: "Roles" },  //9
  { permissionName: "roles:delete", moduleName: "Roles" },  //10
  { permissionName: "permissions:view", moduleName: "Permissions" },  //11
  { permissionName: "permissions:manage", moduleName: "Permissions" },  //12
  { permissionName: "country:view", moduleName: "Country Master" },   //13
  { permissionName: "country:create", moduleName: "Country Master" },   //14
  { permissionName: "country:update", moduleName: "Country Master" },   //15
  { permissionName: "country:delete", moduleName: "Country Master" },   //16
  { permissionName: "state:view", moduleName: "State Master" },   //17
  { permissionName: "state:create", moduleName: "State Master" },   //18
  { permissionName: "state:update", moduleName: "State Master" },   //19
  { permissionName: "state:delete", moduleName: "State Master" },   //20
  { permissionName: "city:view", moduleName: "City Master" },   //21
  { permissionName: "city:create", moduleName: "City Master" },   //22
  { permissionName: "city:update", moduleName: "City Master" },   //23
  { permissionName: "city:delete", moduleName: "City Master" },   //24
  { permissionName: "currency:view", moduleName: "Currency Master" },   //25
  { permissionName: "currency:create", moduleName: "Currency Master" },   //26
  { permissionName: "currency:update", moduleName: "Currency Master" },   //27
  { permissionName: "currency:delete", moduleName: "Currency Master" },   //28
  { permissionName: "tax_types:view", moduleName: "TaxTypes Master" },   //29
  { permissionName: "tax_types:create", moduleName: "TaxTypes Master" },   //30
  { permissionName: "tax_types:update", moduleName: "TaxTypes Master" },   //31
  { permissionName: "tax_types:delete", moduleName: "TaxTypes Master" },   //32
  { permissionName: "units:view", moduleName: "Units Master" },   //33
  { permissionName: "units:create", moduleName: "Units Master" },   //34
  { permissionName: "units:update", moduleName: "Units Master" },   //35
  { permissionName: "units:delete", moduleName: "Units Master" },   //36 
  { permissionName: "financial_year:view", moduleName: "Financial Year Master" },   //37
  { permissionName: "financial_year:create", moduleName: "Financial Year Master" },   //38
  { permissionName: "financial_year:update", moduleName: "Financial Year Master" },   //39
  { permissionName: "financial_year:delete", moduleName: "Financial Year Master" },   //40
  { permissionName: "payment_terms:view", moduleName: "Payment Terms Master" },  //41
  { permissionName: "payment_terms:create", moduleName: "Payment Terms Master" },   //42
  { permissionName: "payment_terms:update", moduleName: "Payment Terms Master" },  //43
  { permissionName: "payment_terms:delete", moduleName: "Payment Terms Master" },  //44
  { permissionName: "bank:view", moduleName: "Bank Master" },  //45
  { permissionName: "bank:create", moduleName: "Bank Master" },   //46
  { permissionName: "bank:update", moduleName: "Bank Master" },  //47
  { permissionName: "bank:delete", moduleName: "Bank Master" },  //48
  { permissionName: "cr_dr_reason:view", moduleName: "Cr-Dr Reason Master" },  //49
  { permissionName: "cr_dr_reason:create", moduleName: "Cr-Dr Reason Master" },   //50
  { permissionName: "cr_dr_reason:update", moduleName: "Cr-Dr Reason Master" },  //51
  { permissionName: "cr_dr_reason:delete", moduleName: "Cr-Dr Reason Master" },  //52
  { permissionName: "chart_of_accounts:view", moduleName: "Chart of Account Master" },  //53
  { permissionName: "chart_of_accounts:create", moduleName: "Chart of Account Master" },   //54
  { permissionName: "chart_of_accounts:update", moduleName: "Chart of Account Master" },  //55
  { permissionName: "chart_of_accounts:delete", moduleName: "Chart of Account Master" },  //56
  { permissionName: "department:view", moduleName: "Department Master" },  //57
  { permissionName: "department:create", moduleName: "Department Master" },   //58
  { permissionName: "department:update", moduleName: "Department Master" },  //59
  { permissionName: "department:delete", moduleName: "Department Master" },  //60
  { permissionName: "branch:view", moduleName: "Branch Master" },  //61
  { permissionName: "branch:create", moduleName: "Branch Master" },   //62
  { permissionName: "branch:update", moduleName: "Branch Master" },  //63
  { permissionName: "branch:delete", moduleName: "Branch Master" },  //64
  { permissionName: "designation:view", moduleName: "Designation Master" },  //65
  { permissionName: "designation:create", moduleName: "Designation Master" },   //66
  { permissionName: "designation:update", moduleName: "Designation Master" },  //67
  { permissionName: "designation:delete", moduleName: "Designation Master" },  //68
  { permissionName: "shift:view", moduleName: "Shift Master" },  //69
  { permissionName: "shift:create", moduleName: "Shift Master" },   //70
  { permissionName: "shift:update", moduleName: "Shift Master" },  //71
  { permissionName: "shift:delete", moduleName: "Shift Master" },  //72
  { permissionName: "holiday:view", moduleName: "Holiday Master" },  //73
  { permissionName: "holiday:create", moduleName: "Holiday Master" },   //74
  { permissionName: "holiday:update", moduleName: "Holiday Master" },  //75
  { permissionName: "holiday:delete", moduleName: "Holiday Master" },  //76
  { permissionName: "cost_center:view", moduleName: "Cost Center Master" },  //77
  { permissionName: "cost_center:create", moduleName: "Cost Center Master" },   //78
  { permissionName: "cost_center:update", moduleName: "Cost Center Master" },  //79
  { permissionName: "cost_center:delete", moduleName: "Cost Center Master" },  //80
  { permissionName: "document_type:view", moduleName: "Document Type Master" },  //81
  { permissionName: "document_type:create", moduleName: "Document Type Master" },   //82
  { permissionName: "document_type:update", moduleName: "Document Type Master" },  //83
  { permissionName: "document_type:delete", moduleName: "Document Type Master" },  //84
  { permissionName: "document_series:view", moduleName: "Document Series Master" },  //85
  { permissionName: "document_series:create", moduleName: "Document Series Master" },   //86
  { permissionName: "document_series:update", moduleName: "Document Series Master" },  //87
  { permissionName: "document_series:delete", moduleName: "Document Series Master" },  //88

  { permissionName: "customer:view", moduleName: "Customer" },  //89
  { permissionName: "customer:create", moduleName: "Customer" },  //90
  { permissionName: "customer:update", moduleName: "Customer" },  //91
  { permissionName: "customer:delete", moduleName: "Customer" },  //92
  { permissionName: "vendor:view", moduleName: "Vendor" },  //93
  { permissionName: "vendor:create", moduleName: "Vendor" },  //94
  { permissionName: "vendor:update", moduleName: "Vendor" },  //95
  { permissionName: "vendor:delete", moduleName: "Vendor" },  //96

  { permissionName: "item_types:view", moduleName: "Items Types Master" },  //97
  { permissionName: "item_types:create", moduleName: "Items Types Master" },  //98
  { permissionName: "item_types:update", moduleName: "Items Types Master" },  //99
  { permissionName: "item_types:delete", moduleName: "Items Types Master" },  //100
  { permissionName: "item_category:view", moduleName: "Items Category Master" },  //101
  { permissionName: "item_category:create", moduleName: "Items Category Master" },  //102
  { permissionName: "item_category:update", moduleName: "Items Category Master" },  //103
  { permissionName: "item_category:delete", moduleName: "Items Category Master" },  //104
  { permissionName: "items:view", moduleName: "Items" },  //105
  { permissionName: "items:create", moduleName: "Items" },  //106
  { permissionName: "items:update", moduleName: "Items" },  //107
  { permissionName: "items:delete", moduleName: "Items" },  //108

  { permissionName: "invoice:view", moduleName: "Invoice" },  //109
  { permissionName: "invoice:create", moduleName: "Invoice" },  //110
  { permissionName: "invoice:update", moduleName: "Invoice" },  //111
  { permissionName: "invoice:delete", moduleName: "Invoice" },  //112
  { permissionName: "invoice:approve", moduleName: "Invoice" },  //113
  { permissionName: "invoice:print", moduleName: "Invoice" },  //114

  { permissionName: "purchase_invoice:view", moduleName: "Purchase Invoice" },  //115
  { permissionName: "purchase_invoice:create", moduleName: "Purchase Invoice" },  //116
  { permissionName: "purchase_invoice:update", moduleName: "Purchase Invoice" },  //117
  { permissionName: "purchase_invoice:delete", moduleName: "Purchase Invoice" },  //118
  { permissionName: "purchase_invoice:approve", moduleName: "Purchase Invoice" },  //119
  { permissionName: "purchase_invoice:print", moduleName: "Purchase Invoice" },  //120

  { permissionName: "quotation:view", moduleName: "Quotation" },  //121
  { permissionName: "quotation:create", moduleName: "Quotation" },  //122
  { permissionName: "quotation:update", moduleName: "Quotation" },  //123
  { permissionName: "quotation:delete", moduleName: "Quotation" },  //124
  { permissionName: "quotation:approve", moduleName: "Quotation" },  //125
  { permissionName: "quotation:print", moduleName: "Quotation" },  //126

  { permissionName: "sales_order:view", moduleName: "Sales Order" },  //127
  { permissionName: "sales_order:create", moduleName: "Sales Order" },  //128
  { permissionName: "sales_order:update", moduleName: "Sales Order" },  //129
  { permissionName: "sales_order:delete", moduleName: "Sales Order" },  //130
  { permissionName: "sales_order:approve", moduleName: "Sales Order" },  //131
  { permissionName: "sales_order:print", moduleName: "Sales Order" },  //132

  { permissionName: "purchase_order:view", moduleName: "Purchase Order" },  //133
  { permissionName: "purchase_order:create", moduleName: "Purchase Order" },  //134
  { permissionName: "purchase_order:update", moduleName: "Purchase Order" },  //135
  { permissionName: "purchase_order:delete", moduleName: "Purchase Order" },  //136
  { permissionName: "purchase_order:approve", moduleName: "Purchase Order" },  //137
  { permissionName: "purchase_order:print", moduleName: "Purchase Order" },  //138

  { permissionName: "proforma:view", moduleName: "Proforma" },  //139
  { permissionName: "proforma:create", moduleName: "Proforma" },  //140
  { permissionName: "proforma:update", moduleName: "Proforma" },  //141
  { permissionName: "proforma:delete", moduleName: "Proforma" },  //142
  { permissionName: "proforma:approve", moduleName: "Proforma" },  //143
  { permissionName: "proforma:print", moduleName: "Proforma" },  //144

  { permissionName: "delivery_challan:view", moduleName: "Delivery Challan" },  //145
  { permissionName: "delivery_challan:create", moduleName: "Delivery Challan" },  //146
  { permissionName: "delivery_challan:update", moduleName: "Delivery Challan" },  //147
  { permissionName: "delivery_challan:delete", moduleName: "Delivery Challan" },  //148
  { permissionName: "delivery_challan:approve", moduleName: "Delivery Challan" },  //149
  { permissionName: "delivery_challan:print", moduleName: "Delivery Challan" },  //150

  { permissionName: "credit_notes:view", moduleName: "Credit Notes" },  //151
  { permissionName: "credit_notes:create", moduleName: "Credit Notes" },  //152
  { permissionName: "credit_notes:update", moduleName: "Credit Notes" },  //153
  { permissionName: "credit_notes:delete", moduleName: "Credit Notes" },  //154
  { permissionName: "credit_notes:approve", moduleName: "Credit Notes" },  //155
  { permissionName: "credit_notes:print", moduleName: "Credit Notes" },  //156

  { permissionName: "debit_notes:view", moduleName: "Debit Notes" },  //157
  { permissionName: "debit_notes:create", moduleName: "Debit Notes" },  //158
  { permissionName: "debit_notes:update", moduleName: "Debit Notes" },  //159
  { permissionName: "debit_notes:delete", moduleName: "Debit Notes" },  //160
  { permissionName: "debit_notes:approve", moduleName: "Debit Notes" },  //161
  { permissionName: "debit_notes:print", moduleName: "Debit Notes" },  //162

  
  { permissionName: "warehouse:view", moduleName: "Inventory" },  //163
  { permissionName: "warehouse:create", moduleName: "Inventory" },  //164
  { permissionName: "warehouse:update", moduleName: "Inventory" },  //165
  { permissionName: "warehouse:delete", moduleName: "Inventory" },  //166

  { permissionName: "item_batches:view", moduleName: "Inventory" },  //167
  { permissionName: "item_batches:create", moduleName: "Inventory" },  //168
  { permissionName: "item_batches:update", moduleName: "Inventory" },  //169
  { permissionName: "item_batches:delete", moduleName: "Inventory" },  //170

  { permissionName: "stock:view", moduleName: "Inventory" },  //171

  { permissionName: "stock_transfer:view", moduleName: "Inventory" },  //172
  { permissionName: "stock_transfer:create", moduleName: "Inventory" },  //173
  { permissionName: "stock_transfer:update", moduleName: "Inventory" },  //174
  { permissionName: "stock_transfer:delete", moduleName: "Inventory" },  //175
  { permissionName: "stock_transfer:approve", moduleName: "Inventory" },  //176

  { permissionName: "stock_adjustment:view", moduleName: "Inventory" },  //177
  { permissionName: "stock_adjustment:create", moduleName: "Inventory" },  //178
  { permissionName: "stock_adjustment:update", moduleName: "Inventory" },  //179
  { permissionName: "stock_adjustment:delete", moduleName: "Inventory" },  //180
  { permissionName: "stock_adjustment:approve", moduleName: "Inventory" },  //181

  { permissionName: "project:view", moduleName: "Project" },  //182
  { permissionName: "project:create", moduleName: "Project" },  //183
  { permissionName: "project:update", moduleName: "Project" },  //184
  { permissionName: "project:delete", moduleName: "Project" },  //185
  { permissionName: "project:approve", moduleName: "Project" },  //186

  { permissionName: "project_site:view", moduleName: "Project" },  //187
  { permissionName: "project_site:create", moduleName: "Project" },  //188
  { permissionName: "project_site:update", moduleName: "Project" },  //189
  { permissionName: "project_site:delete", moduleName: "Project" },  //190

  { permissionName: "project_boq:view", moduleName: "Project" },  //191
  { permissionName: "project_boq:create", moduleName: "Project" },  //192
  { permissionName: "project_boq:update", moduleName: "Project" },  //193
  { permissionName: "project_boq:delete", moduleName: "Project" },  //194

  { permissionName: "project_milestone:view", moduleName: "Project" },  //195
  { permissionName: "project_milestone:create", moduleName: "Project" },  //196
  { permissionName: "project_milestone:update", moduleName: "Project" },  //197
  { permissionName: "project_milestone:delete", moduleName: "Project" },  //198

  { permissionName: "project_task:view", moduleName: "Project" },  //199
  { permissionName: "project_task:create", moduleName: "Project" },  //200
  { permissionName: "project_task:update", moduleName: "Project" },  //201
  { permissionName: "project_task:delete", moduleName: "Project" },  //202

  { permissionName: "project_dpr:view", moduleName: "Project" },  //203
  { permissionName: "project_dpr:create", moduleName: "Project" },  //204
  { permissionName: "project_dpr:update", moduleName: "Project" },  //205
  { permissionName: "project_dpr:delete", moduleName: "Project" },  //206

  { permissionName: "project_document:view", moduleName: "Project" },  //207
  { permissionName: "project_document:create", moduleName: "Project" },  //208
  { permissionName: "project_document:delete", moduleName: "Project" },  //209

  { permissionName: "requisition:view", moduleName: "Procurement Requisition" },  //210
  { permissionName: "requisition:create", moduleName: "Procurement Requisition" },  //211
  { permissionName: "requisition:update", moduleName: "Procurement Requisition" },  //212
  { permissionName: "requisition:delete", moduleName: "Procurement Requisition" },  //213
  { permissionName: "requisition:approve", moduleName: "Procurement Requisition" },  //214

  { permissionName: "grn:view", moduleName: "GRN" },  //215
  { permissionName: "grn:create", moduleName: "GRN" },  //216
  { permissionName: "grn:update", moduleName: "GRN" },  //217
  { permissionName: "grn:delete", moduleName: "GRN" },  //218
  { permissionName: "grn:approve", moduleName: "GRN" },  //219
 
  { permissionName: "site_issue:view", moduleName: "Site Issues" },  //220
  { permissionName: "site_issue:create", moduleName: "Site Issues" },  //221
  { permissionName: "site_issue:update", moduleName: "Site Issues" },  //222
  { permissionName: "site_issue:delete", moduleName: "Site Issues" },  //223
  { permissionName: "site_issue:approve", moduleName: "Site Issues" },  //224

  { permissionName: "lead:view", moduleName: "Lead" },  //225
  { permissionName: "lead:create", moduleName: "Lead" },  //226
  { permissionName: "lead:update", moduleName: "Lead" },  //227
  { permissionName: "lead:delete", moduleName: "Lead" },  //228
  { permissionName: "lead:convert", moduleName: "Lead" },  //229

  { permissionName: "enquiry:view", moduleName: "Enquiry" },  //230
  { permissionName: "enquiry:create", moduleName: "Enquiry" },  //231
  { permissionName: "enquiry:update", moduleName: "Enquiry" },  //232
  { permissionName: "enquiry:delete", moduleName: "Enquiry" },  //233

  { permissionName: "enquiry_document:view", moduleName: "Enquiry" },  //234
  { permissionName: "enquiry_document:create", moduleName: "Enquiry" },  //235
  { permissionName: "enquiry_document:delete", moduleName: "Enquiry" },  //236

  { permissionName: "lead_source:view", moduleName: "CRM Master" },  //237
  { permissionName: "lead_source:create", moduleName: "CRM Master" },  //238

  { permissionName: "industry:view", moduleName: "CRM Master" },  //239
  { permissionName: "industry:create", moduleName: "CRM Master" },  //240

  { permissionName: "equipment:view", moduleName: "Equipment" },  //241
  { permissionName: "equipment:create", moduleName: "Equipment" },  //242
  { permissionName: "equipment:update", moduleName: "Equipment" },  //243
  { permissionName: "equipment:delete", moduleName: "Equipment" },  //244

  { permissionName: "labour_trade:view", moduleName: "Manpower" },  //245
  { permissionName: "labour_trade:create", moduleName: "Manpower" },  //246

  { permissionName: "manpower_log:view", moduleName: "Manpower" },  //247
  { permissionName: "manpower_log:create", moduleName: "Manpower" },  //248
  { permissionName: "manpower_log:update", moduleName: "Manpower" },  //249
  { permissionName: "manpower_log:delete", moduleName: "Manpower" },  //250

  { permissionName: "equipment_log:view", moduleName: "Equipment" },  //251
  { permissionName: "equipment_log:create", moduleName: "Equipment" },  //252
  { permissionName: "equipment_log:update", moduleName: "Equipment" },  //253
  { permissionName: "equipment_log:delete", moduleName: "Equipment" },  //254
  
  { permissionName: "hrms_employee:view", moduleName: "HRMS" },
  { permissionName: "hrms_employee:create", moduleName: "HRMS" },
  { permissionName: "hrms_employee:update", moduleName: "HRMS" },
  { permissionName: "hrms_employee:delete", moduleName: "HRMS" },

  { permissionName: "hrms_attendance:view", moduleName: "HRMS" },
  { permissionName: "hrms_attendance:create", moduleName: "HRMS" },

  { permissionName: "hrms_leave:view", moduleName: "HRMS" },
  { permissionName: "hrms_leave:create", moduleName: "HRMS" },
  { permissionName: "hrms_leave:update", moduleName: "HRMS" },

  { permissionName: "hrms_payroll:view", moduleName: "HRMS" },
  { permissionName: "hrms_payroll:create", moduleName: "HRMS" },
  { permissionName: "hrms_payroll:update", moduleName: "HRMS" },
  { permissionName: "hrms_payroll:approve", moduleName: "HRMS" },
  { permissionName: "hrms_roster:view", moduleName: "HRMS" },
  { permissionName: "hrms_roster:create", moduleName: "HRMS" },
  { permissionName: "hrms_overtime:view", moduleName: "HRMS" },
  { permissionName: "hrms_overtime:create", moduleName: "HRMS" },
  { permissionName: "hrms_overtime:approve", moduleName: "HRMS" },
  { permissionName: "hrms_leave_balance:view", moduleName: "HRMS" },
  { permissionName: "hrms_leave_balance:update", moduleName: "HRMS" },
  { permissionName: "hrms_document:view", moduleName: "HRMS" },
  { permissionName: "hrms_document:create", moduleName: "HRMS" },
  { permissionName: "hrms_document:delete", moduleName: "HRMS" },
  { permissionName: "hrms_onboarding:view", moduleName: "HRMS" },
  { permissionName: "hrms_onboarding:create", moduleName: "HRMS" },
  { permissionName: "hrms_onboarding:update", moduleName: "HRMS" },
  { permissionName: "hrms_analytics:view", moduleName: "HRMS" },


];