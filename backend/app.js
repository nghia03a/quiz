// ============================================================
// app.js — Cấu hình Express: middleware + routes
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// ============================================================
// MIDDLEWARE TOÀN CỤC
// ============================================================
app.use(
  cors({
    origin: process.env.SOCKET_CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Phục vụ file tĩnh từ thư mục frontend
// Ví dụ: GET /pages/auth/login.html → frontend/pages/auth/login.html
app.use(express.static(path.join(__dirname, "../frontend")));

// ============================================================
// ĐĂNG KÝ ROUTES API
// ============================================================
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/teacher/questions", require("./routes/questionRoutes")); // đặt TRƯỚC /api/teacher
app.use("/api/teacher", require("./routes/teacherRoutes"));
app.use("/api/student", require("./routes/studentRoutes"));
app.use("/api/student", require("./routes/examRoutes"));

// ============================================================
// ROUTE GỐC — redirect về trang đăng nhập
// Không có index.html nên cần redirect thay vì sendFile
// ============================================================
app.get("/", (req, res) => {
  res.redirect("/pages/auth/login.html");
});

// ============================================================
// XỬ LÝ 404
// ============================================================
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      message: `Route ${req.method} ${req.path} không tồn tại.`,
    });
  }
  // Trang HTML không tìm thấy → redirect về login
  res.redirect("/pages/auth/login.html");
});

// ============================================================
// XỬ LÝ LỖI TOÀN CỤC (phải có đúng 4 tham số)
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[Global Error]", err.message);
  return res.status(500).json({
    message: "Đã xảy ra lỗi không mong đợi. Vui lòng thử lại.",
  });
});

module.exports = app;
