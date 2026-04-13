// ============================================================
// routes/adminRoutes.js — Quản lý giáo viên và học sinh
//
// Prefix trong app.js: /api/admin
// Tất cả routes đều cần: authMiddleware + roleMiddleware('admin')
//
// Routes:
//   GET    /api/admin/stats
//   GET    /api/admin/teachers
//   POST   /api/admin/teachers
//   PUT    /api/admin/teachers/:id
//   POST   /api/admin/teachers/:id/toggle-status
//   POST   /api/admin/teachers/:id/reset-password
//   DELETE /api/admin/teachers/:id
//   GET    /api/admin/students
//   POST   /api/admin/students
//   POST   /api/admin/students/import         ← cần uploadMiddleware
//   GET    /api/admin/students/:studentId/stats
//   PUT    /api/admin/students/:id
//   POST   /api/admin/students/:id/toggle-status
//   POST   /api/admin/students/:id/reset-password
//   DELETE /api/admin/students/:id
//
// Đồng bộ với:
//   frontend/pages/admin/dashboard.html      — GET /api/admin/stats
//   frontend/pages/admin/teachers.html       — CRUD giáo viên
//   frontend/pages/admin/students.html       — CRUD + import học sinh
//   frontend/pages/admin/student-detail.html — GET /api/admin/students/:id/stats
// ============================================================

const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const { handleUploadSingle } = require("../middlewares/uploadMiddleware");
const adminController = require("../controllers/adminController");

// Áp dụng authMiddleware + roleMiddleware cho TẤT CẢ routes trong file này
// Không cần lặp lại ở từng route bên dưới
router.use(authMiddleware);
router.use(roleMiddleware("admin"));

// ============================================================
// THỐNG KÊ TỔNG QUAN
// ============================================================
router.get("/stats", adminController.getStats);

// ============================================================
// GIÁO VIÊN
// ============================================================
router.get("/teachers", adminController.getTeachers);
router.post("/teachers", adminController.createTeacher);
router.put("/teachers/:id", adminController.updateTeacher);
router.post("/teachers/:id/toggle-status", adminController.toggleTeacherStatus);
router.post(
  "/teachers/:id/reset-password",
  adminController.resetTeacherPassword,
);
router.delete("/teachers/:id", adminController.deleteTeacher);

// ============================================================
// HỌC SINH
// QUAN TRỌNG — Thứ tự đặt route:
//   /students/import  phải đặt TRƯỚC /students/:id
//   vì nếu đặt sau, Express sẽ nhầm chữ "import" là giá trị của :id
// ============================================================
router.get("/students", adminController.getStudents);
router.post("/students", adminController.createStudent);

// Route import: cần handleUploadSingle để đọc file Excel từ req.file.buffer
router.post(
  "/students/import",
  handleUploadSingle,
  adminController.importStudents,
);

// Xem thống kê học sinh: đặt TRƯỚC /:id để không bị nhầm "stats" là :id
router.get("/students/:studentId/stats", adminController.getStudentStats);

// CRUD theo id
router.put("/students/:id", adminController.updateStudent);
router.post("/students/:id/toggle-status", adminController.toggleStudentStatus);
router.post(
  "/students/:id/reset-password",
  adminController.resetStudentPassword,
);
router.delete("/students/:id", adminController.deleteStudent);

module.exports = router;
