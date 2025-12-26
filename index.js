require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

// ========================== CONFIG ==========================
const token = process.env.TELEGRAM_TOKEN;
const url = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;
const ADMIN_ID = 1625397184;

if (!token || !url) {
    console.error("TELEGRAM_TOKEN or WEBHOOK_URL not found in .env");
    process.exit(1);
}

// ========================== INIT BOT & SERVER ==========================
const bot = new TelegramBot(token, { polling: false });
const app = express();
app.use(express.json());

// ========================== IN-MEMORY STORAGE ==========================
const chatPairs = {}; // chatId => partnerId
const maleQueue = new Map();
const femaleQueue = new Map();
const bannedUsers = new Map(); // chatId => { reason, bannedAt }
const badWords = ["badword1", "badword2", "badword3"]; // add your bad words here

// ========================== WEBHOOK SETUP ==========================
(async() => {
    try {
        await bot.setWebHook(`${url}/bot${token}`);
        console.log("Webhook set successfully!");
    } catch (err) {
        console.error("Error setting webhook:", err);
        process.exit(1);
    }
})();

app.post(`/bot${token}`, async(req, res) => {
    try {
        await bot.processUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error("Error processing update:", error);
        res.sendStatus(500);
    }
});

// ========================== UTIL FUNCTIONS ==========================
function sendMessage(chatId, text) {
    bot.sendMessage(chatId, text).catch((err) => console.error(`Error sending to ${chatId}:`, err));
}

function isBanned(chatId) {
    return bannedUsers.has(chatId);
}

function containsBadWords(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return badWords.some((word) => lower.includes(word));
}

// ========================== MENU ==========================
function sendMenu(chatId) {
    const menuOptions = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "Chat with male", callback_data: "male" },
                    { text: "Chat with female", callback_data: "female" },
                ],
                [{ text: "End Chat", callback_data: "end" }],
            ],
        },
    };
    bot.sendMessage(chatId, "Welcome! Choose an option:", menuOptions);
}


// ========================== QUEUE & CHAT LOGIC ==========================
function addToQueue(chatId, gender) {
    if (isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned from this bot.");

    const userQueue = gender === "male" ? maleQueue : femaleQueue;
    const oppositeQueue = gender === "male" ? femaleQueue : maleQueue;

    if (userQueue.has(chatId) || chatPairs[chatId]) {
        return sendMessage(chatId, "You're already in a chat or queue. Please wait.");
    }

    if (oppositeQueue.size > 0) {
        const partnerId = [...oppositeQueue.keys()][0];
        oppositeQueue.delete(partnerId);
        createChatPair(chatId, partnerId);
    } else {
        userQueue.set(chatId, true);
        sendMessage(chatId, "💬 Looking for a match... Please wait.");
    }
}

function createChatPair(user1, user2) {
    chatPairs[user1] = user2;
    chatPairs[user2] = user1;

    sendMessage(user1, "🎉 You've been matched! Start chatting.");
    sendMessage(user2, "🎉 You've been matched! Start chatting.");
}

function endChat(chatId) {
    const partnerId = chatPairs[chatId];

    if (partnerId) {
        sendMessage(chatId, "🚫 You've ended the chat.");
        sendMessage(partnerId, "🚫 Your partner has left the chat.");
        delete chatPairs[chatId];
        delete chatPairs[partnerId];
    } else {
        maleQueue.delete(chatId);
        femaleQueue.delete(chatId);
        sendMessage(chatId, "You are not currently in a chat. Use the menu to start a new chat.");
    }
}

// ========================== CALLBACK HANDLER ==========================
bot.on("callback_query", (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;

    if (isBanned(chatId)) {
        bot.answerCallbackQuery(query.id, { text: "🚫 You are banned.", show_alert: true });
        return;
    }

    switch (action) {
        case "male":
        case "female":
            addToQueue(chatId, action);
            break;
        case "end":
            endChat(chatId);
            break;
        case "stats":
            if (chatId !== ADMIN_ID) return;
            const maleCount = maleQueue.size;
            const femaleCount = femaleQueue.size;
            const activeChats = Object.keys(chatPairs).length / 2;
            sendMessage(ADMIN_ID, `📊 Stats:\nActive chats: ${activeChats}\nMale queue: ${maleCount}\nFemale queue: ${femaleCount}\nTotal users: ${maleCount + femaleCount + activeChats*2}`);
            break;
        default:
            sendMenu(chatId);
    }
    bot.answerCallbackQuery(query.id);
});

// ========================== MESSAGE FORWARDING ==========================
bot.on("message", (msg) => {
    const chatId = msg.chat.id;

    if (msg.text && msg.text.startsWith("/")) return; // skip commands

    if (isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned from this bot.");
    if (containsBadWords(msg.text)) return sendMessage(chatId, "⚠️ Your message contains inappropriate words and was blocked.");

    if (chatPairs[chatId]) {
        sendMessage(chatPairs[chatId], msg.text);
    } else {
        sendMessage(chatId, "Type /start to see the menu.");
    }
});

// ========================== START COMMAND ==========================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned from this bot.");
    sendMenu(chatId);
});

// ========================== ADMIN COMMANDS ==========================
bot.onText(/\/ban (\d+) ?(.*)?/, (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;

    const userId = Number(match[1]);
    const reason = match[2] || "No reason provided";

    bannedUsers.set(userId, { reason, bannedAt: new Date() });
    endChat(userId);
    maleQueue.delete(userId);
    femaleQueue.delete(userId);

    sendMessage(userId, `🚫 You have been banned.\nReason: ${reason}`);
    sendMessage(ADMIN_ID, `✅ User ${userId} banned. Reason: ${reason}`);
});

bot.onText(/\/unban (\d+)/, (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;

    const userId = Number(match[1]);
    bannedUsers.delete(userId);
    sendMessage(ADMIN_ID, `✅ User ${userId} unbanned.`);
});

bot.onText(/\/monitor/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    if (Object.keys(chatPairs).length === 0) return sendMessage(ADMIN_ID, "No active chats.");

    let report = "📊 Active Chats:\n";
    const seen = new Set();
    for (const [user1, user2] of Object.entries(chatPairs)) {
        if (seen.has(user1)) continue;
        report += `• ${user1} ↔ ${user2}\n`;
        seen.add(user1);
        seen.add(user2);
    }
    sendMessage(ADMIN_ID, report);
});

bot.onText(/\/users/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    sendMessage(ADMIN_ID, `👥 Queues:\nMale: ${[...maleQueue.keys()].join(", ") || "None"}\nFemale: ${[...femaleQueue.keys()].join(", ") || "None"}`);
});

// ========================== START SERVER ==========================
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));