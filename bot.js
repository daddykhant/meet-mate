require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: false });
const app = express();
app.use(express.json());

const url = process.env.WEBHOOK_URL;
const redisUrl = process.env.REDIS_REST_URL; // Upstash REST URL
const redisToken = process.env.REDIS_REST_TOKEN; // Upstash REST Token

// Helper keys for Redis sets
const MALE_QUEUE_KEY = "maleQueue";
const FEMALE_QUEUE_KEY = "femaleQueue";
const CHAT_PAIR_KEY = "chatPairs";

// Asynchronously set webhook and catch any errors
(async () => {
  try {
    await bot.setWebHook(`${url}/bot${token}`);
    console.log("Webhook set successfully!");
  } catch (err) {
    console.error("Error setting webhook:", err);
  }
})();

// Redis helper function for Upstash REST API
async function redisCommand(command, args = []) {
  try {
    const response = await axios.post(
      `${redisUrl}/${command}/${args.join("/")}`,
      {},
      {
        headers: {
          Authorization: `Bearer ${redisToken}`,
        },
      }
    );
    return response.data.result;
  } catch (error) {
    console.error("Redis API error:", error);
  }
}

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
  bot.sendMessage(
    chatId,
    `Hello! I'm here to connect you anonymously with another user.
Commands:
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
async function addToQueue(chatId, gender) {
  const userQueueKey = gender === "male" ? MALE_QUEUE_KEY : FEMALE_QUEUE_KEY;
  const oppositeQueueKey =
    gender === "male" ? FEMALE_QUEUE_KEY : MALE_QUEUE_KEY;

  // Check if user is already in a queue
  const isInQueue = await redisCommand("sismember", [userQueueKey, chatId]);
  const isInOppositeQueue = await redisCommand("sismember", [
    oppositeQueueKey,
    chatId,
  ]);

  // Prevent duplicate entries in the queue
  if (isInQueue || isInOppositeQueue) {
    bot.sendMessage(chatId, "You're already in the queue! Please wait.");
    return;
  }

  // Try to match with someone from the opposite queue
  const partnerId = await redisCommand("spop", [oppositeQueueKey]);
  if (partnerId) {
    await createChatPair(chatId, partnerId);
  } else {
    await redisCommand("sadd", [userQueueKey, chatId]);
    bot.sendMessage(chatId, "💬 Looking for a match... Please wait a moment.");
  }
}

// Create chat pair
async function createChatPair(user1, user2) {
  await redisCommand("hset", [CHAT_PAIR_KEY, user1, user2]);
  await redisCommand("hset", [CHAT_PAIR_KEY, user2, user1]);

  await Promise.all([
    bot.sendMessage(user1, "You've been matched! Start chatting."),
    bot.sendMessage(user2, "You've been matched! Start chatting."),
  ]);
}

// Forward messages between matched users
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Ignore command messages
  if (msg.text && msg.text.startsWith("/")) return;

  const partnerId = await redisCommand("hget", [CHAT_PAIR_KEY, chatId]);
  if (partnerId) {
    bot
      .sendMessage(partnerId, msg.text)
      .catch((error) =>
        console.error(`Error forwarding message to ${partnerId}:`, error)
      );
  } else {
    bot.sendMessage(chatId, "Type /male or /female to get matched.");
  }
});

// End conversation
bot.onText(/\/end/, async (msg) => {
  const chatId = msg.chat.id;
  const partnerId = await redisCommand("hget", [CHAT_PAIR_KEY, chatId]);

  if (partnerId) {
    await Promise.all([
      bot.sendMessage(
        chatId,
        "🚫 You've ended the chat. Use /male or /female to find a new chat partner anytime!"
      ),
      bot.sendMessage(
        partnerId,
        "🚫 Your partner has left the chat. Use /male or /female to find a new chat partner anytime!"
      ),
    ]);

    await redisCommand("hdel", [CHAT_PAIR_KEY, chatId, partnerId]);
  } else {
    bot.sendMessage(
      chatId,
      "You are not currently in a chat. Type /male or /female to start a new chat."
    );
  }
});

// Server listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
