// ============================================================
// uploadMiddleware.js — Xử lý upload file (Multer)
//
// Dùng multer.memoryStorage() — lưu file trong RAM, không ghi ra đĩa.
// Controller đọc trực tiếp từ req.file.buffer bằng SheetJS.
//
// Giới hạn đọc từ .env:
//   UPLOAD_MAX_FILE_SIZE_MB=10
//   UPLOAD_ALLOWED_TYPES=xlsx,docx
//
// Cách dùng trong routes:
//   const { handleUploadSingle } = require('../middlewares/uploadMiddleware');
//   router.post('/import', handleUploadSingle, controller.importStudents);
// ============================================================

const multer = require("multer");
const path = require("path");

// Đọc giới hạn từ .env
const MAX_MB = parseInt(process.env.UPLOAD_MAX_FILE_SIZE_MB) || 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;

// Định dạng cho phép: "xlsx,docx" → ['xlsx', 'docx']
const ALLOWED = (process.env.UPLOAD_ALLOWED_TYPES || "xlsx,docx")
  .split(",")
  .map((e) => e.trim().toLowerCase());

// Lưu trong RAM — không tạo file tạm trên đĩa
const storage = multer.memoryStorage();

// Kiểm tra định dạng file
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase().replace(".", "");
  if (ALLOWED.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Chỉ chấp nhận file: ${ALLOWED.join(", ")}`));
  }
}

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_BYTES } });

// Middleware nhận đúng 1 file, field name = 'file'
// Đã bọc try/catch để xử lý lỗi Multer đúng cách
function handleUploadSingle(req, res, next) {
  upload.single("file")(req, res, function (err) {
    if (!err) {
      if (!req.file) {
        return res
          .status(400)
          .json({ message: "Vui lòng chọn file để upload." });
      }
      return next();
    }
    if (err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ message: `File quá lớn. Tối đa ${MAX_MB}MB.` });
    }
    return res.status(400).json({ message: err.message || "Lỗi upload file." });
  });
}

module.exports = { handleUploadSingle, upload };
