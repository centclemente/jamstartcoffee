import { useEffect, useState } from "react";
import {
  BarChart3,
  Calendar,
  ClipboardList,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  LineChart,
  Package,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import api from "../api/axios";

const reports = [
  {
    key: "sales_trend",
    title: "Report",
    icon: LineChart,
    accent: "bg-emerald-100 text-emerald-800",
  },
];
const peso = (value) =>
  `PHP ${Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
const num = (value) => Number(value || 0).toLocaleString("en-PH", { maximumFractionDigits: 0 });
const rangeBounds = (fromDate, toDate) => {
  const bounds = {};
  const getBoundary = (value, endOfMonth = false) => {
    if (!value || value === "all") return null;
    if (/^\d{4}$/.test(value)) {
      return endOfMonth
        ? new Date(Date.UTC(Number(value) + 1, 0, 0, 23, 59, 59, 999)).toISOString()
        : new Date(Date.UTC(Number(value), 0, 1)).toISOString();
    }
    const [year, month] = value.split("-").map(Number);
    return endOfMonth
      ? new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString()
      : new Date(Date.UTC(year, month - 1, 1)).toISOString();
  };
  const startDate = getBoundary(fromDate);
  const endDate = getBoundary(toDate, true);
  if (startDate) bounds.startDate = startDate;
  if (endDate) bounds.endDate = endDate;
  return bounds;
};
const csvValue = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const formatCompactNumber = (value) =>
  new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(
    Number(value || 0),
  );

const reportYears = Array.from(
  { length: new Date().getFullYear() - 2019 },
  (_, index) => new Date().getFullYear() - index,
);
const reportMonths = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(2024, index, 1)),
}));

function ReportPeriodPicker({ value, onChange }) {
  // Custom report period control.
  const selectedYear = /^\d{4}/.test(value) ? Number(value.slice(0, 4)) : new Date().getFullYear();
  const selectedMonth = /^\d{4}-\d{2}$/.test(value) ? value.slice(5) : "";
  const label =
    value === "all"
      ? "All time"
      : /^\d{4}$/.test(value)
        ? value
        : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
            new Date(`${value}-01T00:00:00`),
          );

  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-emerald-900/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-emerald-950 shadow-sm shadow-emerald-950/5">
        <Calendar className="h-4 w-4 shrink-0 text-emerald-900/45" />
        <span>{label}</span>
      </summary>
      <div className="absolute left-0 z-30 mt-2 w-[19rem] rounded-2xl border border-emerald-900/10 bg-white p-3 shadow-xl shadow-emerald-950/15">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={`mb-3 w-full rounded-xl px-3 py-2 text-left text-sm ${value === "all" ? "bg-emerald-700 font-semibold text-white" : "text-emerald-950 hover:bg-emerald-50"}`}
        >
          All time
        </button>
        <div className="mb-2 flex items-center justify-between text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-emerald-900/50">
          <span>Year</span>
          <span>{selectedYear}</span>
        </div>
        <div className="grid max-h-28 grid-cols-4 gap-1.5 overflow-y-auto">
          {reportYears.map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => onChange(String(year))}
              className={`rounded-lg px-2 py-1.5 text-xs ${selectedYear === year && /^\d{4}$/.test(value) ? "bg-emerald-700 font-semibold text-white" : "text-emerald-950 hover:bg-emerald-50"}`}
            >
              {year}
            </button>
          ))}
        </div>
        <div className="mb-2 mt-4 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-emerald-900/50">
          Month
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {reportMonths.map((monthOption) => {
            const optionValue = `${selectedYear}-${monthOption.value}`;
            return (
              <button
                key={optionValue}
                type="button"
                onClick={() => onChange(optionValue)}
                className={`rounded-lg px-2 py-1.5 text-xs ${selectedMonth === monthOption.value ? "bg-lime-100 font-semibold text-emerald-950" : "text-emerald-950 hover:bg-emerald-50"}`}
              >
                {monthOption.label}
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}

function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function downloadExcel(columns, rows, filename) {
  const html = `<table><thead><tr>${columns.map((column) => `<th>${column.header}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${row[column.key] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  downloadFile(
    `<html><meta charset="utf-8"><body>${html}</body></html>`,
    filename,
    "application/vnd.ms-excel",
  );
}

function insightFor(report) {
  const rows = report.rows || [];
  if (!rows.length) return "No observations were returned for this selection.";
  if (report.reportType === "forecasting") {
    const first = Number(rows[0].predictedValue || 0);
    const last = Number(rows.at(-1).predictedValue || 0);
    const change = first ? ((last - first) / first) * 100 : 0;
    return `Using the latest six months as its basis, the model projects ${change >= 0 ? "growth" : "a decline"} of ${Math.abs(change).toFixed(1)}% across the forecast horizon, ending at ${num(last)} projected units.`;
  }
  const first = Number(rows[0].totalSales || 0);
  const last = Number(rows.at(-1).totalSales || 0);
  const change = first ? ((last - first) / first) * 100 : 0;
  const peak = rows.reduce(
    (best, row) => (Number(row.totalSales) > Number(best.totalSales) ? row : best),
    rows[0],
  );
  const low = rows.reduce(
    (best, row) => (Number(row.totalSales) < Number(best.totalSales) ? row : best),
    rows[0],
  );
  return `Sales ${change >= 0 ? "grew" : "declined"} ${Math.abs(change).toFixed(1)}% from the first to the last selected month. Sales peaked in ${peak.month} at ${peso(peak.totalSales)} and were lowest in ${low.month} at ${peso(low.totalSales)}.`;
}

function drawChart(pdf, rows, key, x, y, width, height, color, label) {
  if (!rows.length) return;
  const values = rows.map((row) => Number(row[key] || 0));
  const max = Math.max(...values, 1);
  const step = rows.length > 1 ? width / (rows.length - 1) : 0;
  pdf.setDrawColor(210, 226, 216);
  pdf.line(x, y + height, x + width, y + height);
  pdf.line(x, y, x, y + height);
  pdf.setDrawColor(...color);
  pdf.setLineWidth(0.7);
  values.forEach((value, index) => {
    const pointX = x + index * step;
    const pointY = y + height - (value / max) * height;
    if (index) {
      const previousY = y + height - (values[index - 1] / max) * height;
      pdf.line(x + (index - 1) * step, previousY, pointX, pointY);
    }
    pdf.setFillColor(...color);
    pdf.circle(pointX, pointY, 1, "F");
    if (index === 0 || index === values.length - 1) {
      const pointLabel =
        rows[index].month || rows[index].item || rows[index].name || String(index + 1);
      pdf.setFontSize(6.5);
      pdf.setTextColor(80, 105, 92);
      pdf.text(String(pointLabel), pointX, y + height + 5, { align: index ? "right" : "left" });
    }
  });
  pdf.setFontSize(7);
  pdf.setTextColor(...color);
  pdf.text(label, x, y - 3);
}

const formatPercent = (value) => {
  if (value === null || value === undefined || value === "" || value === "N/A") return "â€”";
  const numericValue = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(numericValue) ? `${numericValue.toFixed(1)}%` : "â€”";
};

function makeTemplatePdf(report, subtitle) {
  const pdf = new jsPDF({ unit: "mm" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const contentWidth = width - margin * 2;
  const rows = report.rows || [];
  const forecastRows =
    report.forecastRows || rows.filter((row) => row.predictedValue !== undefined);
  const itemRows = report.itemRows || [];
  const categoryRows = report.categoryRows || [];
  const colors = {
    forest: [6, 78, 59],
    ink: [20, 55, 42],
    muted: [88, 116, 103],
    pale: [235, 247, 239],
    line: [211, 226, 217],
    lime: [101, 131, 35],
    white: [255, 255, 255],
  };
  let y = 0;

  const header = () => {
    pdf.setFillColor(...colors.forest);
    pdf.rect(0, 0, width, 25, "F");
    pdf.setTextColor(...colors.white);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text("Jamstart Coffee", margin, 10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.text("SALES & DEMAND ANALYTICS REPORT", margin, 17);
    pdf.text(subtitle, width - margin, 13, { align: "right" });
  };
  const page = () => {
    if (y > height - 28) {
      pdf.addPage();
      header();
      y = 34;
    }
  };
  const title = (value, size = 14) => {
    page();
    pdf.setTextColor(...colors.forest);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(size);
    pdf.text(value, margin, y);
    y += size * 0.65 + 4;
  };
  const subTitle = (value) => {
    page();
    pdf.setTextColor(...colors.muted);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(value, margin, y);
    y += 6;
  };
  const text = (value, size = 8.5, color = colors.ink) => {
    pdf.setTextColor(...color);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(value), contentWidth);
    page();
    pdf.text(lines, margin, y);
    y += lines.length * 4.2 + 4;
  };
  const insight = (value) => {
    const lines = pdf.splitTextToSize(value, contentWidth - 10);
    page();
    const boxHeight = Math.max(20, lines.length * 4.1 + 11);
    pdf.setFillColor(...colors.pale);
    pdf.roundedRect(margin, y, contentWidth, boxHeight, 2.5, 2.5, "F");
    pdf.setTextColor(...colors.forest);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text("INSIGHT", margin + 4, y + 6);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...colors.ink);
    pdf.setFontSize(8.2);
    pdf.text(lines, margin + 4, y + 12);
    y += boxHeight + 7;
  };
  const table = (columns, values, rowHeight = 7) => {
    const widths = columns.map((column) => column.width || 1);
    const total = widths.reduce((sum, value) => sum + value, 0);
    const scaled = widths.map((value) => (contentWidth * value) / total);
    const lines = values.map((row) =>
      columns.map((column, index) =>
        pdf.splitTextToSize(String(row[column.key] ?? "-"), scaled[index] - 4),
      ),
    );
    const drawRow = (cells, headerRow, rowIndex) => {
      let x = margin;
      columns.forEach((column, index) => {
        const cellLines = headerRow ? [column.header] : cells[index];
        const h = headerRow ? rowHeight : Math.max(rowHeight, cellLines.length * 3.2 + 3.5);
        pdf.setFillColor(
          ...(headerRow ? colors.pale : rowIndex % 2 ? [248, 252, 249] : colors.white),
        );
        pdf.setDrawColor(...colors.line);
        pdf.rect(x, y, scaled[index], h, "FD");
        pdf.setTextColor(...(headerRow ? colors.forest : colors.ink));
        pdf.setFont("helvetica", headerRow ? "bold" : "normal");
        pdf.setFontSize(headerRow ? 7 : 6.8);
        pdf.text(cellLines, x + 2, y + (headerRow ? 4.5 : 4));
        x += scaled[index];
      });
      y += headerRow
        ? rowHeight
        : Math.max(
            rowHeight,
            cells.reduce((max, cell) => Math.max(max, cell.length), 1) * 3.2 + 3.5,
          );
    };
    const drawHeader = () => {
      if (y + rowHeight > height - 20) {
        pdf.addPage();
        header();
        y = 34;
      }
      drawRow([], true, 0);
    };
    page();
    drawHeader();
    lines.forEach((row, index) => {
      const rowHeightForData = Math.max(
        rowHeight,
        row.reduce((max, cell) => Math.max(max, cell.length), 1) * 3.2 + 3.5,
      );
      if (y + rowHeightForData > height - 20) {
        pdf.addPage();
        header();
        y = 34;
        drawHeader();
      }
      drawRow(row, false, index);
    });
    y += 6;
  };
  const figure = (caption, chartRows, key, color = colors.forest, secondKey) => {
    page();
    pdf.setTextColor(...colors.ink);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text(caption, margin, y);
    y += 6;
    drawChart(
      pdf,
      chartRows,
      key,
      margin + 4,
      y + 3,
      contentWidth - 8,
      35,
      color,
      key === "predictedValue" ? "Forecast" : key === "unitsValue" ? "Units sold" : "Sales",
    );
    if (secondKey)
      drawChart(
        pdf,
        chartRows,
        secondKey,
        margin + 4,
        y + 48,
        contentWidth - 8,
        30,
        colors.lime,
        "Units sold",
      );
    y += secondKey ? 86 : 52;
  };
  const formatItem = (row) => ({
    item: row.item_name || row.item || row.name,
    category: row.category,
    units: num(row.items_sold || row.units_sold),
    unitsValue: Number(row.items_sold || row.units_sold || 0),
    sales: peso(row.totalSales || row.sales),
  });
  const topItems = [...itemRows]
    .sort((a, b) => Number(b.items_sold || 0) - Number(a.items_sold || 0))
    .slice(0, 5)
    .map(formatItem);
  const leastItems = [...itemRows]
    .sort((a, b) => Number(a.items_sold || 0) - Number(b.items_sold || 0))
    .slice(0, 5)
    .map(formatItem);
  const itemBySales = [...itemRows].sort(
    (a, b) => Number(b.totalSales || 0) - Number(a.totalSales || 0),
  );
  const categoryBySales = [...categoryRows].sort(
    (a, b) => Number(b.totalSales || 0) - Number(a.totalSales || 0),
  );
  const itemByUnits = [...itemRows].sort(
    (a, b) => Number(b.items_sold || 0) - Number(a.items_sold || 0),
  );
  const categoryByUnits = [...categoryRows].sort(
    (a, b) => Number(b.items_sold || 0) - Number(a.items_sold || 0),
  );
  const itemInsight =
    itemBySales[0] && itemByUnits[0]
      ? `${itemBySales[0].item_name || itemBySales[0].item} leads sales at ${peso(itemBySales[0].totalSales)} while ${itemByUnits[0].item_name || itemByUnits[0].item} leads volume at ${num(itemByUnits[0].items_sold)} units.`
      : insightFor(report);
  const contributionSection = (sectionTitle, contribution, metric, aiInsight) => {
    if (!contribution?.length) return;
    const months = contribution.map((entry) => entry.month);
    const categories = [...new Set(contribution.flatMap((entry) => (entry.categories || []).map((item) => item.category)))];
    title(sectionTitle);
    text("Estimated from each category's average share across the last six actual months; this is not a separate category forecast.", 8.2);
    table(
      [{ header: "Category", key: "category", width: 1.4 }, ...months.map((month) => ({ header: month, key: month, width: 1 }))],
      categories.map((category) => ({
        category,
        ...Object.fromEntries(months.map((month) => {
          const item = (contribution.find((entry) => entry.month === month)?.categories || []).find((entry) => entry.category === category);
          return [month, item ? `${metric === "revenue" ? peso(item.amount) : num(item.amount)} (${item.percentage.toFixed(1)}%)` : "—"];
        })),
      })),
    );
    if (aiInsight) insight(aiInsight);
  };

  header();
  y = 38;
  pdf.setTextColor(...colors.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(19);
  pdf.text("Jamstart Coffee â€” Sales & Demand Analytics", margin, y);
  y += 8;
  pdf.setFontSize(14);
  pdf.text("Report", margin, y);
  y += 8;
  text(
    `Report Period: ${subtitle}    Report Generated: ${new Date().toLocaleDateString("en-PH")}\nPrepared from: Web-based Sales Trend Analysis and Forecasting Dashboard`,
    8.5,
  );
  pdf.setDrawColor(...colors.line);
  pdf.line(margin, y, width - margin, y);
  y += 10;
  title("Part 1: Summary Overview");
  subTitle("1.1 Overall Totals & Top/Bottom Performers (Item Level)");
  const totalSales = rows.reduce((sum, row) => sum + Number(row.totalSales || 0), 0);
  const totalUnits = rows.reduce((sum, row) => sum + Number(row.items_sold || 0), 0);
  table(
    [
      { header: "Metric", key: "metric", width: 1 },
      { header: "Value", key: "value", width: 1 },
    ],
    [
      { metric: "Total Sales (PHP)", value: peso(totalSales) },
      { metric: "Total Units Sold", value: num(totalUnits) },
      {
        metric: "Top Item by Sales",
        value: itemBySales[0]
          ? `${itemBySales[0].item_name || itemBySales[0].item} â€” ${peso(itemBySales[0].totalSales)}`
          : "No item data",
      },
      {
        metric: "Least Item by Sales",
        value: itemBySales.at(-1)
          ? `${itemBySales.at(-1).item_name || itemBySales.at(-1).item} â€” ${peso(itemBySales.at(-1).totalSales)}`
          : "No item data",
      },
      {
        metric: "Top Item by Units Sold",
        value: itemByUnits[0]
          ? `${itemByUnits[0].item_name || itemByUnits[0].item} â€” ${num(itemByUnits[0].items_sold)}`
          : "No item data",
      },
      {
        metric: "Least Item by Units Sold",
        value: itemByUnits.at(-1)
          ? `${itemByUnits.at(-1).item_name || itemByUnits.at(-1).item} â€” ${num(itemByUnits.at(-1).items_sold)}`
          : "No item data",
      },
    ],
  );
  subTitle("1.2 Overall Totals & Top/Bottom Performers (Category Level)");
  table(
    [
      { header: "Metric", key: "metric", width: 1 },
      { header: "Value", key: "value", width: 1 },
    ],
    [
      {
        metric: "Total Sales (PHP)",
        value: peso(categoryRows.reduce((sum, row) => sum + Number(row.totalSales || 0), 0)),
      },
      {
        metric: "Total Units Sold",
        value: num(categoryRows.reduce((sum, row) => sum + Number(row.items_sold || 0), 0)),
      },
      {
        metric: "Top Category by Sales",
        value: categoryBySales[0]
          ? `${categoryBySales[0].category} â€” ${peso(categoryBySales[0].totalSales)}`
          : "No category data",
      },
      {
        metric: "Least Category by Sales",
        value: categoryBySales.at(-1)
          ? `${categoryBySales.at(-1).category} â€” ${peso(categoryBySales.at(-1).totalSales)}`
          : "No category data",
      },
      {
        metric: "Top Category by Units Sold",
        value: categoryByUnits[0]
          ? `${categoryByUnits[0].category} â€” ${num(categoryByUnits[0].items_sold)}`
          : "No category data",
      },
      {
        metric: "Least Category by Units Sold",
        value: categoryByUnits.at(-1)
          ? `${categoryByUnits.at(-1).category} â€” ${num(categoryByUnits.at(-1).items_sold)}`
          : "No category data",
      },
    ],
  );
  insight(itemInsight);
  title("Part 2: Month-to-Month Trend");
  figure(
    `Figure 1. Monthly Sales and Demand, ${subtitle}`,
    rows,
    "totalSales",
    colors.forest,
    "items_sold",
  );
  insight(insightFor(report));
  subTitle("Month-to-Month Comparison Table");
  table(
    [
      { header: "Month", key: "month", width: 1.2 },
      { header: "Sales (PHP)", key: "sales", width: 1 },
      { header: "Sales Growth (MoM %)", key: "salesGrowth", width: 1 },
      { header: "Units Sold", key: "units", width: 1 },
      { header: "Units Growth (MoM %)", key: "unitsGrowth", width: 1 },
    ],
    rows.map((row, index) => ({
      month: row.month,
      sales: peso(row.totalSales),
      salesGrowth: formatPercent(row.momChangePct),
      units: num(row.items_sold),
      unitsGrowth:
        index === 0
          ? "â€”"
          : formatPercent(
              ((Number(row.items_sold) - Number(rows[index - 1].items_sold)) /
                Number(rows[index - 1].items_sold)) *
                100,
            ),
    })),
  );
  title("Part 3: Top & Least Performing Items");
  figure("Figure 2. Top 5 and Least 5 Items by Units Sold", topItems, "unitsValue");
  subTitle("Top 5 Items");
  table(
    [
      { header: "Item Name", key: "item", width: 1.5 },
      { header: "Category", key: "category", width: 1.2 },
      { header: "Units Sold", key: "units", width: 1 },
      { header: "Total Sales (PHP)", key: "sales", width: 1.2 },
    ],
    topItems,
  );
  subTitle("Least 5 Items");
  table(
    [
      { header: "Item Name", key: "item", width: 1.5 },
      { header: "Category", key: "category", width: 1.2 },
      { header: "Units Sold", key: "units", width: 1 },
      { header: "Total Sales (PHP)", key: "sales", width: 1.2 },
    ],
    leastItems,
  );
  insight(
    leastItems[0]
      ? `${leastItems[0].item} recorded the lowest units sold (${leastItems[0].units}) for the period and may be a candidate for menu review or promotion.`
      : "No item ranking data was returned.",
  );
  title("Part 4: Forecasting");
  figure(
    "Figure 3. Selected Months + 3-Month Forecast â€” Sales and Demand",
    forecastRows,
    "predictedValue",
  );
  insight(
    forecastRows.length
      ? `Revenue forecast: ${forecastRows.map((row) => `${row.month} ${peso(row.predictedValue)}`).join(", ")}. Demand forecast: ${forecastRows.map((row) => `${row.month} ${num(row.predictedUnits)}`).join(", ")}.`
      : "Forecast data was not returned for this period.",
  );
  subTitle("4.1 Sales Forecast â€” By Month");
  table(
    [
      { header: "Forecasted Month", key: "month", width: 1.3 },
      { header: "Sales (PHP)", key: "sales", width: 1 },
      { header: "Percentage", key: "percentage", width: 1 },
    ],
    forecastRows.map((row) => ({
      month: row.month,
      sales: peso(row.predictedValue),
      percentage: "100%",
    })),
  );
  subTitle("4.2 Demand Forecast â€” By Month");
  table(
    [
      { header: "Forecasted Month", key: "month", width: 1.3 },
      { header: "Quantity (units)", key: "units", width: 1 },
      { header: "Percentage", key: "percentage", width: 1 },
    ],
    forecastRows.map((row) => ({
      month: row.month,
      units: num(row.predictedUnits),
      percentage: "100%",
    })),
  );
  contributionSection("Part 5: Category Contribution — Sales", report.salesContribution, "revenue", report.salesInsight);
  contributionSection("Part 6: Category Contribution — Demand", report.demandContribution, "units", report.demandInsight);
  text(
    "Category-level forecast values are allocated top-down from the overall SARIMA forecast, using each category's recent historical share of total sales/demand.",
    8.2,
  );
  pdf.setDrawColor(...colors.line);
  pdf.line(margin, y, width - margin, y);
  y += 8;
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(8);
  pdf.setTextColor(...colors.muted);
  pdf.text(
    "Report generated by the Jamstart Coffee Sales Trend Analysis and Forecasting Dashboard.",
    margin,
    y,
  );
  return pdf;
}

function makePdf(report, subtitle) {
  const pdf = new jsPDF({ unit: "mm" });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const margin = 16;
  const rows = report.rows || [];
  const forecast = report.reportType === "forecasting";
  const insight = insightFor(report);
  const colors = {
    forest: [6, 78, 59],
    ink: [20, 55, 42],
    muted: [88, 116, 103],
    pale: [235, 247, 239],
    line: [211, 226, 217],
    lime: [101, 131, 35],
  };
  let y = 0;
  const header = () => {
    pdf.setFillColor(...colors.forest);
    pdf.rect(0, 0, width, 25, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Jamstart Coffee", margin, 11);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text("SALES & DEMAND ANALYTICS REPORT", margin, 18);
    pdf.text(subtitle, width - margin, 14, { align: "right" });
  };
  const ensure = (space) => {
    if (y + space > height - 17) {
      pdf.addPage();
      y = 18;
      header();
    }
  };
  const heading = (text, size = 14) => {
    ensure(14);
    pdf.setTextColor(...colors.forest);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(size);
    pdf.text(text, margin, y);
    y += size * 0.65 + 4;
  };
  const paragraph = (text) => {
    ensure(18);
    pdf.setTextColor(...colors.ink);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    const lines = pdf.splitTextToSize(text, width - margin * 2);
    pdf.text(lines, margin, y);
    y += lines.length * 4.5 + 5;
  };
  const table = (columns, tableRows) => {
    const colWidth = (width - margin * 2) / columns.length;
    const rowHeight = 7;
    ensure(12 + (tableRows.length + 1) * rowHeight);
    columns.forEach((column, index) => {
      const x = margin + index * colWidth;
      pdf.setFillColor(...colors.pale);
      pdf.setDrawColor(...colors.line);
      pdf.rect(x, y, colWidth, rowHeight, "FD");
      pdf.setTextColor(...colors.forest);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.text(column.header, x + 2, y + 4.6);
    });
    y += rowHeight;
    tableRows.forEach((row, rowIndex) => {
      columns.forEach((column, index) => {
        const x = margin + index * colWidth;
        pdf.setFillColor(rowIndex % 2 ? 250 : 255, 252, rowIndex % 2 ? 250 : 255);
        pdf.rect(x, y, colWidth, rowHeight, "FD");
        pdf.setTextColor(...colors.ink);
        pdf.setFont("helvetica", "normal");
        pdf.text(String(row[column.key] ?? "-").slice(0, 24), x + 2, y + 4.6);
      });
      y += rowHeight;
    });
    y += 6;
  };
  const insightBox = () => {
    ensure(28);
    pdf.setFillColor(...colors.pale);
    pdf.roundedRect(margin, y, width - margin * 2, 22, 2, 2, "F");
    pdf.setTextColor(...colors.forest);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("INSIGHT", margin + 4, y + 6);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...colors.ink);
    pdf.setFontSize(8.5);
    pdf.text(pdf.splitTextToSize(insight, width - margin * 2 - 8), margin + 4, y + 12);
    y += 30;
  };
  header();
  y = 39;
  pdf.setTextColor(...colors.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(20);
  pdf.text(`${report.title} report`, margin, y);
  y += 8;
  paragraph(
    `Report period: ${subtitle}. Prepared from the Jamstart Coffee sales trend analysis and forecasting dashboard.`,
  );
  heading("Part 1: Summary overview");
  const sales = rows.reduce((sum, row) => sum + Number(row.totalSales || 0), 0);
  const units = rows.reduce(
    (sum, row) => sum + Number(row.items_sold || row.predictedValue || 0),
    0,
  );
  table(
    [
      { header: "Metric", key: "metric" },
      { header: "Value", key: "value" },
    ],
    forecast
      ? [
          { metric: "Forecast months", value: rows.length },
          { metric: "Forecast basis", value: "Latest 6 months" },
          { metric: "Projected total", value: num(units) },
        ]
      : [
          { metric: "Total sales", value: peso(sales) },
          { metric: "Total units sold", value: num(units) },
          { metric: "Months analyzed", value: rows.length },
        ],
  );
  insightBox();
  heading(forecast ? "Part 2: Forecast outlook" : "Part 2: Month-to-month trend");
  ensure(62);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(...colors.ink);
  pdf.text(
    forecast
      ? "Figure 1. Forecast values from the latest six months"
      : "Figure 1. Monthly sales and demand",
    margin,
    y,
  );
  y += 8;
  drawChart(
    pdf,
    rows,
    forecast ? "predictedValue" : "totalSales",
    margin + 4,
    y + 4,
    width - margin * 2 - 8,
    42,
    colors.forest,
    forecast ? "Projected value" : "Total sales",
  );
  y += 58;
  if (!forecast) {
    drawChart(
      pdf,
      rows,
      "items_sold",
      margin + 4,
      y,
      width - margin * 2 - 8,
      35,
      colors.lime,
      "Units sold",
    );
    y += 50;
  }
  insightBox();
  heading(forecast ? "Forecast comparison" : "Month-to-month comparison");
  table(
    forecast
      ? [
          { header: "Month", key: "month" },
          { header: "Projected", key: "predictedValue" },
          { header: "Lower", key: "lowerBound" },
          { header: "Upper", key: "upperBound" },
        ]
      : [
          { header: "Month", key: "month" },
          { header: "Sales", key: "totalSales" },
          { header: "Units", key: "items_sold" },
          { header: "MoM", key: "momChangePct" },
        ],
    rows,
  );
  heading("Explanation", 11);
  paragraph(
    forecast
      ? "Forecast values are calculated from the latest six completed months of sales activity. Confidence bounds show the expected range around each projection."
      : "The insight blocks connect the chart movement with the strongest and weakest months. The report preserves the figures shown in the dashboard for the selected period.",
  );
  pdf.setDrawColor(...colors.line);
  pdf.line(margin, height - 18, width - margin, height - 18);
  pdf.setFontSize(7);
  pdf.setTextColor(...colors.muted);
  pdf.text(
    "Report generated by the Jamstart Coffee Sales Trend Analysis and Forecasting Dashboard.",
    margin,
    height - 10,
  );
  return pdf;
}

export default function Reports() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeReport, setActiveReport] = useState(null);
  const [fromDate, setFromDate] = useState("all");
  const [toDate, setToDate] = useState("all");
  const [horizon, setHorizon] = useState(3);
  const [preview, setPreview] = useState(null);
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  useEffect(() => {
    if (!preview || !activeReport) {
      setPdfUrl("");
      return undefined;
    }
    const periodLabel = fromDate === "all" && toDate === "all" ? "All time" : `${fromDate === "all" ? "Start" : fromDate} to ${toDate === "all" ? "End" : toDate}`;
    const pdf = makeTemplatePdf(preview, periodLabel);
    const url = URL.createObjectURL(pdf.output("blob"));
    setPdfUrl((oldUrl) => {
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      return url;
    });
    return () => URL.revokeObjectURL(url);
  }, [preview, activeReport, fromDate, toDate]);
  const loadPreview = async (report = activeReport) => {
    if (!report) return;
    setLoading(true);
    setError("");
    try {
      if (report.key === "sales_trend") {
        const baseParams = { preview: "true", ...rangeBounds(fromDate, toDate) };
        const [trend, items, categories, revenueForecast, demandForecast] = await Promise.all([
          api.get("/sales/export", { params: { ...baseParams, reportType: "mom_report" } }),
          api.get("/sales/export", { params: { ...baseParams, reportType: "item_performance" } }),
          api.get("/sales/export", {
            params: { ...baseParams, reportType: "category_performance" },
          }),
          api.get("/analytics/forecast-pretrained/sarima", {
            params: { monthsAhead: 3, historyMonths: 6 },
          }),
          api.get("/analytics/forecast-pretrained/demand", {
            params: { monthsAhead: 3, historyMonths: 6 },
          }),
        ]);
        const demandRows = demandForecast.data.forecast || [];
        const forecastRows = (revenueForecast.data.forecast || []).map((row, index) => ({
          ...row,
          predictedUnits: demandRows[index]?.predictedValue ?? 0,
        }));
        setPreview({
          ...trend.data,
          title: report.title,
          itemRows: items.data.rows || [],
          categoryRows: categories.data.rows || [],
          forecastRows,
          salesContribution: revenueForecast.data.category_contribution || [],
          demandContribution: demandForecast.data.category_contribution || [],
          salesInsight: revenueForecast.data.category_insight || "",
          demandInsight: demandForecast.data.category_insight || "",
        });
      } else {
        const { data } = await api.get("/analytics/forecast-pretrained/sarima", {
          params: { monthsAhead: horizon, historyMonths: 6 },
        });
        setPreview({
          title: report.title,
          reportType: report.key,
          rows: data.forecast || [],
          columns: [],
        });
      }
    } catch (err) {
      setError(err.response?.data?.error || "Unable to load this report preview.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (activeReport) void loadPreview(activeReport);
  }, [activeReport, fromDate, toDate]);
  const openReport = (report) => {
    setActiveReport(report);
    setPreview(null);
    setPdfUrl("");
    setError("");
  };
  const exportReport = (format) => {
    if (!preview) return;
    setExporting(true);
    const filename = `${activeReport.key}-${fromDate === "all" && toDate === "all" ? "all-time" : `${fromDate}-${toDate}`}`;
    try {
      if (format === "pdf" && pdfUrl) {
        const link = document.createElement("a");
        link.href = pdfUrl;
        link.download = `${filename}.pdf`;
        link.click();
      }
      if (format === "csv") {
        const columns =
          preview.reportType === "forecasting"
            ? [
                { header: "Month", key: "month" },
                { header: "Projected value", key: "predictedValue" },
              ]
            : preview.columns;
        downloadFile(
          `${columns.map((column) => csvValue(column.header)).join(",")}\n${preview.rows.map((row) => columns.map((column) => csvValue(row[column.key])).join(",")).join("\n")}`,
          `${filename}.csv`,
          "text/csv;charset=utf-8",
        );
      }
      if (format === "xlsx") downloadExcel(preview.columns, preview.rows, `${filename}.xls`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="grid gap-6">
      <div className="overflow-hidden rounded-[1.5rem] border border-emerald-900/10 bg-[#fbfaf7] shadow-sm shadow-emerald-950/5">
        <div className="flex items-start gap-4 border-b border-emerald-900/10 px-6 py-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700">
            <Package className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-emerald-950">
              Sales Management
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 pt-3">
          <button
            type="button"
            onClick={() => navigate("/sales")}
            className="inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-emerald-900/70"
          >
            <ClipboardList className="h-4 w-4" />
            Sales Records
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 border-b-2 border-emerald-700 px-3 py-2 text-sm font-medium text-emerald-700"
          >
            <BarChart3 className="h-4 w-4" />
            Reports
          </button>
        </div>
      </div>
      <section className="rounded-[1.75rem] border border-emerald-900/10 bg-[#fbfaf7] p-6 shadow-sm shadow-emerald-950/5 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <FileText className="h-5 w-5 text-emerald-700" />
          <div>
            <h1 className="text-xl font-semibold text-emerald-950">Choose a report</h1>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {reports.map((report) => {
            const Icon = report.icon;
            return (
              <button
                key={report.key}
                type="button"
                onClick={() => openReport(report)}
                className="group flex items-start gap-4 rounded-2xl border border-emerald-900/10 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-emerald-700/30 hover:shadow-md"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${report.accent}`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <strong className="block text-base text-emerald-950">{report.title}</strong>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    Configure report <Eye className="h-4 w-4" />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      {activeReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-emerald-950/55 px-4 py-6 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[1.5rem] border border-emerald-200/40 bg-[#fbfaf7] shadow-2xl">
            <div className="flex items-start justify-between border-b border-emerald-900/10 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">
                  Jamstart report template
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-emerald-950">
                  {activeReport.title}
                </h2>
                <p className="mt-1 text-sm text-emerald-900/60">
                  The preview below is the exact PDF that will be downloaded.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveReport(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-900/10 bg-white text-emerald-900/60"
                aria-label="Close report modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-auto p-5 sm:p-7">
              <div className="grid gap-3 rounded-2xl border border-emerald-900/10 bg-emerald-50/60 p-4 sm:grid-cols-3">
                {activeReport.key === "sales_trend" ? (
                  <>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900/65">
                      From
                      <ReportPeriodPicker value={fromDate} onChange={setFromDate} />
                    </label>
                    <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900/65">
                      To
                      <ReportPeriodPicker value={toDate} onChange={setToDate} />
                    </label>
                  </>
                ) : (
                  <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-900/65">
                    Forecast months
                    <select
                      value={horizon}
                      onChange={(event) => setHorizon(Number(event.target.value))}
                      className="rounded-xl border border-emerald-900/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-emerald-950"
                    >
                      <option value="3">3 months</option>
                      <option value="6">6 months</option>
                      <option value="12">12 months</option>
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => loadPreview()}
                  disabled={loading}
                  className="self-end rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {loading ? "Building report..." : "Refresh preview"}
                </button>
              </div>
              {error && (
                <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
              )}
              {pdfUrl ? (
                <iframe
                  title="Exact report PDF preview"
                  src={pdfUrl}
                  className="mt-5 h-[62vh] min-h-[520px] w-full rounded-2xl border border-emerald-900/10 bg-white"
                />
              ) : (
                <div className="mt-5 grid h-[62vh] min-h-[520px] place-items-center rounded-2xl border border-dashed border-emerald-900/15 text-sm text-emerald-900/50">
                  {loading ? "Preparing the report..." : "Choose a report to preview it."}
                </div>
              )}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-emerald-900/10 pt-4">
                <p className="text-xs text-emerald-900/55">
                  PDF includes the template sections, graphs, explanations, and generated insights.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => exportReport("pdf")}
                    disabled={!pdfUrl || exporting}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => exportReport("csv")}
                    disabled={!preview || exporting}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-900/10 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4" />
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => exportReport("xlsx")}
                    disabled={!preview || exporting}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-900/10 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-900 disabled:opacity-50"
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Excel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

