const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cron = require('node-cron');
const AfricasTalking = require('africastalking');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8081;

// Middleware
app.use(express.json());
app.use(cors());

// Africa's Talking setup
const at = AfricasTalking({
  apiKey: process.env.AFRICASTALKING_API_KEY,
  username: process.env.AFRICASTALKING_USERNAME
});

const sms = at.SMS;
const senderId = process.env.AFRICASTALKING_SENDER_ID || undefined;

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// Mongoose Schema & Model
const reminderSchema = new mongoose.Schema({
  name: String,
  phone: { type: String, required: true },
  type: { type: String, enum: ['medication', 'appointment'], required: true },
  medication: String,
  doctorName: String,
  clinicName: String,
  appointmentDate: Date,
  appointmentTime: String,
  sendAt: Date,
  sent: { type: Boolean, default: false }
});

const Reminder = mongoose.model('Reminder', reminderSchema);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'SMS Server is running', timestamp: new Date().toISOString() });
});

// Get all reminders
app.get('/api/reminders', async (req, res) => {
  try {
    const reminders = await Reminder.find().sort({ sendAt: -1 });
    res.json(reminders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Failed to fetch reminders' });
  }
});

// Send SMS manually
app.post('/send-sms', async (req, res) => {
  const { to, message, name } = req.body;
  if (!to || !message) return res.status(400).json({ success: false, error: 'Phone and message required' });

  let formattedPhone = formatPhone(to);
  if (!formattedPhone) return res.status(400).json({ success: false, error: 'Invalid phone number' });

  const finalMessage = name ? `Hi ${name}, ${message}` : message;

  try {
    const result = await sms.send({ to: formattedPhone, message: finalMessage, from: senderId });
    const recipient = result?.SMSMessageData?.Recipients?.[0];

    if (recipient?.status === 'Success') {
      res.json({ success: true, message: 'SMS sent', data: recipient });
    } else {
      res.status(400).json({ success: false, error: 'Failed to send SMS', result });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'SMS sending failed', details: error.message });
  }
});

// Test SMS endpoint
app.post('/test-sms', async (req, res) => {
  const testPhone = process.env.TEST_PHONE_NUMBER;
  const testMessage = 'Hello from CareSync! This is a test message.';

  try {
    const result = await sms.send({ to: testPhone, message: testMessage, from: senderId });
    res.json({ success: true, message: 'Test SMS sent', to: testPhone, result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Test SMS failed', details: error.message });
  }
});

// Create medication reminder
app.post('/api/reminders/medication', async (req, res) => {
  const { name, phone, medication, sendAt } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });

  try {
    const reminder = new Reminder({ name, phone, type: 'medication', medication, sendAt });
    await reminder.save();
    res.json({ success: true, message: 'Medication reminder saved.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Create appointment reminder
app.post('/api/reminders/appointment', async (req, res) => {
  const { name, phone, doctorName, clinicName, appointmentDate, appointmentTime, sendAt } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });

  try {
    const reminder = new Reminder({ name, phone, type: 'appointment', doctorName, clinicName, appointmentDate, appointmentTime, sendAt });
    await reminder.save();
    res.json({ success: true, message: 'Appointment reminder saved.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Create multiple reminders
app.post('/api/reminders', async (req, res) => {
  const { name, phone, medication, sendAt, repeatDays } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number is required' });

  try {
    const days = parseInt(repeatDays) || 1;
    const reminders = Array.from({ length: days }, (_, i) => ({
      name,
      phone,
      type: 'medication',
      medication,
      sendAt: new Date(new Date(sendAt).getTime() + i * 24 * 60 * 60 * 1000),
      sent: false
    }));

    const savedReminders = await Reminder.insertMany(reminders);
    res.json({ success: true, message: `${savedReminders.length} reminder(s) scheduled successfully.`, data: savedReminders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Cron Job: Check and send due reminders
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const reminders = await Reminder.find({ sent: false, sendAt: { $lte: now } });

  for (const r of reminders) {
    if (!r.phone) continue;

    const formattedPhone = formatPhone(r.phone);
    if (!formattedPhone) continue;

    const msg = r.type === 'medication'
      ? `Hi ${r.name}, this is your reminder to take: ${r.medication}.`
      : `Hi ${r.name}, reminder: You have a doctor's appointment on ${new Date(r.appointmentDate).toLocaleDateString()} at ${r.appointmentTime} at ${r.clinicName}.`;

    try {
      const result = await sms.send({ to: formattedPhone, message: msg, from: senderId });
      console.log(`✅ Reminder sent to ${formattedPhone}`);
      r.sent = true;
      await r.save();
    } catch (err) {
      console.error(`❌ Failed to send to ${formattedPhone}:`, err.message);
    }
  }
});

// Phone formatting helper
function formatPhone(phone) {
  let p = phone.toString().trim().replace(/\s|\-|\(|\)/g, '');
  if (p.startsWith('0')) return '+254' + p.slice(1);
  if (p.startsWith('254')) return '+' + p;
  if (p.startsWith('+254')) return p;
  return null;
}

app.listen(PORT, () => {
  console.log(`📨 SMS server running at http://localhost:${PORT}`);
});
