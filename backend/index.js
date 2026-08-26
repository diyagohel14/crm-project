// index.js
import express from "express";
import session from "express-session";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import masterRoutes from "./routes/masterRoutes.js";
import partyRoutes from "./routes/partyRoutes.js";
import itemsRoutes from "./routes/itemsRoutes.js";
import quotationRoutes from "./routes/quotationRoutes.js";
import salesorderRoutes from "./routes/salesorderRoutes.js";
import purchaseorderRoutes from "./routes/purchaseorderRoutes.js";
import proformaRoutes from "./routes/proformaRoutes.js";
import deliverychallanRoutes from "./routes/deliverychallanRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import purchaseInvoiceRoutes from "./routes/purchaseInvoiceRoutes.js";
import { getAppConfig } from "./utils/env.js";

const config = getAppConfig();
const app = express();

app.use(express.json());

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/master", masterRoutes);
app.use("/api/party", partyRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/quotation", quotationRoutes);
app.use("/api/sales_order", salesorderRoutes);
app.use("/api/purchase_order", purchaseorderRoutes);
app.use("/api/proforma", proformaRoutes);
app.use("/api/delivery_challan", deliverychallanRoutes);
app.use("/api/invoice", invoiceRoutes);
app.use("/api/purchase_invoice", purchaseInvoiceRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = config.port;
app.listen(PORT, () => console.log(`CRM API listening on port ${PORT}`));
