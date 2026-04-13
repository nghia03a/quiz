// ============================================================
// config/database.js — Pool kết nối MySQL
//
// Dùng mysql2/promise để dùng được async/await trong controllers
// Pool tự động quản lý nhiều kết nối đồng thời
//
// Cách dùng trong controller:
//   const db = require('../config/database');
//   const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
// ============================================================

const mysql = require("mysql2/promise");

// Tạo pool kết nối — đọc cấu hình từ .env
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "exam_system",
  connectionLimit: parseInt(process.env.DB_POOL_MAX) || 10,
  waitForConnections: true,
  queueLimit: 0,
  timezone: "+07:00", // múi giờ Việt Nam
  charset: "utf8mb4", // hỗ trợ tiếng Việt
});

module.exports = pool;
