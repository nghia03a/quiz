// ============================================================
// routes/authRoutes.js — Đăng nhập, đăng xuất, đổi mật khẩu
//
// Prefix trong app.js: /api/auth
//
// Routes:
//   POST /api/auth/login           — Không cần token
//   POST /api/auth/logout          — Không cần token
//   GET  /api/auth/me              — Cần token (xem thông tin bản thân)
//   POST /api/auth/change-password — Cần token (đổi mật khẩu)
//
// Đồng bộ với:
//   frontend/pages/auth/login.html          — gọi POST /api/auth/login
//   frontend/pages/auth/change-password.html — gọi POST /api/auth/change-password
//   frontend/pages/*/profile.html           — gọi GET /api/auth/me
// ============================================================

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const authController = require("../controllers/authController");

// POST /api/auth/login — đăng nhập, nhận JWT token
router.post("/login", authController.login);

// POST /api/auth/logout — đăng xuất (JWT stateless nên chỉ trả 200)
router.post("/logout", authController.logout);

// GET /api/auth/me — lấy thông tin tài khoản đang đăng nhập
// Dùng trong các trang profile để hiển thị họ tên, mã GV/HS
router.get("/me", authMiddleware, authController.getMe);

// POST /api/auth/change-password — đổi mật khẩu
// Dùng cho cả 2 trường hợp:
//   1. Đổi mật khẩu bắt buộc lần đầu (change-password.html)
//   2. Đổi mật khẩu chủ động từ trang profile
router.post("/change-password", authMiddleware, authController.changePassword);

module.exports = router;
