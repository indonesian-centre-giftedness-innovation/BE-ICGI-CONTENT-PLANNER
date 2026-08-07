import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.routes.js";
import { contentRouter } from "./routes/content.routes.js";
import { storyboardRouter } from "./routes/storyboard.routes.js";
import { calendarRouter } from "./routes/calendar.routes.js";
import { todoRouter } from "./routes/todo.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { approvalRouter } from "./routes/approval.routes.js";
import { notificationRouter } from "./routes/notification.routes.js";
import { mediaRouter } from "./routes/media.routes.js";
import { aiRouter } from "./routes/ai.routes.js";
import { promptTemplateRouter } from "./routes/prompt-template.routes.js";
import { exportRouter } from "./routes/export.routes.js";

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    // Header tambahan yang perlu "dibuka" ke JS lintas-domain — tanpa ini, respons
    // GET media/gambar tetap sukses ditampilkan langsung di <img>/<video>, tapi
    // service worker (Workbox) tidak bisa BACA info ukuran/potongan filenya sama
    // sekali, jadi caching & Range-slicing untuk video gagal diam-diam.
    exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "ETag"],
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/auth", authRouter);
app.use("/content", contentRouter);
app.use("/storyboard", storyboardRouter);
app.use("/calendar", calendarRouter);
app.use("/todos", todoRouter);
app.use("/users", userRouter);
app.use("/approval", approvalRouter);
app.use("/notifications", notificationRouter);
app.use("/media", mediaRouter);
app.use("/ai", aiRouter);
app.use("/prompt-templates", promptTemplateRouter);
app.use("/export", exportRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend jalan di http://localhost:${PORT}`);
});