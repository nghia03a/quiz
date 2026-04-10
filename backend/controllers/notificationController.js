// ============================================================
// notificationController.js — Thông báo lịch thi cho học sinh
//
// Bảng notifications:
//   id, user_id, exam_id, title, content, type, is_read, created_at
//
// type: 'exam_assigned' | 'exam_reminder' | 'exam_result'
//
// Routes:
//   GET  /api/student/notifications
//   POST /api/student/notifications/:id/read
// ============================================================

const db = require("../config/database");

// ============================================================
// GET /api/student/notifications
// Lấy danh sách thông báo của học sinh đang đăng nhập
// ============================================================
async function getNotifications(req, res) {
  try {
    const [notifications] = await db.query(
      `SELECT n.id, n.exam_id, n.title, n.content, n.type, n.is_read, n.created_at,
              e.title AS exam_title
       FROM notifications n
       LEFT JOIN exams e ON n.exam_id = e.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [req.user.id],
    );

    return res.status(200).json({
      notifications: notifications.map((n) => ({
        id: n.id,
        examId: n.exam_id,
        examTitle: n.exam_title,
        title: n.title,
        content: n.content,
        type: n.type,
        isRead: n.is_read === 1,
        createdAt: n.created_at,
      })),
      unreadCount: notifications.filter((n) => n.is_read === 0).length,
    });
  } catch (err) {
    console.error("[notificationController.getNotifications]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/student/notifications/:id/read
// Đánh dấu 1 thông báo là đã đọc
// ============================================================
async function markAsRead(req, res) {
  const { id } = req.params;
  try {
    await db.query(
      "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
      [id, req.user.id],
    );
    return res.status(200).json({ message: "Đã đánh dấu đã đọc." });
  } catch (err) {
    console.error("[notificationController.markAsRead]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

// ============================================================
// POST /api/student/notifications/read-all
// Đánh dấu tất cả thông báo là đã đọc
// ============================================================
async function markAllAsRead(req, res) {
  try {
    await db.query("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [
      req.user.id,
    ]);
    return res.status(200).json({ message: "Đã đánh dấu tất cả là đã đọc." });
  } catch (err) {
    console.error("[notificationController.markAllAsRead]", err);
    return res.status(500).json({ message: "Lỗi server." });
  }
}

module.exports = { getNotifications, markAsRead, markAllAsRead };
