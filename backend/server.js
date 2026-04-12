// ============================================================
// server.js — Khởi động HTTP Server + Socket.IO
//
// File này làm 3 việc:
//   1. Lấy app Express từ app.js
//   2. Gắn Socket.IO vào cùng HTTP server
//   3. Lắng nghe cổng PORT
//
// Tại sao tách app.js và server.js?
//   app.js → chứa cấu hình Express (dễ test)
//   server.js → chứa logic khởi động (I/O, DB, Socket.IO)
// ============================================================

require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app"); // Express app đã cấu hình
const db = require("./config/database"); // MySQL pool

// ============================================================
// TẠO HTTP SERVER
// Không dùng app.listen() trực tiếp vì Socket.IO cần
// dùng chung cùng 1 HTTP server với Express
// ============================================================
const server = http.createServer(app);

// ============================================================
// GẮN SOCKET.IO VÀO HTTP SERVER
// Dùng cho giám sát thi thời gian thực:
//   - GV nhận cảnh báo vi phạm ngay khi HS bị phát hiện
//   - Signaling WebRTC cho camera
// ============================================================
const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  },
});

// ============================================================
// XỬ LÝ SỰ KIỆN SOCKET.IO
// ============================================================
io.on("connection", (socket) => {
  // --------------------------------------------------------
  // Giáo viên tham gia room giám sát theo examId
  // monitor.html gọi: socket.emit('teacher_join_monitor', { examId })
  // --------------------------------------------------------
  socket.on("teacher_join_monitor", ({ examId }) => {
    if (!examId) return;
    socket.join(`monitor_${examId}`); // tham gia room riêng của từng đề thi
    console.log(`[Socket] Giáo viên joined monitor_${examId}`);
  });

  // --------------------------------------------------------
  // Học sinh vào phòng thi
  // exam-room.html gọi: socket.emit('student_join_exam', { examId, attemptId, fullName })
  // Server phát sự kiện đến GV đang giám sát
  // --------------------------------------------------------
  socket.on("student_join_exam", ({ examId, attemptId, fullName }) => {
    if (!examId) return;
    socket.join(`exam_${examId}`); // HS cũng join room để nhận thông báo

    // Thông báo cho GV đang giám sát
    io.to(`monitor_${examId}`).emit("student_online", {
      studentId: socket.id,
      fullName,
      attemptId,
    });
    console.log(`[Socket] Học sinh "${fullName}" vào phòng thi ${examId}`);
  });

  // --------------------------------------------------------
  // Vi phạm — Học sinh phát hiện và gửi lên
  // exam-room.html gọi: socket.emit('violation', { examId, type, description, fullName })
  // Server phát đến GV ngay lập tức
  // --------------------------------------------------------
  socket.on(
    "violation",
    ({ examId, type, description, fullName, attemptId }) => {
      if (!examId) return;

      // Thông báo đến tất cả GV đang giám sát đề thi này
      io.to(`monitor_${examId}`).emit("violation_alert", {
        studentId: socket.id,
        fullName,
        attemptId,
        type, // 'tab_switch' | 'copy_paste' | 'exit_fullscreen'
        description,
      });
      console.log(`[Socket] Vi phạm: ${fullName} — ${type}`);
    },
  );

  // --------------------------------------------------------
  // Học sinh nộp bài
  // examController.submitExam xong → có thể emit từ controller
  // Hoặc exam-room.html emit trực tiếp sau khi nhận response OK
  // --------------------------------------------------------
  socket.on("student_submitted", ({ examId, fullName, score }) => {
    if (!examId) return;
    io.to(`monitor_${examId}`).emit("student_submitted", {
      studentId: socket.id,
      fullName,
      score,
    });
  });

  // --------------------------------------------------------
  // WebRTC Signaling — Camera học sinh → GV
  // Học sinh gửi offer → Server relay đến GV giám sát
  // --------------------------------------------------------
  socket.on("webrtc_offer", ({ examId, offer, fullName }) => {
    io.to(`monitor_${examId}`).emit("webrtc_offer", {
      from: socket.id,
      fullName,
      offer,
    });
  });

  // GV gửi answer → Server relay về đúng học sinh
  socket.on("webrtc_answer", ({ to, answer }) => {
    io.to(to).emit("webrtc_answer", { answer });
  });

  // ICE candidate
  socket.on("webrtc_ice", ({ to, candidate }) => {
    io.to(to).emit("webrtc_ice", { candidate });
  });

  // --------------------------------------------------------
  // Ngắt kết nối
  // --------------------------------------------------------
  socket.on("disconnect", () => {
    // Thông báo offline cho tất cả rooms mà socket đang tham gia
    // (Socket.IO tự xử lý rời room khi disconnect)
    socket.rooms.forEach((room) => {
      if (room.startsWith("monitor_")) {
        io.to(room).emit("student_offline", { studentId: socket.id });
      }
    });
    console.log(`[Socket] Client ngắt kết nối: ${socket.id}`);
  });
});

// ============================================================
// KIỂM TRA KẾT NỐI DATABASE TRƯỚC KHI LẮNG NGHE PORT
// ============================================================
const PORT = parseInt(process.env.PORT) || 3000;

async function startServer() {
  try {
    // Thử kết nối DB bằng cách chạy 1 query đơn giản
    await db.query("SELECT 1");
    console.log("✅ Kết nối MySQL thành công.");

    // Khởi động HTTP server
    server.listen(PORT, () => {
      console.log("========================================");
      console.log(`🚀 Server đang chạy tại: http://localhost:${PORT}`);
      console.log(`📋 Môi trường: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `🗄️  Database: ${process.env.DB_NAME}@${process.env.DB_HOST}`,
      );
      console.log(
        `🤖 AI Model: ${process.env.AI_MODEL || "llama3-8b-8192"} (Groq)`,
      );
      console.log("========================================");
    });
  } catch (err) {
    console.error("❌ Không thể kết nối MySQL:", err.message);
    console.error(
      "   Kiểm tra lại DB_HOST, DB_USER, DB_PASSWORD, DB_NAME trong .env",
    );
    process.exit(1); // thoát hẳn nếu không có DB
  }
}

// ============================================================
// XỬ LÝ LỖI PROCESS (tránh crash server)
// ============================================================

// Lỗi bất đồng bộ chưa được catch (Promise không có .catch())
process.on("unhandledRejection", (reason) => {
  console.error("[UnhandledRejection]", reason);
  // Không thoát — chỉ log để không crash server
});

// Lỗi đồng bộ chưa được catch (throw trong callback)
process.on("uncaughtException", (err) => {
  console.error("[UncaughtException]", err);
  // Không thoát — chỉ log
});

// Tắt server đúng cách khi nhận tín hiệu SIGTERM (từ PM2, Docker...)
process.on("SIGTERM", () => {
  console.log("[SIGTERM] Đang tắt server...");
  server.close(() => {
    console.log("[SIGTERM] Server đã tắt.");
    process.exit(0);
  });
});

// ============================================================
// KHỞI ĐỘNG
// ============================================================
startServer();

module.exports = { server, io }; // export để dùng trong test nếu cần
