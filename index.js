// index.js
// NADEEM.AI.BOT — Messenger slash-command bot (Node 18+, ES modules)
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";

const app = express();
app.use(bodyParser.json());

/*
 Environment variables (set these before run):
 - PAGE_ACCESS_TOKEN
 - VERIFY_TOKEN
 - ADMIN_UID  (61552637532706)
 - OWNER_NAME (NADEEM)
 - ERROR_REPORT_URL (https://www.facebook.com/share/1HcXedhhfb/)
 - OPENAI_KEY (optional for /ai)
*/

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "verify_token_here";
const ADMIN_UID = process.env.ADMIN_UID || "61552637532706";
const OWNER_NAME = process.env.OWNER_NAME || "NADEEM";
const ERROR_REPORT_URL = process.env.ERROR_REPORT_URL || "https://www.facebook.com/share/1HcXedhhfb/";
const OPENAI_KEY = process.env.OPENAI_KEY || "";

if (!PAGE_ACCESS_TOKEN) {
  console.error("ERROR: PAGE_ACCESS_TOKEN missing in env.");
  process.exit(1);
}

// Simple file DB (for demo). Use real DB for production.
const DB_FILE = path.join(process.cwd(), "bot_db.json");
let DB = { members: {}, threads: {}, subscribers: {} };
try {
  if (fs.existsSync(DB_FILE)) DB = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
} catch (e) {
  console.error("DB load err", e);
}
function saveDB(){ fs.writeFileSync(DB_FILE, JSON.stringify(DB, null,2)); }

// Webhook verify (Facebook)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified.");
    res.status(200).send(challenge);
  } else res.status(403).send("Forbidden");
});

// Webhook receiver
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    if (body.object === "page") {
      for (const entry of body.entry) {
        if (!entry.messaging) continue;
        for (const ev of entry.messaging) {
          // event from user
          const senderId = ev.sender?.id;
          // ignore page echo or unknown
          if (!senderId) continue;

          // Handle messages
          if (ev.message && !ev.message.is_echo) {
            const text = (ev.message.text || "").trim();
            // register member if new
            if (!DB.members[senderId]) {
              DB.members[senderId] = { id: senderId, firstSeen: new Date().toISOString() };
              saveDB();
              // send welcome to the user/thread
              await sendText(senderId, `👋 Welcome! আপনি এখন NADEEM.AI.BOT-এ প্রথমবার ঢুকেছেন.`);
              const idx = Object.keys(DB.members).length;
              await sendText(senderId, `🎉 আপনি এখন আমাদের সিস্টেমের ${idx} নম্বর ব্যবহারকারী!`);
            }

            // Slash-only behavior: ignore messages that don't start with '/'
            if (!text.startsWith("/")) {
              // silently ignore (no reply), as requested
              continue;
            }

            // parse command
            const parts = text.split(" ");
            const cmd = parts[0].slice(1).toLowerCase();
            const args = parts.slice(1).join(" ").trim();

            await handleCommand(cmd, args, senderId);
          }

          // TODO: handle other event types (postback, joins) if needed
        }
      }
      res.status(200).send("EVENT_RECEIVED");
    } else {
      res.status(404).send("Not a page event");
    }
  } catch (err) {
    console.error("Webhook error:", err);
    // alert admin
    try { await sendText(ADMIN_UID, `⚠️ Bot error: ${err.message}\nReport: ${ERROR_REPORT_URL}`); } catch(e){}
    res.status(500).send("Server error");
  }
});

// sendText helper
async function sendText(id, text) {
  const body = { recipient: { id }, message: { text } };
  const url = `https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
  try {
    const r = await fetch(url, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.error) console.error("FB send error", j.error);
    return j;
  } catch (e) {
    console.error("Send fetch err", e);
  }
}

// command handler
async function handleCommand(cmd, args, threadId) {
  try {
    switch (cmd) {
      case "hi":
      case "hello":
        await sendText(threadId, `Hi! 👋 আমি NADEEM.AI.BOT — কিভাবে সাহায্য করতে পারি?`);
        break;
      case "time":
        await sendText(threadId, `🕒 এখন সময়: ${new Date().toLocaleString()}`);
        break;
      case "date":
        await sendText(threadId, `📅 আজ: ${new Date().toDateString()}`);
        break;
      case "owner":
        await sendText(threadId, `👤 Owner: ${OWNER_NAME} (Admin UID: ${ADMIN_UID})`);
        break;
      case "help":
        await sendText(threadId, helpText());
        break;
      case "joke":
        await sendText(threadId, `😄 জোক: আমি বট তাই আমাকে কফি দিয়ে জাগাতে হয় না — শুধু 0/1 গার্লফ্রেন্ড লাগবে 😂`);
        break;
      case "emoji":
        await sendText(threadId, "😀 😍 😂 🤖 👍 🎉 🙏");
        break;
      case "members":
        await sendText(threadId, `👥 মোট রেজিস্টার্ড: ${Object.keys(DB.members).length}`);
        break;
      case "subscribe":
        DB.subscribers[threadId] = true; saveDB();
        await sendText(threadId, `✅ সাবস্ক্রাইব সম্পন্ন। প্রতি ১ ঘণ্টায় টাইম পাবেন।`);
        break;
      case "unsubscribe":
        delete DB.subscribers[threadId]; saveDB();
        await sendText(threadId, `❌ সাবস্ক্রাইব বাতিল হয়েছে।`);
        break;
      case "ai":
        if (!args) {
          await sendText(threadId, "ব্যবহার: `/ai আপনার প্রশ্ন`");
        } else {
          if (!OPENAI_KEY) {
            await sendText(threadId, "⚠️ AI সক্রিয় করা হয়নি — admin OpenAI key সেট করুন।");
          } else {
            const ans = await askOpenAI(args);
            await sendText(threadId, `🤖 AI উত্তর:\n${ans}`);
          }
        }
        break;
      default:
        await sendText(threadId, `❓ অজানা কমান্ড: /${cmd}\n/help লিখে সব কমান্ড দেখুন।`);
    }
  } catch (e) {
    console.error("handleCommand err", e);
    await sendText(ADMIN_UID, `⚠️ Command handler error: ${e.message}\n${ERROR_REPORT_URL}`);
  }
}

function helpText(){
  return `📚 NADEEM.AI.BOT — কমান্ডগুলো:
/hi — হ্যালো বলবে
/time — এখন সময় বলে
/date — আজকের তারিখ
/owner — বট মালিকের নাম
/help — এই লিস্ট
/joke — মজার জোক
/emoji — ইমোজি দেখাবে
/members — মোট ইউজার দেখাবে
/subscribe — প্রতি ১ ঘন্টায় টাইম পেতে সাবস্ক্রাইব
/unsubscribe — সাবস্ক্রাইব কেটে দাও
/ai [প্রশ্ন] — AI উত্তর (OpenAI key থাকলে)`;
}

// OpenAI helper (chat completion)
async function askOpenAI(prompt){
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type":"application/json", "Authorization": `Bearer ${OPENAI_KEY}`},
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{role:"user", content: prompt}], max_tokens: 400})
    });
    const j = await res.json();
    return j?.choices?.[0]?.message?.content?.trim() || "AI থেকে উত্তর পেতে সমস্যা হয়েছে।";
  } catch (e) {
    console.error("OpenAI err", e);
    return "AI সার্ভারে সমস্যা হয়েছে।";
  }
}

// Hourly broadcaster: send time to subscribers every hour
setInterval(async () => {
  try {
    const now = new Date();
    const msg = `🕒 এখন সময়: ${now.toLocaleString()}`;
    const subs = Object.keys(DB.subscribers || {});
    for (const tid of subs) {
      await sendText(tid, msg);
    }
  } catch (e) {
    console.error("Hourly broadcast error", e);
    try { await sendText(ADMIN_UID, `⚠️ Hourly broadcast error: ${e.message}`); } catch {}
  }
}, 1000 * 60 * 60); // 1 hour

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NADEEM.AI.BOT running on port ${PORT}`));
