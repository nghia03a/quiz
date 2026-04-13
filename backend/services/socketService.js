// ============================================================
// services/socketService.js — Quản lý Socket.IO instance
//
// Tại sao cần file này?
//   Socket.IO được khởi tạo trong server.js.
//   Các controller (examController, v.v.) cần emit sự kiện
//   đến client nhưng không có quyền truy cập trực tiếp vào `io`.
//
//   Giải pháp: lưu `io` vào module này → controller gọi qua đây.
//
// Cách dùng:
//   server.js:
//     const socketService = require('./services/socketService');
//     socketService.init(io);
//
//   Bất kỳ controller nào:
//     const socketService = require('../services/socketService');
//     socketService.notifyViolation(examId, data);
// ============================================================

// Biến lưu trữ instance io — được gán 1 lần khi server khởi động
let _io = null;

// ============================================================
// init — Gán Socket.IO instance từ server.js
// Phải gọi hàm này trước khi dùng các hàm khác
// ============================================================
function init(io) {
  _io = io;
  console.log("[SocketService] Đã khởi tạo Socket.IO instance.");
}

// ============================================================
// getIO — Lấy instance io
// Dùng khi cần emit trực tiếp từ controller
// ============================================================
function getIO() {
  if (!_io)
    throw new Error(
      "[SocketService] Socket.IO chưa được khởi tạo. Gọi init(io) trước.",
    );
  return _io;
}

// ============================================================
// notifyViolation
// Phát cảnh báo vi phạm đến GV đang giám sát đề thi
//
// Gọi trong: examController.recordViolation
// Nhận trong: monitor.html → socket.on('violation_alert', ...)
//
// Tham số:
//   examId — đề thi đang diễn ra
//   data   — { fullName, studentId, attemptId, type, description }
// ============================================================
function notifyViolation(examId, data) {
  if (!_io) return;
  _io.to(`monitor_${examId}`).emit("violation_alert", data);
}

// ============================================================
// notifyStudentOnline
// Thông báo cho GV: học sinh vừa vào phòng thi
//
// Gọi trong: examController.startExam (nếu muốn notify ngay khi API gọi)
// Nhận trong: monitor.html → socket.on('student_online', ...)
// ============================================================
function notifyStudentOnline(examId, data) {
  if (!_io) return;
  _io.to(`monitor_${examId}`).emit("student_online", data);
}

// ============================================================
// notifyStudentSubmitted
// Thông báo cho GV: học sinh đã nộp bài
//
// Gọi trong: examController.submitExam sau khi lưu kết quả
// Nhận trong: monitor.html → socket.on('student_submitted', ...)
// ============================================================
function notifyStudentSubmitted(examId, data) {
  if (!_io) return;
  _io.to(`monitor_${examId}`).emit("student_submitted", data);
}

// ============================================================
// notifyNewExam
// Thông báo cho học sinh trong lớp: có đề thi mới được giao
//
// Gọi trong: teacherController.createExam khi is_published = true
// Nhận trong: student/dashboard.html → socket.on('new_exam', ...)
// ============================================================
function notifyNewExam(studentSocketId, data) {
  if (!_io) return;
  _io.to(studentSocketId).emit("new_exam", data);
}

module.exports = {
  init,
  getIO,
  notifyViolation,
  notifyStudentOnline,
  notifyStudentSubmitted,
  notifyNewExam,
};
