// ============================================================
// socket/socketServer.js — Toàn bộ sự kiện Socket.IO
//
// Tại sao tách khỏi server.js?
//   server.js lo khởi động HTTP + lắng nghe port
//   socketServer.js lo toàn bộ logic sự kiện realtime
//   → Dễ đọc, dễ bảo trì, dễ mở rộng
//
// Các sự kiện xử lý:
//   CLIENT → SERVER (emit từ frontend):
//     teacher_join_monitor  — GV vào phòng giám sát
//     student_join_exam     — HS vào phòng thi
//     violation             — HS báo vi phạm
//     student_submitted     — HS nộp bài
//     webrtc_offer          — WebRTC: HS gửi offer camera
//     webrtc_answer         — WebRTC: GV gửi answer
//     webrtc_ice            — WebRTC: trao đổi ICE candidate
//     disconnect            — Client ngắt kết nối
//
//   SERVER → CLIENT (emit từ server):
//     student_online        → monitor.html (GV): HS vừa vào phòng
//     student_offline       → monitor.html (GV): HS mất kết nối
//     student_submitted     → monitor.html (GV): HS nộp bài
//     violation_alert       → monitor.html (GV): cảnh báo vi phạm
//     webrtc_offer          → monitor.html (GV): nhận offer camera HS
//     webrtc_answer         → exam-room.html (HS): nhận answer từ GV
//     webrtc_ice            → cả 2 phía: ICE candidate
// ============================================================

const socketService = require("../services/socketService");

// ============================================================
// initSocketServer
// Đăng ký tất cả sự kiện Socket.IO
//
// Tham số:
//   io — Socket.IO Server instance (từ server.js)
//
// Cách gọi trong server.js:
//   const initSocketServer = require('./socket/socketServer');
//   initSocketServer(io);
// ============================================================
function initSocketServer(io) {
  // Khởi tạo socketService để các controller có thể emit sự kiện
  socketService.init(io);

  io.on("connection", (socket) => {
    console.log(`[Socket] Client kết nối: ${socket.id}`);

    // --------------------------------------------------------
    // GIÁO VIÊN VÀO PHÒNG GIÁM SÁT
    // monitor.html gọi: socket.emit('teacher_join_monitor', { examId })
    //
    // GV tham gia room riêng theo examId:
    //   monitor_<examId> — nhận toàn bộ sự kiện của buổi thi đó
    // --------------------------------------------------------
    socket.on("teacher_join_monitor", ({ examId }) => {
      if (!examId) return;

      socket.join(`monitor_${examId}`);
      console.log(`[Socket] GV ${socket.id} vào giám sát đề thi: ${examId}`);
    });

    // --------------------------------------------------------
    // HỌC SINH VÀO PHÒNG THI
    // exam-room.html gọi: socket.emit('student_join_exam', { examId, attemptId, fullName })
    //
    // HS tham gia room exam_<examId>
    // Phát sự kiện student_online đến GV đang giám sát
    // --------------------------------------------------------
    socket.on("student_join_exam", ({ examId, attemptId, fullName }) => {
      if (!examId) return;

      socket.join(`exam_${examId}`);

      // Lưu thông tin vào socket để dùng khi disconnect
      socket.data.examId = examId;
      socket.data.fullName = fullName;
      socket.data.attemptId = attemptId;

      // Thông báo GV đang giám sát
      io.to(`monitor_${examId}`).emit("student_online", {
        socketId: socket.id, // dùng để relay WebRTC về đúng HS
        fullName,
        attemptId,
      });

      console.log(`[Socket] HS "${fullName}" vào phòng thi: ${examId}`);
    });

    // --------------------------------------------------------
    // HỌC SINH BÁO VI PHẠM
    // exam-room.html gọi: socket.emit('violation', { examId, attemptId, type, description, fullName })
    //
    // type: 'tab_switch' | 'copy_paste' | 'exit_fullscreen'
    // Server phát đến GV ngay lập tức (độ trễ ≤ 500ms)
    // Ghi vào DB xử lý bởi examController.recordViolation (qua REST API)
    // --------------------------------------------------------
    socket.on(
      "violation",
      ({ examId, attemptId, type, description, fullName }) => {
        if (!examId) return;

        io.to(`monitor_${examId}`).emit("violation_alert", {
          socketId: socket.id,
          fullName: fullName || socket.data.fullName,
          attemptId: attemptId || socket.data.attemptId,
          type,
          description,
          detectedAt: new Date().toISOString(),
        });

        console.log(`[Socket] Vi phạm: "${fullName}" — ${type}`);
      },
    );

    // --------------------------------------------------------
    // HỌC SINH NỘP BÀI
    // exam-room.html gọi sau khi nhận response 200 từ API submit:
    //   socket.emit('student_submitted', { examId, fullName, score })
    // --------------------------------------------------------
    socket.on("student_submitted", ({ examId, fullName, score }) => {
      if (!examId) return;

      io.to(`monitor_${examId}`).emit("student_submitted", {
        socketId: socket.id,
        fullName: fullName || socket.data.fullName,
        score,
      });

      console.log(`[Socket] HS "${fullName}" đã nộp bài — Điểm: ${score}`);
    });

    // --------------------------------------------------------
    // WEBRTC SIGNALING — Camera HS → GV
    //
    // Luồng WebRTC:
    //   1. HS gửi offer → server relay đến GV (monitor room)
    //   2. GV gửi answer → server relay về đúng HS (theo socketId)
    //   3. Hai chiều trao đổi ICE candidate → kết nối P2P
    // --------------------------------------------------------

    // HS gửi offer → relay đến GV trong monitor room
    socket.on("webrtc_offer", ({ examId, offer, fullName }) => {
      if (!examId) return;
      io.to(`monitor_${examId}`).emit("webrtc_offer", {
        from: socket.id, // GV cần biết để gửi answer về đúng HS
        fullName: fullName || socket.data.fullName,
        offer,
      });
    });

    // GV gửi answer → relay về đúng HS theo socketId
    socket.on("webrtc_answer", ({ to, answer }) => {
      if (!to) return;
      io.to(to).emit("webrtc_answer", { answer });
    });

    // Trao đổi ICE candidate — hai chiều
    socket.on("webrtc_ice", ({ to, candidate }) => {
      if (!to) return;
      io.to(to).emit("webrtc_ice", { candidate });
    });

    // --------------------------------------------------------
    // NGẮT KẾT NỐI
    // Tự động phát sự kiện offline đến GV đang giám sát
    // Socket.IO tự xử lý việc rời khỏi tất cả rooms
    // --------------------------------------------------------
    socket.on("disconnect", () => {
      const { examId, fullName, attemptId } = socket.data || {};

      if (examId) {
        // Thông báo GV: HS này mất kết nối
        io.to(`monitor_${examId}`).emit("student_offline", {
          socketId: socket.id,
          fullName,
          attemptId,
        });
        console.log(
          `[Socket] HS "${fullName}" mất kết nối khỏi phòng thi ${examId}`,
        );
      }

      console.log(`[Socket] Client ngắt kết nối: ${socket.id}`);
    });
  }); // end io.on('connection')

  console.log("[SocketServer] Đã đăng ký tất cả sự kiện Socket.IO.");
}

module.exports = initSocketServer;
