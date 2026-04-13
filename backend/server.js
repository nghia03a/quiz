// ============================================================
// server.js — Khởi động HTTP Server + Socket.IO
// ============================================================

require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");

const app = require("./app");
const db = require("./config/database");
const initSocketServer = require("./socket/socketServer"); // toàn bộ sự kiện Socket.IO

// ============================================================
// TẠO HTTP SERVER
// Dùng chung với Socket.IO — không dùng app.listen() trực tiếp
// ============================================================
const server = http.createServer(app);

// ============================================================
// GẮN SOCKET.IO
// ============================================================
const io = new Server(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  },
});

// Đăng ký tất cả sự kiện Socket.IO (được định nghĩa trong socketServer.js)
// socketServer.js sẽ tự gọi socketService.init(io) để các controller có thể emit
initSocketServer(io);

// ============================================================
// KIỂM TRA DB + KHỞI ĐỘNG SERVER
// ============================================================
const PORT = parseInt(process.env.PORT) || 3000;

async function startServer() {
  try {
    await db.query("SELECT 1"); // kiểm tra kết nối MySQL
    console.log("✅ Kết nối MySQL thành công.");

    server.listen(PORT, () => {
      console.log("========================================");
      console.log(`🚀 Server: http://localhost:${PORT}`);
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
    process.exit(1);
  }
}

// Tránh crash server khi có lỗi không được catch
process.on("unhandledRejection", (reason) =>
  console.error("[UnhandledRejection]", reason),
);
process.on("uncaughtException", (err) =>
  console.error("[UncaughtException]", err),
);
process.on("SIGTERM", () => {
  console.log("[SIGTERM] Đang tắt server...");
  server.close(() => {
    console.log("[SIGTERM] Đã tắt.");
    process.exit(0);
  });
});

startServer();

module.exports = { server, io };
