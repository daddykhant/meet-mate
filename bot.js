require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: false });
const app = express();
app.use(express.json());

const url = process.env.WEBHOOK_URL;
const chatPairs = {};
const maleQueue = [];
const femaleQueue = [];

// Asynchronously set webhook and catch any errors
(async () => {
  try {
    await bot.setWebHook(`${url}/bot${token}`);
    console.log("Webhook set successfully!");
  } catch (err) {
    console.error("Error setting webhook:", err);
  }
})();

// Handle Telegram webhook requests
app.post(`/bot${token}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing update:", error);
    res.sendStatus(500);
  }
});

// Start message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    `Hello! I'm here to connect you anonymously with another user.
    \nCommands:
    - /male: Join the male queue to find a match.
    - /female: Join the female queue to find a match.
    - /end: End the current chat and start a new one if you'd like.`
  );
});

// Handle male and female commands
bot.onText(/\/male/, (msg) => {
  const chatId = msg.chat.id;
  addToQueue(chatId, "male");
});

bot.onText(/\/female/, (msg) => {
  const chatId = msg.chat.id;
  addToQueue(chatId, "female");
});

// Add user to queue and match if possible
function addToQueue(chatId, gender) {
  const userQueue = gender === "male" ? maleQueue : femaleQueue;
  const oppositeQueue = gender === "male" ? femaleQueue : maleQueue;

  // Prevent duplicate entries in the queue
  if (userQueue.includes(chatId) || oppositeQueue.includes(chatId)) {
    bot.sendMessage(chatId, "You're already in the queue! Please wait.");
    return;
  }

  // Try to match with someone from the opposite queue
  if (oppositeQueue.length > 0) {
    const partnerId = oppositeQueue.shift();
    createChatPair(chatId, partnerId);
  } else {
    userQueue.push(chatId);
    bot.sendMessage(chatId, "💬 Looking for a match... Please wait a moment.");
  }
}

// Create chat pair
function createChatPair(user1, user2) {
  chatPairs[user1] = user2;
  chatPairs[user2] = user1;

  bot.sendMessage(user1, "You've been matched! Start chatting.");
  bot.sendMessage(user2, "You've been matched! Start chatting.");
}

// Forward messages between matched users
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  // Ignore command messages
  if (msg.text && msg.text.startsWith("/")) return;

  if (chatPairs[chatId]) {
    const partnerId = chatPairs[chatId];
    bot.sendMessage(partnerId, msg.text);
  } else {
    bot.sendMessage(chatId, "Type /male or /female to get matched.");
  }
});

// End conversation
bot.onText(/\/end/, (msg) => {
  const chatId = msg.chat.id;
  const partnerId = chatPairs[chatId];

  if (partnerId) {
    bot.sendMessage(
      chatId,
      "🚫 You've ended the chat. Use /male or /female to find a new chat partner anytime!"
    );
    bot.sendMessage(
      partnerId,
      "🚫 Your partner has left the chat. Use /male or /female to find a new chat partner anytime!"
    );

    // Remove users from chat pairs
    delete chatPairs[chatId];
    delete chatPairs[partnerId];
  } else {
    bot.sendMessage(
      chatId,
      "You are not currently in a chat. Type /male or /female to start a new chat."
    );
  }
});

// Cleanup disconnected users (optional)
function cleanUpQueue() {
  const activeUsers = new Set(Object.keys(chatPairs));
  [maleQueue, femaleQueue].forEach((queue) => {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!activeUsers.has(queue[i])) {
        queue.splice(i, 1);
      }
    }
  });
}

// Server listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
