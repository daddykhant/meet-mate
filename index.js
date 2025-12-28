require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

// ========================== CONFIG ==========================
const TOKEN = process.env.TELEGRAM_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;
const ADMIN_ID = 1625397184;

if (!TOKEN || !WEBHOOK_URL) {
    console.error("❌ Missing TELEGRAM_TOKEN or WEBHOOK_URL");
    process.exit(1);
}

// ========================== INIT ==========================
const bot = new TelegramBot(TOKEN, { polling: false });
const app = express();
app.use(express.json());

// ========================== STORAGE (IN MEMORY) ==========================
const chatPairs = {}; // chatId -> partnerId
const maleQueue = new Map();
const femaleQueue = new Map();
const bannedUsers = new Map(); // chatId -> { reason, date }
const searchTimeouts = new Map(); // chatId -> timeoutId
const users = new Map(); // chatId -> { username, firstName }

const badWords = ["badword1", "badword2", "badword3"];

// ========================== WEBHOOK ==========================
app.post(`/bot${TOKEN}`, async(req, res) => {
    try {
        await bot.processUpdate(req.body);
        res.sendStatus(200);
    } catch (err) {
        console.error("Update error:", err);
        res.sendStatus(500);
    }
});

// ========================== UTIL ==========================
function sendMessage(chatId, text, options = {}) {
    bot.sendMessage(chatId, text, options).catch(() => {});
}

function isBanned(chatId) {
    return bannedUsers.has(chatId);
}

function containsBadWords(text = "") {
    const lower = text.toLowerCase();
    return badWords.some(w => lower.includes(w));
}

function removeFromQueue(chatId) {
    maleQueue.delete(chatId);
    femaleQueue.delete(chatId);

    if (searchTimeouts.has(chatId)) {
        clearTimeout(searchTimeouts.get(chatId));
        searchTimeouts.delete(chatId);
    }
}

// ========================== MENU ==========================
function sendMenu(chatId) {
    sendMessage(chatId, "👋 Choose an option:", {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "👨 Chat with Male", callback_data: "male" },
                    { text: "👩 Chat with Female", callback_data: "female" }
                ],
                [{ text: "❌ End Chat", callback_data: "end" }]
            ]
        }
    });
}

// ========================== MATCHING ==========================
function addToQueue(chatId, gender) {
    if (isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned.");
    if (chatPairs[chatId]) return sendMessage(chatId, "⚠️ Already in chat.");

    removeFromQueue(chatId);

    const myQueue = gender === "male" ? maleQueue : femaleQueue;
    const otherQueue = gender === "male" ? femaleQueue : maleQueue;

    if (otherQueue.size > 0) {
        const partnerId = otherQueue.keys().next().value;
        otherQueue.delete(partnerId);
        createChat(chatId, partnerId);
    } else {
        myQueue.set(chatId, true);

        sendMessage(chatId, "🔎 Looking for a match...", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "❌ Stop Searching", callback_data: "cancel_search" }]
                ]
            }
        });

        // ⏱ AUTO TIMEOUT (60s)
        const timeoutId = setTimeout(() => {
            if (myQueue.has(chatId)) {
                removeFromQueue(chatId);
                sendMessage(chatId, "⏱ No match found. Search stopped.");
                sendMenu(chatId);
            }
        }, 60 * 1000);

        searchTimeouts.set(chatId, timeoutId);
    }
}

function createChat(a, b) {
    removeFromQueue(a);
    removeFromQueue(b);

    chatPairs[a] = b;
    chatPairs[b] = a;

    sendMessage(a, "🎉 Matched! Say hi!");
    sendMessage(b, "🎉 Matched! Say hi!");
}

function endChat(chatId) {
    const partner = chatPairs[chatId];
    removeFromQueue(chatId);

    if (partner) {
        removeFromQueue(partner);
        sendMessage(chatId, "❌ Chat ended.");
        sendMessage(partner, "❌ Your partner left.");
        delete chatPairs[chatId];
        delete chatPairs[partner];
        sendMessage(chatId, `👋 Welcome ${msg.from.first_name || ""}!`);
    } else {
        sendMessage(chatId, "ℹ️ No active chat.");
    }
}

// ========================== CALLBACK HANDLER ==========================
bot.on("callback_query", async(q) => {
    const chatId = q.message.chat.id;
    const action = q.data;

    await bot.answerCallbackQuery(q.id);

    if (isBanned(chatId)) return;

    if (action === "male" || action === "female") {
        addToQueue(chatId, action);
    } else if (action === "end") {
        endChat(chatId);
    } else if (action === "cancel_search") {
        removeFromQueue(chatId);
        sendMessage(chatId, "❌ Searching canceled.");
        sendMenu(chatId);
    }
});

// ========================== MESSAGE HANDLER ==========================
bot.on("message", (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text || text.startsWith("/")) return;

    if (isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned.");
    if (containsBadWords(text)) return sendMessage(chatId, "⚠️ Bad words are not allowed.");

    const partner = chatPairs[chatId];
    if (partner) {
        sendMessage(partner, text);
    } else {
        sendMessage(chatId, "Use the menu 👇");
    }
});

// ========================== START ==========================
bot.onText(/\/start/, async(msg) => {
    const chatId = msg.chat.id;

    users.set(chatId, {
        username: msg.from.username || "no_username",
        firstName: msg.from.first_name || "Unknown"
    });

    if (isBanned(chatId)) return sendMessage(chatId, "🚫 You are banned.");

    sendMessage(chatId, `👋 Welcome ${msg.from.first_name || ""}!`);
    sendMenu(chatId);
});

// ========================== ADMIN ==========================
bot.onText(/\/ban (\d+) ?(.*)?/, (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;

    const userId = Number(match[1]);
    const reason = match[2] || "No reason";

    bannedUsers.set(userId, { reason, date: new Date() });
    endChat(userId);

    sendMessage(userId, `🚫 You are banned.\nReason: ${reason}`);
    sendMessage(ADMIN_ID, `✅ User ${userId} banned.`);
});

bot.onText(/\/unban (\d+)/, (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;

    bannedUsers.delete(Number(match[1]));
    sendMessage(ADMIN_ID, "✅ User unbanned.");
});

bot.onText(/\/monitor/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    if (Object.keys(chatPairs).length === 0) {
        return sendMessage(ADMIN_ID, "No active chats.");
    }

    let report = "📊 Active Chats:\n";
    const seen = new Set();

    for (const a in chatPairs) {
        if (seen.has(a)) continue;
        const b = chatPairs[a];
        const ua = users.get(Number(a));
        const ub = users.get(Number(b));

        report += `• ${a} (@${ua?.username}) ↔ ${b} (@${ub?.username})\n`;
        seen.add(a);
        seen.add(b);
    }

    sendMessage(ADMIN_ID, report);
});

// ========================== START SERVER ==========================
app.listen(PORT, async() => {
    console.log(`🚀 Server running on port ${PORT}`);
    await bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
});