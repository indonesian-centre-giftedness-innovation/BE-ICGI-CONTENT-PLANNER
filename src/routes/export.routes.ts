import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { contents, storyboards, storyboardScenes } from "../db/schema.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import * as gdrive from "../services/gdrive.service.js";

export const exportRouter = Router();

exportRouter.use(authMiddleware);

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_review: "Menunggu Review",
  revisi: "Revisi",
  approved: "Approved",
  published: "Published",
};
const PILLAR_LABEL: Record<string, string> = {
  edukasi: "Edukasi",
  hiburan: "Hiburan",
  promosi: "Promosi",
};
const FUNNEL_LABEL: Record<string, string> = { tofu: "TOFU", mofu: "MOFU", bofu: "BOFU" };

function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

// ============================================================
// EXPORT KONTEN — EXCEL
// ============================================================
exportRouter.get("/content.xlsx", async (_req, res) => {
  const rows = await db.query.contents.findMany({
    orderBy: [asc(contents.title)],
    with: { author: { columns: { name: true } } },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ICGI Content Planner";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Konten");
  sheet.columns = [
    { header: "Judul", key: "title", width: 34 },
    { header: "Platform", key: "platform", width: 14 },
    { header: "Pillar", key: "pillar", width: 12 },
    { header: "Funnel", key: "funnel", width: 10 },
    { header: "Status", key: "status", width: 18 },
    { header: "Penulis", key: "author", width: 20 },
    { header: "Dibuat", key: "createdAt", width: 14 },
    { header: "Diperbarui", key: "updatedAt", width: 14 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FF14141A" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCC00" } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });

  for (const c of rows) {
    const row = sheet.addRow({
      title: c.title,
      platform: c.platform || "-",
      pillar: c.pillar ? PILLAR_LABEL[c.pillar] : "-",
      funnel: c.funnel ? FUNNEL_LABEL[c.funnel] : "-",
      status: STATUS_LABEL[c.status] || c.status,
      author: c.author?.name || "-",
      createdAt: fmtDate(c.createdAt),
      updatedAt: fmtDate(c.updatedAt),
    });
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
    });
  }

  sheet.autoFilter = { from: "A1", to: "H1" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", 'attachment; filename="konten-icgi.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// ============================================================
// EXPORT KONTEN — PDF
// ============================================================
exportRouter.get("/content.pdf", async (_req, res) => {
  const rows = await db.query.contents.findMany({
    orderBy: [asc(contents.title)],
    with: { author: { columns: { name: true } } },
  });

  const doc = new PDFDocument({ margin: 32, size: "A4", layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'attachment; filename="konten-icgi.pdf"');
  doc.pipe(res);

  doc.fontSize(16).font("Helvetica-Bold").text("Daftar Konten — ICGI Content Planner");
  doc.fontSize(9).font("Helvetica").fillColor("#666").text(`Diekspor ${fmtDate(new Date())}`);
  doc.moveDown(0.8);

  const cols = [
    { key: "title", label: "Judul", width: 210 },
    { key: "platform", label: "Platform", width: 90 },
    { key: "pillar", label: "Pillar", width: 75 },
    { key: "funnel", label: "Funnel", width: 60 },
    { key: "status", label: "Status", width: 105 },
    { key: "author", label: "Penulis", width: 110 },
    { key: "updatedAt", label: "Diperbarui", width: 90 },
  ];
  const startX = doc.page.margins.left;
  const rowHeight = 20;

  function drawHeader(y: number) {
    let x = startX;
    doc.font("Helvetica-Bold").fontSize(8.5);
    doc.rect(startX, y, cols.reduce((s, c) => s + c.width, 0), rowHeight).fill("#14141A");
    doc.fillColor("#FFFFFF");
    for (const c of cols) {
      doc.text(c.label, x + 4, y + 6, { width: c.width - 8 });
      x += c.width;
    }
    doc.fillColor("#000000");
    return y + rowHeight;
  }

  let y = drawHeader(doc.y);

  doc.font("Helvetica").fontSize(8.5);
  let zebra = false;
  for (const c of rows) {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ margin: 32, size: "A4", layout: "landscape" });
      y = drawHeader(32);
    }

    if (zebra) {
      doc.rect(startX, y, cols.reduce((s, cc) => s + cc.width, 0), rowHeight).fill("#F2F0EA");
      doc.fillColor("#000000");
    }
    zebra = !zebra;

    const values: Record<string, string> = {
      title: c.title,
      platform: c.platform || "-",
      pillar: c.pillar ? PILLAR_LABEL[c.pillar] : "-",
      funnel: c.funnel ? FUNNEL_LABEL[c.funnel] : "-",
      status: STATUS_LABEL[c.status] || c.status,
      author: c.author?.name || "-",
      updatedAt: fmtDate(c.updatedAt),
    };

    let x = startX;
    for (const col of cols) {
      doc.text(values[col.key], x + 4, y + 6, { width: col.width - 8, ellipsis: true });
      x += col.width;
    }
    y += rowHeight;
  }

  doc.end();
});

// ============================================================
// EXPORT STORYBOARD — PDF (format lembar produksi sinematik)
// ============================================================
exportRouter.get("/storyboard/:id/pdf", async (req, res) => {
  const storyboardId = req.params.id;

  const storyboard = await db.query.storyboards.findFirst({
    where: eq(storyboards.id, storyboardId),
    with: { content: { columns: { title: true } } },
  });
  if (!storyboard) {
    return res.status(404).json({ message: "Storyboard tidak ditemukan" });
  }

  const scenes = await db
    .select()
    .from(storyboardScenes)
    .where(eq(storyboardScenes.storyboardId, storyboard.id))
    .orderBy(asc(storyboardScenes.sceneOrder));

  const title = (storyboard.content?.title || storyboard.title || "STORYBOARD").toUpperCase();

  const doc = new PDFDocument({ margin: 30, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="storyboard-${storyboard.id}.pdf"`);
  doc.pipe(res);

  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const tableWidth = pageRight - pageLeft;

  // kolom: CUTS | PICTURE | ACTION | DIALOGUE | TIME
  const colCuts = 40;
  const colPicture = 190;
  const colTime = 45;
  const colAction = (tableWidth - colCuts - colPicture - colTime) * 0.55;
  const colDialogue = tableWidth - colCuts - colPicture - colTime - colAction;

  const rowH = 130;
  let pageNum = 1;

  function drawPageHeader(sceneLabel: string) {
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(title, pageLeft, doc.y, { continued: false });
    const headerY = doc.y - 12;
    doc.fontSize(9).font("Helvetica");
    doc.text(`SCENE: ${sceneLabel}`, pageLeft + 260, headerY);
    doc.text(`PAGE NUMBER: ${pageNum}`, pageLeft + 420, headerY);
    doc.moveDown(1.2);

    const tableTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(8);
    let x = pageLeft;
    const headers = [
      { label: "CUTS", w: colCuts },
      { label: "PICTURE", w: colPicture },
      { label: "ACTION", w: colAction },
      { label: "DIALOGUE", w: colDialogue },
      { label: "TIME", w: colTime },
    ];
    for (const h of headers) {
      doc.text(h.label, x + 3, tableTop, { width: h.w - 6, align: h.label === "CUTS" || h.label === "TIME" ? "center" : "left" });
      x += h.w;
    }
    doc.moveTo(pageLeft, tableTop + 14).lineTo(pageLeft + tableWidth, tableTop + 14).strokeColor("#000").stroke();
    return tableTop + 18;
  }

  let y = drawPageHeader(scenes.length > 0 ? String(scenes.length).padStart(2, "0") : "00");

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];

    if (y + rowH > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ margin: 30, size: "A4" });
      pageNum += 1;
      y = drawPageHeader(String(scenes.length).padStart(2, "0"));
    }

    let x = pageLeft;

    // border luar baris
    doc.rect(pageLeft, y, tableWidth, rowH).strokeColor("#000").lineWidth(1).stroke();

    // CUTS
    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(String(i + 1).padStart(2, "0"), x, y + rowH / 2 - 6, { width: colCuts, align: "center" });
    x += colCuts;
    doc.moveTo(x, y).lineTo(x, y + rowH).strokeColor("#000").stroke();

    // PICTURE — embed gambar sketsa kalau ada
    if (scene.sketchImageGdriveId) {
      try {
        const buffer = await gdrive.getFileBuffer(scene.sketchImageGdriveId);
        doc.image(buffer, x + 6, y + 6, {
          fit: [colPicture - 12, rowH - 12],
          align: "center",
          valign: "center",
        });
      } catch {
        doc.fontSize(7).font("Helvetica").fillColor("#999").text("gambar gagal dimuat", x + 6, y + rowH / 2 - 4, {
          width: colPicture - 12,
          align: "center",
        });
        doc.fillColor("#000");
      }
    } else {
      doc.fontSize(7).font("Helvetica").fillColor("#999").text("(tidak ada sketsa)", x + 6, y + rowH / 2 - 4, {
        width: colPicture - 12,
        align: "center",
      });
      doc.fillColor("#000");
    }
    x += colPicture;
    doc.moveTo(x, y).lineTo(x, y + rowH).strokeColor("#000").stroke();

    // ACTION
    doc.font("Helvetica").fontSize(8.5).fillColor("#000");
    doc.text(scene.description || "-", x + 6, y + 6, { width: colAction - 12, height: rowH - 12 });
    x += colAction;
    doc.moveTo(x, y).lineTo(x, y + rowH).dash(2, { space: 2 }).strokeColor("#000").stroke();
    doc.undash();

    // DIALOGUE — belum ada field khusus di data, dikosongkan buat diisi manual
    doc.font("Helvetica").fontSize(8).fillColor("#888");
    doc.text("Talks\n\nDialogue / sound notes", x + 6, y + 6, { width: colDialogue - 12 });
    doc.fillColor("#000");
    x += colDialogue;
    doc.moveTo(x, y).lineTo(x, y + rowH).strokeColor("#000").stroke();

    // TIME
    doc.font("Helvetica").fontSize(9);
    doc.text(`${scene.durationSeconds}s`, x, y + rowH / 2 - 5, { width: colTime, align: "center" });

    y += rowH;
  }

  if (scenes.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor("#888").text("Belum ada scene di storyboard ini.", pageLeft, y + 10);
  }

  doc.end();
});