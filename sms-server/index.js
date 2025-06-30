const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const cron = require('node-cron');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8081;

// Middleware
app.use(express.json());
app.use(cors());

// Load and check Africa's Talking config
const AfricasTalking = require('africastalking')({
    apiKey: process.env.AFRICASTALKING_API_KEY,
    username: process.env.AFRICASTALKING_USERNAME || 'sandbox'
});

const sms = AfricasTalking.SMS;

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('✅ MongoDB connected');
}).catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
});

// Reminder model
const reminderSchema = new mongoose.Schema({
    name: String,
    phone: String,
    medication: String,
    sendAt: Date,
    sent: { type: Boolean, default: false }
});

const Reminder = mongoose.model('Reminder', reminderSchema);

// Routes
app.get('/health', (req, res) => {
    res.json({
        status: 'SMS Server is running',
        timestamp: new Date().toISOString()
    });
});

// Send SMS directly
app.post('/send-sms', async (req, res) => {
    try {
        const { to, message, name } = req.body;
        if (!to || !message) {
            return res.status(400).json({ success: false, error: 'Phone number and message are required' });
        }

        let formattedPhone = to.toString().trim().replace(/[\s\-\(\)]/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '+254' + formattedPhone.slice(1);
        } else if (formattedPhone.startsWith('254')) {
            formattedPhone = '+' + formattedPhone;
        } else if (!formattedPhone.startsWith('+254')) {
            formattedPhone = '+254' + formattedPhone;
        }

        const phoneRegex = /^\+254[17]\d{8}$/;
        if (!phoneRegex.test(formattedPhone)) {
            return res.status(400).json({ success: false, error: 'Invalid Kenya phone number format' });
        }

        const finalMessage = name ? `Hi ${name}, ${message}` : message;

        const result = await sms.send({
            to: formattedPhone,
            message: finalMessage,
            from: process.env.AFRICASTALKING_SHORTCODE || undefined
        });

        if (result.SMSMessageData?.Recipients?.[0]?.status === 'Success') {
            return res.json({ success: true, message: 'SMS sent', data: result.SMSMessageData.Recipients[0] });
        }

        return res.status(400).json({ success: false, error: 'Failed to send SMS', result });

    } catch (error) {
        console.error('❌ SMS Error:', error);
        return res.status(500).json({ success: false, error: 'SMS sending failed', details: error.message });
    }
});

// Test SMS
app.post('/test-sms', async (req, res) => {
    try {
        const testPhone = process.env.TEST_PHONE_NUMBER || '+254712345678';
        const testMessage = 'Hello from CareSync! This is a test message.';

        const result = await sms.send({
            to: testPhone,
            message: testMessage
        });

        res.json({ success: true, message: 'Test SMS sent', to: testPhone, result });
    } catch (error) {
        console.error('❌ Test SMS Error:', error);
        res.status(500).json({ success: false, error: 'Test SMS failed', details: error.message });
    }
});

// Save reminder
app.post('/api/reminders', async (req, res) => {
    try {
        const { name, phone, medication, sendAt } = req.body;
        const reminder = new Reminder({ name, phone, medication, sendAt });
        await reminder.save();
        res.json({ success: true, message: 'Reminder saved.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Cron job to send reminders
cron.schedule('* * * * *', async () => {
    const now = new Date();
    const reminders = await Reminder.find({ sent: false, sendAt: { $lte: now } });

    for (const r of reminders) {
        let formattedPhone = r.phone.toString().trim().replace(/[\s\-\(\)]/g, '');
        if (formattedPhone.startsWith('0')) {
            formattedPhone = '+254' + formattedPhone.slice(1);
        } else if (formattedPhone.startsWith('254')) {
            formattedPhone = '+' + formattedPhone;
        } else if (!formattedPhone.startsWith('+254')) {
            formattedPhone = '+254' + formattedPhone;
        }

        const msg = `Hi ${r.name}, this is your reminder to take: ${r.medication}.`;

        try {
            const result = await sms.send({
                to: formattedPhone,
                message: msg,
                from: process.env.AFRICASTALKING_SHORTCODE || undefined
            });

            console.log(`✅ Reminder sent to ${formattedPhone}`);
            r.sent = true;
            await r.save();
        } catch (err) {
            console.error(`❌ Failed to send to ${formattedPhone}:`, err.message);
        }
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`📨 SMS server running at http://localhost:${PORT}`);
    console.log('📋 Available endpoints:');
    console.log('   GET  /health');
    console.log('   POST /send-sms');
    console.log('   POST /test-sms');
    console.log('   POST /api/reminders');
});
