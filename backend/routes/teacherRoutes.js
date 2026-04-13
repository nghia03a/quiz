// ============================================================
// routes/teacherRoutes.js — Lớp học, đề thi, giám sát, kết quả
//
// Prefix trong app.js: /api/teacher
// Tất cả routes đều cần: authMiddleware + roleMiddleware('teacher')
//
// Routes:
//   GET    /api/teacher/dashboard
//   GET    /api/teacher/classes
//   POST   /api/teacher/classes
//   GET    /api/teacher/classes/:id
//   PUT    /api/teacher/classes/:id
//   DELETE /api/teacher/classes/:id
//   DELETE /api/teacher/classes/:classId/students/:studentId
//   GET    /api/teacher/exams
//   POST   /api/teacher/exams
//   GET    /api/teacher/exams/:id/results
//   GET    /api/teacher/exams/:id/export
//   GET    /api/teacher/exams/:id/monitor-data
//   GET    /api/teacher/exams/:id/violations
//   GET    /api/teacher/exams/:id
//   PUT    /api/teacher/exams/:id
//   DELETE /api/teacher/exams/:id
//
// Câu hỏi được tách sang questionRoutes.js
//
// Đồng bộ với:
//   frontend/pages/teacher/dashboard.html    — GET /api/teacher/dashboard
//   frontend/pages/teacher/classes.html      — CRUD lớp học
//   frontend/pages/teacher/class-detail.html — GET /api/teacher/classes/:id
//   frontend/pages/teacher/manage-exams.html — CRUD đề thi
//   frontend/pages/teacher/create-exam.html  — POST/PUT đề thi
//   frontend/pages/teacher/monitor.html      — GET monitor-data, violations
//   frontend/pages/teacher/results.html      — GET results, export
// ============================================================

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const teacherController = require("../controllers/teacherController");
const monitorController = require("../controllers/monitorController");

// Áp dụng cho TẤT CẢ routes trong file này
router.use(authMiddleware);
router.use(roleMiddleware("teacher"));

// ============================================================
// TỔNG QUAN
// ============================================================
router.get("/dashboard", teacherController.getDashboard);

// ============================================================
// LỚP HỌC
// ============================================================
router.get("/classes", teacherController.getClasses);
router.post("/classes", teacherController.createClass);
router.get("/classes/:id", teacherController.getClassDetail);
router.put("/classes/:id", teacherController.updateClass);
router.delete("/classes/:id", teacherController.deleteClass);

// Xóa 1 học sinh khỏi lớp
router.delete(
  "/classes/:classId/students/:studentId",
  teacherController.removeStudentFromClass,
);

// ============================================================
// ĐỀ THI
// QUAN TRỌNG — Thứ tự đặt route:
//   Các route có path cụ thể (:id/results, :id/export,...)
//   phải đặt TRƯỚC route chung (:id)
//   Nếu đặt sau, Express khớp :id trước → không bao giờ vào được route cụ thể
// ============================================================
router.get("/exams", teacherController.getExams);
router.post("/exams", teacherController.createExam);

// Các sub-route của :id — đặt TRƯỚC route /exams/:id
router.get("/exams/:id/results", teacherController.getExamResults);
router.get("/exams/:id/export", teacherController.exportResults);
router.get("/exams/:id/monitor-data", monitorController.getMonitorData);
router.get("/exams/:id/violations", monitorController.getViolations);

// Route chung /exams/:id — đặt SAU các sub-route
router.get("/exams/:id", teacherController.getExamById);
router.put("/exams/:id", teacherController.updateExam);
router.delete("/exams/:id", teacherController.deleteExam);

module.exports = router;
