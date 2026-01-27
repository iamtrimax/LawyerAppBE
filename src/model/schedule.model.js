const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  lawyerID: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Lawyer', // Tham chiếu tới bảng Profile luật sư
    required: true,
    unique: true // Mỗi luật sư chỉ có 1 bản ghi cấu hình lịch lặp lại
  },
  // Lưu mảng 7 ngày cố định
  workingDays: [
    {
      day: { 
        type: String, 
        enum: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'] 
      },
      active: { type: Boolean, default: false },
      slots: [
        {
          start: { type: String }, // "08:00"
          end: { type: String }    // "17:00"
        }
      ]
    }
  ]
}, { timestamps: true });

module.exports = mongoose.model('Schedule', scheduleSchema);