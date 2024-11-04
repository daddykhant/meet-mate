require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: false });
const app = express();
app.use(express.json());

const url = process.env.WEBHOOK_URL;
const chatPairs = {};
const maleQueue = new Map();
const femaleQueue = new Map();

// Asynchronously set webhook
(async () => {
  try {
    await bot.setWebHook(`${url}/bot${token}`);
    console.log("Webhook set successfully!");
  } catch (err) {
    console.error("Error setting webhook:", err);
  }
})();

// Handle Telegram webhook requests
app.post(`/bot${token}`, async (req, res) => {
  try {
    await bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing update:", error);
    res.sendStatus(500);
  }
});

// Start message
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  sendMenu(chatId);
});

// Function to send the menu
function sendMenu(chatId) {
  const menuOptions = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Chat with male.", callback_data: "male" },
          { text: "Chat with female.", callback_data: "female" },
        ],
        [{ text: "End Chat", callback_data: "end" }],
      ],
    },
  };

  bot.sendMessage(chatId, "Welcome! Choose an option:", menuOptions);
}

// Handle button presses
bot.on("callback_query", (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const action = callbackQuery.data;

  switch (action) {
    case "male":
      addToQueue(chatId, "male");
      break;
    case "female":
      addToQueue(chatId, "female");
      break;
    case "end":
      endChat(chatId);
      break;
    default:
      sendMenu(chatId);
      break;
  }
});

// Utility function to send messages
function sendMessage(chatId, text) {
  bot
    .sendMessage(chatId, text)
    .catch((error) =>
      console.error(`Error sending message to ${chatId}:`, error)
    );
}

// Add user to queue and match if possible
function addToQueue(chatId, gender) {
  const userQueue = gender === "male" ? maleQueue : femaleQueue;
  const oppositeQueue = gender === "male" ? femaleQueue : maleQueue;

  // Prevent duplicate entries in the queue
  if (userQueue.has(chatId)) {
    return sendMessage(chatId, "You're already in the queue! Please wait.");
  }

  // Try to match with someone from the opposite queue
  if (oppositeQueue.size > 0) {
    const partnerId = [...oppositeQueue.keys()].shift();
    oppositeQueue.delete(partnerId); // Remove matched partner from the opposite queue
    createChatPair(chatId, partnerId);
  } else {
    userQueue.set(chatId, true); // Add to queue
    sendMessage(chatId, "💬 Looking for a match... Please wait a moment.");
  }
}

// Create chat pair
function createChatPair(user1, user2) {
  chatPairs[user1] = user2;
  chatPairs[user2] = user1;

  sendMessage(user1, "You've been matched! Start chatting.");
  sendMessage(user2, "You've been matched! Start chatting.");
}

// End chat function
function endChat(chatId) {
  const partnerId = chatPairs[chatId];

  if (partnerId) {
    sendMessage(
      chatId,
      "🚫 You've ended the chat. Use the menu to find a new chat partner anytime!"
    );
    sendMessage(
      partnerId,
      "🚫 Your partner has left the chat. Use the menu to find a new chat partner anytime!"
    );

    // Remove users from chat pairs
    delete chatPairs[chatId];
    delete chatPairs[partnerId];
  } else {
    sendMessage(
      chatId,
      "You are not currently in a chat. Use the menu to start a new chat."
    );
  }
}

// Forward messages between matched users
bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  // Ignore command messages
  if (msg.text && msg.text.startsWith("/")) return;

  if (chatPairs[chatId]) {
    const partnerId = chatPairs[chatId];
    sendMessage(partnerId, msg.text);
  } else {
    sendMessage(chatId, "Type /start to see the menu.");
  }
});

// Server listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
