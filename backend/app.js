// ============================================================
// app.js — Cấu hình Express: middleware + routes
//
// File này chỉ tạo và cấu hình app Express.
// Việc khởi động server (listen port) nằm trong server.js.
// Cách tách này giúp dễ test hơn.
//
// Thứ tự đăng ký quan trọng:
//   1. Đọc biến môi trường (.env)
//   2. Gắn middleware toàn cục (cors, json, static)
//   3. Đăng ký routes theo nhóm (auth / admin / teacher / student)
//   4. Xử lý 404 và lỗi chung
// ============================================================

require("dotenv").config(); // đọc file .env — phải chạy trước tất cả

const express = require("express");
const cors = require("cors");
const path = require("path");

// --- Middlewares ---
const authMiddleware = require("./middlewares/authMiddleware");
const roleMiddleware = require("./middlewares/roleMiddleware");
const { handleUploadSingle } = require("./middlewares/uploadMiddleware");

// --- Controllers ---
const authController = require("./controllers/authController");
const adminController = require("./controllers/adminController");
const teacherController = require("./controllers/teacherController");
const questionController = require("./controllers/questionController");
const studentController = require("./controllers/studentController");
const examController = require("./controllers/examController");
const monitorController = require("./controllers/monitorController");
const notificationController = require("./controllers/notificationController");

// ============================================================
// KHỞI TẠO EXPRESS APP
// ============================================================
const app = express();

// ============================================================
// MIDDLEWARE TOÀN CỤC
// ============================================================

// CORS — cho phép Frontend trên cùng origin gọi API
app.use(
  cors({
    origin: process.env.SOCKET_CORS_ORIGIN || "http://localhost:3000",
    credentials: true, // cần thiết để gửi Authorization header
  }),
);

// Parse JSON body — giới hạn 10mb
app.use(express.json({ limit: "10mb" }));

// Parse form data (x-www-form-urlencoded)
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Phục vụ file tĩnh Frontend
// Ví dụ: GET /pages/auth/login.html → ../frontend/pages/auth/login.html
app.use(express.static(path.join(__dirname, "../frontend")));

// ============================================================
// ROUTES AUTH — Không cần đăng nhập
// POST /api/auth/login
// POST /api/auth/logout
// GET  /api/auth/me
// POST /api/auth/change-password
// ============================================================
app.post("/api/auth/login", authController.login);
app.post("/api/auth/logout", authController.logout);
app.get("/api/auth/me", authMiddleware, authController.getMe);
app.post(
  "/api/auth/change-password",
  authMiddleware,
  authController.changePassword,
);

// ============================================================
// ROUTES ADMIN — role = 'admin'
// ============================================================
app.get(
  "/api/admin/stats",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.getStats,
);

// Giáo viên
app.get(
  "/api/admin/teachers",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.getTeachers,
);
app.post(
  "/api/admin/teachers",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.createTeacher,
);
app.put(
  "/api/admin/teachers/:id",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.updateTeacher,
);
app.post(
  "/api/admin/teachers/:id/toggle-status",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.toggleTeacherStatus,
);
app.post(
  "/api/admin/teachers/:id/reset-password",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.resetTeacherPassword,
);
app.delete(
  "/api/admin/teachers/:id",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.deleteTeacher,
);

// Học sinh
// QUAN TRỌNG: /students/import đặt TRƯỚC /students/:id
// để Express không nhầm chữ "import" là một :id
app.get(
  "/api/admin/students",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.getStudents,
);
app.post(
  "/api/admin/students",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.createStudent,
);
app.post(
  "/api/admin/students/import",
  authMiddleware,
  roleMiddleware("admin"),
  handleUploadSingle,
  adminController.importStudents,
);
app.get(
  "/api/admin/students/:studentId/stats",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.getStudentStats,
);
app.put(
  "/api/admin/students/:id",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.updateStudent,
);
app.post(
  "/api/admin/students/:id/toggle-status",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.toggleStudentStatus,
);
app.post(
  "/api/admin/students/:id/reset-password",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.resetStudentPassword,
);
app.delete(
  "/api/admin/students/:id",
  authMiddleware,
  roleMiddleware("admin"),
  adminController.deleteStudent,
);

// ============================================================
// ROUTES TEACHER — role = 'teacher'
// ============================================================
app.get(
  "/api/teacher/dashboard",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.getDashboard,
);

// Lớp học
app.get(
  "/api/teacher/classes",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.getClasses,
);
app.post(
  "/api/teacher/classes",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.createClass,
);
app.get(
  "/api/teacher/classes/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.getClassDetail,
);
app.put(
  "/api/teacher/classes/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.updateClass,
);
app.delete(
  "/api/teacher/classes/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.deleteClass,
);
app.delete(
  "/api/teacher/classes/:classId/students/:studentId",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.removeStudentFromClass,
);

// Câu hỏi (questionController)
// QUAN TRỌNG: /questions/upload và /questions/ai-generate đặt TRƯỚC /questions/:id
app.get(
  "/api/teacher/questions",
  authMiddleware,
  roleMiddleware("teacher"),
  questionController.getQuestions,
);
app.post(
  "/api/teacher/questions/upload",
  authMiddleware,
  roleMiddleware("teacher"),
  handleUploadSingle,
  questionController.uploadQuestions,
);
app.post(
  "/api/teacher/questions/ai-generate",
  authMiddleware,
  roleMiddleware("teacher"),
  questionController.generateQuestionsWithAI,
);
app.post(
  "/api/teacher/questions",
  authMiddleware,
  roleMiddleware("teacher"),
  questionController.createQuestion,
);
app.put(
  "/api/teacher/questions/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  questionController.updateQuestion,
);
app.delete(
  "/api/teacher/questions/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  questionController.deleteQuestion,
);

// Đề thi
// QUAN TRỌNG: /exams/:id/results, /export, /monitor-data, /violations đặt TRƯỚC /exams/:id
app.get(
  "/api/teacher/exams",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.getExams,
);
app.post(
  "/api/teacher/exams",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.createExam,
);
app.get(
  "/api/teacher/exams/:id/results",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.getExamResults,
);
app.get(
  "/api/teacher/exams/:id/export",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.exportResults,
);
app.get(
  "/api/teacher/exams/:id/monitor-data",
  authMiddleware,
  roleMiddleware("teacher"),
  monitorController.getMonitorData,
);
app.get(
  "/api/teacher/exams/:id/violations",
  authMiddleware,
  roleMiddleware("teacher"),
  monitorController.getViolations,
);
app.get(
  "/api/teacher/exams/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.getExamById,
);
app.put(
  "/api/teacher/exams/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.updateExam,
);
app.delete(
  "/api/teacher/exams/:id",
  authMiddleware,
  roleMiddleware("teacher"),
  teacherController.deleteExam,
);

// ============================================================
// ROUTES STUDENT — role = 'student'
// ============================================================
app.get(
  "/api/student/dashboard",
  authMiddleware,
  roleMiddleware("student"),
  studentController.getDashboard,
);

// Lớp học
app.get(
  "/api/student/classes",
  authMiddleware,
  roleMiddleware("student"),
  studentController.getClasses,
);
app.post(
  "/api/student/classes/join",
  authMiddleware,
  roleMiddleware("student"),
  studentController.joinClass,
);
app.post(
  "/api/student/classes/:id/leave",
  authMiddleware,
  roleMiddleware("student"),
  studentController.leaveClass,
);

// Bài thi
app.get(
  "/api/student/exams",
  authMiddleware,
  roleMiddleware("student"),
  studentController.getExams,
);
app.post(
  "/api/student/exams/:examId/start",
  authMiddleware,
  roleMiddleware("student"),
  examController.startExam,
);
app.post(
  "/api/student/exams/:attemptId/submit",
  authMiddleware,
  roleMiddleware("student"),
  examController.submitExam,
);

// Vi phạm (gửi từ exam-room.html khi phát hiện gian lận)
app.post(
  "/api/student/violations",
  authMiddleware,
  roleMiddleware("student"),
  examController.recordViolation,
);

// Kết quả & lịch sử
app.get(
  "/api/student/history",
  authMiddleware,
  roleMiddleware("student"),
  studentController.getHistory,
);
app.get(
  "/api/student/results/:attemptId",
  authMiddleware,
  roleMiddleware("student"),
  studentController.getResult,
);

// Thông báo
// QUAN TRỌNG: /notifications/read-all đặt TRƯỚC /notifications/:id/read
app.post(
  "/api/student/notifications/read-all",
  authMiddleware,
  roleMiddleware("student"),
  notificationController.markAllAsRead,
);
app.get(
  "/api/student/notifications",
  authMiddleware,
  roleMiddleware("student"),
  notificationController.getNotifications,
);
app.post(
  "/api/student/notifications/:id/read",
  authMiddleware,
  roleMiddleware("student"),
  notificationController.markAsRead,
);

// ============================================================
// 404 — Route không tồn tại
// ============================================================
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    // API call không tìm thấy → trả JSON
    return res
      .status(404)
      .json({ message: `Route ${req.method} ${req.path} không tồn tại.` });
  }
  // Trang web không tìm thấy → trả về index.html cho SPA routing
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// ============================================================
// XỬ LÝ LỖI TOÀN CỤC
// Bắt lỗi chưa được xử lý trong controllers
// Phải có đúng 4 tham số để Express nhận ra đây là error handler
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[Global Error Handler]", err);
  return res.status(500).json({
    message: "Đã xảy ra lỗi không mong đợi. Vui lòng thử lại.",
  });
});

module.exports = app;
