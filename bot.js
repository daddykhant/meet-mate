require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const { createClient } = require("redis");

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, { polling: false });
const app = express();
app.use(express.json());

const url = process.env.WEBHOOK_URL;

// Initialize Redis client
const redisClient = createClient();
redisClient.connect().catch(console.error);

redisClient.on("connect", () => console.log("Connected to Redis"));
redisClient.on("error", (err) => console.error("Redis connection error:", err));

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

  const isInQueue = await redisClient.sIsMember(userQueueKey, chatId);
  const isInOppositeQueue = await redisClient.sIsMember(
    oppositeQueueKey,
    chatId
  );

  // Prevent duplicate entries in the queue
  if (isInQueue || isInOppositeQueue) {
    bot.sendMessage(chatId, "You're already in the queue! Please wait.");
    return;
  }

  // Try to match with someone from the opposite queue
  const partnerId = await redisClient.sPop(oppositeQueueKey);
  if (partnerId) {
    await createChatPair(chatId, partnerId);
  } else {
    await redisClient.sAdd(userQueueKey, chatId);
    bot.sendMessage(chatId, "💬 Looking for a match... Please wait a moment.");
  }
}

// Create chat pair
async function createChatPair(user1, user2) {
  await redisClient.hSet(CHAT_PAIR_KEY, user1, user2);
  await redisClient.hSet(CHAT_PAIR_KEY, user2, user1);

  // Send messages in parallel for quicker delivery
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

  const partnerId = await redisClient.hGet(CHAT_PAIR_KEY, chatId);
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
  const partnerId = await redisClient.hGet(CHAT_PAIR_KEY, chatId);

  if (partnerId) {
    // Notify both users of chat ending in parallel
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

    // Remove both users from chat pairs
    await redisClient.hDel(CHAT_PAIR_KEY, chatId, partnerId);
  } else {
    bot.sendMessage(
      chatId,
      "You are not currently in a chat. Type /male or /female to start a new chat."
    );
  }
}); // Add this closing parenthesis and semicolon

// Server listener
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
