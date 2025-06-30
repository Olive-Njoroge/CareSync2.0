const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  name: String,
  phone: String,
  medication: String,
  sendAt: Date,
  sent: { type: Boolean, default: false }
});

module.exports = mongoose.model('Reminder', reminderSchema);
