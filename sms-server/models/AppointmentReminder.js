const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
 name: String,
 phone: String,
 doctorName: String,
 clinicName: String,
 appointmentDate: Date,
 appointmentTime: String,
 reminderSent: { type: Boolean, default: false }
});

module.exports = mongoose.model('Appointment', appointmentSchema);