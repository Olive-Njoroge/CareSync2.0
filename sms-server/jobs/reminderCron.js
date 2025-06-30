const cron = require('node-cron');
const Reminder = require('../models/Reminder');
const sendSMS = require('../lib/sendSms'); // Adjust if needed

// Runs every minute
cron.schedule('* * * * *', async () => {
  const now = new Date();

  try {
    const dueReminders = await Reminder.find({
      sendAt: { $lte: now },
      sent: false
    });

    for (const reminder of dueReminders) {
      const message = `Hi ${reminder.name}, it's time to take your medication: ${reminder.medication}`;

      const result = await sendSMS(reminder.phone, message, reminder.name);

      if (result.success) {
        reminder.sent = true;
        await reminder.save();
        console.log(`✅ Reminder sent to ${reminder.name} at ${reminder.phone}`);
      } else {
        console.error(`❌ Failed to send SMS to ${reminder.name}:`, result.error);
      }
    }
  } catch (err) {
    console.error('Error running reminder job:', err);
  }
});
