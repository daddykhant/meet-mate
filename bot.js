require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

const url = process.env.WEBHOOK_URL;
const chatPairs = {};
const maleQueue = [];
const femaleQueue = [];

// Set webhook with error handling
bot.setWebHook(`${url}/bot${token}`, {}, (err) => {
  if (err) console.error("Error setting webhook:", err);
  else console.log("Webhook set successfully!");
});

// Handle Telegram webhook requests
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Start message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Welcome! To start chatting, use /male or /female.");
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

  if (oppositeQueue.length > 0) {
    const partnerId = oppositeQueue.shift();
    createChatPair(chatId, partnerId);
  } else {
    userQueue.push(chatId);
    bot.sendMessage(chatId, "Waiting for an anonymous match...");
  }
}

// Create chat pair
function createChatPair(user1, user2) {
  chatPairs[user1] = user2;
  chatPairs[user2] = user1;

  bot.sendMessage(user1, "You've been matched! Start chatting.");
  bot.sendMessage(user2, "You've been matched! Start chatting.");
}

// Message forwarding between matched users
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  if (chatPairs[chatId]) {
    const partnerId = chatPairs[chatId];
    if (msg.text) {
      bot.sendMessage(partnerId, msg.text);
    } else {
      bot.sendMessage(chatId, "Only text messages are supported.");
    }
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
      "Chat ended. Type /male or /female to start a new chat."
    );
    bot.sendMessage(
      partnerId,
      "Your partner has left the chat. Type /male or /female to find a new partner."
    );

    delete chatPairs[chatId];
    delete chatPairs[partnerId];
  } else {
    bot.sendMessage(chatId, "You are not currently in a chat.");
  }
});

// Cleanup disconnected users
function cleanUpQueue() {
  const activeUsers = Object.keys(chatPairs);
  [maleQueue, femaleQueue].forEach((queue) => {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (!activeUsers.includes(queue[i])) {
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
