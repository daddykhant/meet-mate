require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token);
const app = express();
app.use(express.json());
// Set webhook
const url = process.env.WEBHOOK_URL;
bot.setWebHook(`${url}/bot${token}`);

// Handle Telegram webhook requests
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});
// Simple start message
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

// Add user to respective queue and match if possible
function addToQueue(chatId, gender) {
  const userQueue = gender === "male" ? maleQueue : femaleQueue;
  const oppositeQueue = gender === "male" ? femaleQueue : maleQueue;

  // Check if there's someone waiting in the opposite queue
  if (oppositeQueue.length > 0) {
    const partnerId = oppositeQueue.shift();
    createChatPair(chatId, partnerId);
  } else {
    // Add user to their gender queue if no match is found
    userQueue.push(chatId);
    bot.sendMessage(chatId, `Waiting for an anonymous match...`);
  }
}

// Create a chat pair
function createChatPair(user1, user2) {
  chatPairs[user1] = user2;
  chatPairs[user2] = user1;

  bot.sendMessage(
    user1,
    "You've been matched with an anonymous user! Type your message to start chatting."
  );
  bot.sendMessage(
    user2,
    "You've been matched with an anonymous user! Type your message to start chatting."
  );
}

// Handle messages between matched users
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  // If user has a partner, forward the message
  if (chatPairs[chatId]) {
    const partnerId = chatPairs[chatId];
    bot.sendMessage(partnerId, msg.text);
  } else {
    bot.sendMessage(chatId, "Type /male or /female to get matched.");
  }
});

// Handle end of conversation
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

    // Remove from chatPairs
    delete chatPairs[chatId];
    delete chatPairs[partnerId];
  } else {
    bot.sendMessage(chatId, "You are not currently in a chat.");
  }
});

// Clean up disconnected users from the queue
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

console.log("Bot is running...");
module.exports = app;
