import PDFDocument from "pdfkit";

export function buildPayslipPdf(payslip, company) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48 });
    const chunks = [];
    document.on("data", (chunk) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    document.fontSize(18).text(company.company_name, { align: "center" });
    document.moveDown(0.3);
    document.fontSize(15).text("Payslip", { align: "center" });
    document.moveDown();
    document.fontSize(10);
    document.text(`Payroll run: ${payslip.payroll_id}`);
    document.text(`Period: ${payslip.pay_period_start} to ${payslip.pay_period_end}`);
    document.text(`Employee: ${payslip.employee_code} - ${payslip.first_name} ${payslip.last_name || ""}`.trim());
    document.moveDown();

    const lines = [
      ["Basic salary", payslip.basic_salary],
      ["Allowances", payslip.allowance_amount],
      ["Overtime", payslip.overtime_amount],
      ["Bonus", payslip.bonus_amount],
      ["Other earnings", payslip.other_earnings],
      ["Gross salary", payslip.gross_salary],
    ];
    for (const [label, amount] of lines) {
      document.text(`${label}: ${Number(amount).toFixed(2)}`);
    }
    document.moveDown(0.5);
    document.fontSize(12).text("Deductions", { underline: true });
    document.fontSize(10);
    if (payslip.deductions.length) {
      for (const deduction of payslip.deductions) {
        document.text(`${deduction.rule_name}${deduction.is_statutory ? " (statutory)" : ""}: ${Number(deduction.amount).toFixed(2)}`);
      }
    } else {
      document.text("No configured deductions");
    }
    const configuredDeductions = payslip.deductions.reduce((total, deduction) => total + Number(deduction.amount), 0);
    const manualDeductions = Number(payslip.deduction_amount) - configuredDeductions;
    document.text(`Other deductions: ${manualDeductions.toFixed(2)}`);
    document.text(`Total deductions: ${Number(payslip.deduction_amount).toFixed(2)}`);
    document.moveDown();
    document.fontSize(13).text(`Net salary: ${Number(payslip.net_salary).toFixed(2)}`);
    document.fontSize(9).text(`Payroll status: ${payslip.payroll_status}`);
    document.end();
  });
}
