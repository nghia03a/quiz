// ============================================================
// routes/studentRoutes.js — Dashboard, lớp học, thông báo, kết quả
//
// Prefix trong app.js: /api/student
// Tất cả routes đều cần: authMiddleware + roleMiddleware('student')
//
// Routes:
//   GET  /api/student/dashboard
//   GET  /api/student/classes
//   POST /api/student/classes/join
//   POST /api/student/classes/:id/leave
//   GET  /api/student/exams
//   GET  /api/student/history
//   GET  /api/student/results/:attemptId
//   GET  /api/student/notifications
//   POST /api/student/notifications/read-all
//   POST /api/student/notifications/:id/read
//
// Routes thi (start, submit, vi phạm) nằm trong examRoutes.js
//
// Đồng bộ với:
//   frontend/pages/student/dashboard.html   — GET dashboard
//   frontend/pages/student/my-classes.html  — GET classes, join, leave
//   frontend/pages/student/exam-list.html   — GET exams
//   frontend/pages/student/history.html     — GET history
//   frontend/pages/student/result.html      — GET results/:attemptId
// ============================================================

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const studentController = require("../controllers/studentController");
const notificationController = require("../controllers/notificationController");

// Áp dụng cho TẤT CẢ routes trong file này
router.use(authMiddleware);
router.use(roleMiddleware("student"));

// ============================================================
// TỔNG QUAN
// ============================================================
router.get("/dashboard", studentController.getDashboard);

// ============================================================
// LỚP HỌC
// QUAN TRỌNG: /classes/join đặt TRƯỚC /classes/:id/leave
// để "join" không bị nhầm là :id
// ============================================================
router.get("/classes", studentController.getClasses);
router.post("/classes/join", studentController.joinClass);
router.post("/classes/:id/leave", studentController.leaveClass);

// ============================================================
// BÀI THI — chỉ lấy danh sách
// Vào thi và nộp bài nằm trong examRoutes.js
// ============================================================
router.get("/exams", studentController.getExams);

// ============================================================
// KẾT QUẢ & LỊCH SỬ
// ============================================================
router.get("/history", studentController.getHistory);
router.get("/results/:attemptId", studentController.getResult);

// ============================================================
// THÔNG BÁO
// QUAN TRỌNG: /notifications/read-all đặt TRƯỚC /notifications/:id/read
// để "read-all" không bị nhầm là :id
// ============================================================
router.get("/notifications", notificationController.getNotifications);
router.post("/notifications/read-all", notificationController.markAllAsRead);
router.post("/notifications/:id/read", notificationController.markAsRead);

module.exports = router;
