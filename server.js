const TelegramBot = require("node-telegram-bot-api");
const { Pool } = require("pg");

// ================= SETTINGS =================

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const PAYMENT_DETAILS = process.env.PAYMENT_DETAILS || "Rekvizitlar admin tomonidan beriladi.";
const SUPPORT = process.env.SUPPORT_USERNAME || "admin";

if (!TOKEN || !ADMIN_ID || !process.env.DATABASE_URL) {
  throw new Error("BOT_TOKEN, ADMIN_ID va DATABASE_URL kerak!");
}

const bot = new TelegramBot(TOKEN, { polling: false });

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

const sessions = new Map();

const money = n =>
  Number(n).toLocaleString("ru-RU") + " UZS";

const isAdmin = id =>
  String(id) === String(ADMIN_ID);

// ================= PRODUCTS =================

const products = [
  { id: 1, category: "Free Fire", name: "110 Diamonds", price: 12000 },
  { id: 2, category: "Free Fire", name: "341 Diamonds", price: 33000 },
  { id: 3, category: "Free Fire", name: "572 Diamonds", price: 54000 },
  { id: 4, category: "Free Fire", name: "1,166 Diamonds", price: 107500 },
  { id: 5, category: "Free Fire", name: "2,398 Diamonds", price: 214500 },
  { id: 6, category: "Free Fire", name: "6,160 Diamonds", price: 543500 },

  { id: 7, category: "Telegram Stars", name: "50 Stars", price: 11500 },
  { id: 8, category: "Telegram Stars", name: "100 Stars", price: 22000 },
  { id: 9, category: "Telegram Stars", name: "200 Stars", price: 43000 },
  { id: 10, category: "Telegram Stars", name: "250 Stars", price: 53500 },
  { id: 11, category: "Telegram Stars", name: "500 Stars", price: 106500 },
  { id: 12, category: "Telegram Stars", name: "750 Stars", price: 160000 },
  { id: 13, category: "Telegram Stars", name: "1,000 Stars", price: 213000 },
  { id: 14, category: "Telegram Stars", name: "1,500 Stars", price: 319000 },
  { id: 15, category: "Telegram Stars", name: "2,000 Stars", price: 425500 },
  { id: 16, category: "Telegram Stars", name: "3,000 Stars", price: 638500 },
  { id: 17, category: "Telegram Stars", name: "5,000 Stars", price: 1063500 },

  { id: 18, category: "Telegram Premium", name: "3 Months", price: 170500 },
  { id: 19, category: "Telegram Premium", name: "6 Months", price: 227000 },
  { id: 20, category: "Telegram Premium", name: "12 Months", price: 411500 },

  { id: 21, category: "Vouchers", name: "Weekly Lite", price: 6500 },
  { id: 22, category: "Vouchers", name: "Weekly", price: 18500 },
  { id: 23, category: "Vouchers", name: "Monthly", price: 77500 },
  { id: 24, category: "Vouchers", name: "Level Up 6", price: 6000 },
  { id: 25, category: "Vouchers", name: "Level Up 10", price: 11000 },
  { id: 26, category: "Vouchers", name: "Level Up 15", price: 11000 },
  { id: 27, category: "Vouchers", name: "Level Up 20", price: 11000 },
  { id: 28, category: "Vouchers", name: "Level Up 25", price: 11000 },
  { id: 29, category: "Vouchers", name: "Level Up 30", price: 13000 }
];

// ================= DATABASE =================

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      balance BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS topups (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      amount BIGINT NOT NULL,
      proof TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      amount BIGINT NOT NULL,
      target TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("PostgreSQL connected");
}

async function registerUser(user) {
  await db.query(`
    INSERT INTO users (telegram_id, username, first_name)
    VALUES ($1, $2, $3)
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name
  `, [
    String(user.id),
    user.username || null,
    user.first_name || null
  ]);
}

async function getBalance(id) {
  const result = await db.query(
    "SELECT balance FROM users WHERE telegram_id = $1",
    [String(id)]
  );

  return Number(result.rows[0]?.balance || 0);
}

async function notifyAdmin(message, options = {}) {
  try {
    await bot.sendMessage(ADMIN_ID, message, options);
  } catch (error) {
    console.error("Admin notification:", error.message);
  }
}

// ================= KEYBOARD =================

function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        ["🛍 Katalog", "👤 Kabinet"],
        ["💳 Hisobni to'ldirish", "📦 Buyurtmalarim"],
        ["ℹ️ Yordam"]
      ],
      resize_keyboard: true
    }
  };
}

// ================= START =================

bot.onText(/^\/start$/, async msg => {
  try {
    await registerUser(msg.from);
    sessions.delete(msg.from.id);

    await bot.sendMessage(
      msg.chat.id,
      `👋 Assalomu alaykum, ${msg.from.first_name}!

DONATOV UZ xizmatiga xush kelibsiz!

🎮 Free Fire
⭐ Telegram Stars
💎 Telegram Premium
🎟 Voucherlar

Xarid qilish uchun hisobingizni to'ldiring.`,
      mainKeyboard()
    );
  } catch (error) {
    console.error(error);
    await bot.sendMessage(msg.chat.id, "Xatolik yuz berdi.");
  }
});

// ================= CATALOG =================

async function showCatalog(chatId) {
  const categories = [...new Set(products.map(p => p.category))];

  const keyboard = categories.map(category => [{
    text: category,
    callback_data: "cat_" + products.find(p => p.category === category).id
  }]);

  await bot.sendMessage(chatId, "🛍 Katalogni tanlang:", {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function showCategory(chatId, productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const list = products.filter(p => p.category === product.category);

  const keyboard = list.map(p => [{
    text: `${p.name} — ${money(p.price)}`,
    callback_data: "buy_" + p.id
  }]);

  await bot.sendMessage(chatId, `📦 ${product.category}\nMahsulotni tanlang:`, {
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ================= CALLBACKS =================

bot.on("callback_query", async query => {
  const userId = query.from.id;
  const chatId = query.message?.chat?.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id).catch(() => {});

  if (!chatId || !data) return;

  try {
    if (data.startsWith("cat_")) {
      return showCategory(chatId, Number(data.split("_")[1]));
    }

    if (data.startsWith("buy_")) {
      const id = Number(data.split("_")[1]);
      const product = products.find(p => p.id === id);

      if (!product) return;

      sessions.set(userId, {
        type: "target",
        productId: id
      });

      return bot.sendMessage(chatId,
        `🛒 ${product.name}
💰 Narxi: ${money(product.price)}

Free Fire ID yoki Telegram username yuboring.

Bekor qilish: /cancel`
      );
    }

    if (data.startsWith("topup_ok_")) {
      if (!isAdmin(userId)) return;
      return approveTopup(Number(data.split("_")[2]), chatId);
    }

    if (data.startsWith("topup_no_")) {
      if (!isAdmin(userId)) return;
      return rejectTopup(Number(data.split("_")[2]), chatId);
    }

    if (data.startsWith("order_done_")) {
      if (!isAdmin(userId)) return;
      return completeOrder(Number(data.split("_")[2]), chatId);
    }

    if (data.startsWith("order_refund_")) {
      if (!isAdmin(userId)) return;
      return refundOrder(Number(data.split("_")[2]), chatId);
    }

  } catch (error) {
    console.error("Callback error:", error);
    await bot.sendMessage(chatId, "Xatolik yuz berdi.");
  }
});

// ================= MESSAGE HANDLER =================

bot.on("message", async msg => {
  if (msg.text?.startsWith("/")) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || "").trim();

  try {
    await registerUser(msg.from);

    if (text === "🛍 Katalog") {
      return showCatalog(chatId);
    }

    if (text === "👤 Kabinet") {
      const balance = await getBalance(userId);

      return bot.sendMessage(chatId,
        `👤 Shaxsiy kabinet

🆔 ID: ${userId}
💰 Balans: ${money(balance)}`,
        mainKeyboard()
      );
    }

    if (text === "💳 Hisobni to'ldirish") {
      sessions.set(userId, { type: "topup_amount" });

      return bot.sendMessage(chatId,
        `💳 Hisobni to'ldirish

Summani UZS da yuboring.
Minimal summa: 1 000 UZS.

Bekor qilish: /cancel`
      );
    }

    if (text === "📦 Buyurtmalarim") {
      const result = await db.query(`
        SELECT id, product_name, amount, status
        FROM orders
        WHERE telegram_id = $1
        ORDER BY id DESC
        LIMIT 10
      `, [String(userId)]);

      if (!result.rows.length) {
        return bot.sendMessage(chatId, "Hali buyurtmalaringiz yo'q.");
      }

      const lines = result.rows.map(o =>
        `#${o.id} — ${o.product_name}\n${money(o.amount)} | ${o.status}`
      );

      return bot.sendMessage(chatId,
        "📦 Buyurtmalar:\n\n" + lines.join("\n\n")
      );
    }

    if (text === "ℹ️ Yordam") {
      return bot.sendMessage(chatId, `Yordam: @${SUPPORT}`);
    }

    const session = sessions.get(userId);
    if (!session) return;

    // TOPUP AMOUNT
    if (session.type === "topup_amount") {
      const amount = Number(text.replace(/[^\d]/g, ""));

      if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 10000000) {
        return bot.sendMessage(chatId, "Summani 1 000 dan 10 000 000 UZS gacha kiriting.");
      }

      sessions.set(userId, {
        type: "topup_proof",
        amount
      });

      return bot.sendMessage(chatId,
        `💳 Summa: ${money(amount)}

To'lov rekvizitlari:
${PAYMENT_DETAILS}

To'lovdan keyin chek rasmini yuboring.

Admin tasdiqlamaguncha balansingiz o'zgarmaydi.`
      );
    }

    // PRODUCT PURCHASE
    if (session.type === "target") {
      if (text.length < 3 || text.length > 100) {
        return bot.sendMessage(chatId, "Ma'lumot noto'g'ri. Qaytadan yuboring.");
      }

      const product = products.find(p => p.id === session.productId);
      if (!product) {
        sessions.delete(userId);
        return bot.sendMessage(chatId, "Mahsulot topilmadi.");
      }

      const client = await db.connect();

      try {
        await client.query("BEGIN");

        const user = await client.query(
          "SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE",
          [String(userId)]
        );

        const balance = Number(user.rows[0]?.balance || 0);

        if (balance < product.price) {
          await client.query("ROLLBACK");
          sessions.delete(userId);

          return bot.sendMessage(chatId,
            `❌ Mablag' yetarli emas.

Mahsulot: ${money(product.price)}
Balans: ${money(balance)}
Yetishmaydi: ${money(product.price - balance)}

Hisobingizni to'ldiring.`
          );
        }

        await client.query(
          "UPDATE users SET balance = balance - $1 WHERE telegram_id = $2",
          [product.price, String(userId)]
        );

        const order = await client.query(`
          INSERT INTO orders
          (telegram_id, product_id, product_name, amount, target)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `, [
          String(userId),
          product.id,
          product.name,
          product.price,
          text
        ]);

        await client.query("COMMIT");

        sessions.delete(userId);

        const orderId = order.rows[0].id;

        await bot.sendMessage(chatId,
          `✅ Buyurtma qabul qilindi!

🧾 #${orderId}
📦 ${product.name}
💰 ${money(product.price)}
📝 ${text}

Admin buyurtmani tekshiradi.`
        );

        await notifyAdmin(
          `🛒 YANGI BUYURTMA #${orderId}

👤 User: ${userId}
📦 ${product.name}
💰 ${money(product.price)}
📝 ${text}`,
          {
            reply_markup: {
              inline_keyboard: [[
                { text: "✅ Bajarildi", callback_data: `order_done_${orderId}` },
                { text: "↩️ Qaytarish", callback_data: `order_refund_${orderId}` }
              ]]
            }
          }
        );

      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      return;
    }

    // TOPUP PROOF
    if (session.type === "topup_proof") {
      const photo = msg.photo?.[msg.photo.length - 1]?.file_id;

      if (!photo && !text) {
        return bot.sendMessage(chatId, "Chek rasmini yoki to'lov ma'lumotini yuboring.");
      }

      const result = await db.query(`
        INSERT INTO topups (telegram_id, amount, proof)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [
        String(userId),
        session.amount,
        photo || text
      ]);

      const topupId = result.rows[0].id;
      sessions.delete(userId);

      await bot.sendMessage(chatId,
        `✅ To'lov so'rovi yuborildi!

So'rov: #${topupId}
Summa: ${money(session.amount)}

Admin tekshiruvini kuting.`
      );

      await notifyAdmin(
        `💳 YANGI TO'LOV #${topupId}

👤 User: ${userId}
💰 Summa: ${money(session.amount)}`,
        {
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Tasdiqlash", callback_data: `topup_ok_${topupId}` },
              { text: "❌ Rad etish", callback_data: `topup_no_${topupId}` }
            ]]
          }
        }
      );

      if (photo) {
        await bot.sendPhoto(ADMIN_ID, photo, {
          caption: `Chek #${topupId}, user ${userId}`
        });
      } else {
        await bot.sendMessage(ADMIN_ID, `To'lov ma'lumoti: ${text}`);
      }

      return;
    }

  } catch (error) {
    console.error("Message error:", error);
    await bot.sendMessage(chatId, "Xatolik yuz berdi. Keyinroq urinib ko'ring.");
  }
});

// ================= TOPUP APPROVAL =================

async function approveTopup(id, adminChatId) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM topups WHERE id = $1 FOR UPDATE",
      [id]
    );

    const topup = result.rows[0];

    if (!topup || topup.status !== "pending") {
      await client.query("ROLLBACK");
      return bot.sendMessage(adminChatId, "So'rov topilmadi yoki allaqachon ko'rib chiqilgan.");
    }

    await client.query(
      "UPDATE users SET balance = balance + $1 WHERE telegram_id = $2",
      [topup.amount, topup.telegram_id]
    );

    await client.query(
      "UPDATE topups SET status = 'approved' WHERE id = $1",
      [id]
    );

    await client.query("COMMIT");

    await bot.sendMessage(topup.telegram_id,
      `✅ To'lov tasdiqlandi!\nHisobingizga ${money(topup.amount)} qo'shildi.`
    );

    await bot.sendMessage(adminChatId, `To'lov #${id} tasdiqlandi.`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    await bot.sendMessage(adminChatId, "Tasdiqlashda xatolik.");
  } finally {
    client.release();
  }
}

// ================= TOPUP REJECTION =================

async function rejectTopup(id, adminChatId) {
  const result = await db.query(`
    UPDATE topups
    SET status = 'rejected'
    WHERE id = $1 AND status = 'pending'
    RETURNING telegram_id
  `, [id]);

  if (!result.rowCount) {
    return bot.sendMessage(adminChatId, "So'rov topilmadi yoki allaqachon ko'rib chiqilgan.");
  }

  await bot.sendMessage(result.rows[0].telegram_id,
    `❌ To'lov #${id} rad etildi.`
  );

  await bot.sendMessage(adminChatId, `To'lov #${id} rad etildi.`);
}

// ================= ORDER COMPLETION =================

async function completeOrder(id, adminChatId) {
  const result = await db.query(`
    UPDATE orders
    SET status = 'completed'
    WHERE id = $1 AND status = 'pending'
    RETURNING telegram_id
  `, [id]);

  if (!result.rowCount) {
    return bot.sendMessage(adminChatId, "Buyurtma topilmadi yoki allaqachon ko'rib chiqilgan.");
  }

  await bot.sendMessage(result.rows[0].telegram_id,
    `✅ Buyurtma #${id} bajarildi!`
  );

  await bot.sendMessage(adminChatId, `Buyurtma #${id} bajarildi.`);
}

// ================= ORDER REFUND =================

async function refundOrder(id, adminChatId) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
      [id]
    );

    const order = result.rows[0];

    if (!order || order.status !== "pending") {
      await client.query("ROLLBACK");
      return bot.sendMessage(adminChatId, "Buyurtma topilmadi yoki allaqachon ko'rib chiqilgan.");
    }

    await client.query(
      "UPDATE users SET balance = balance + $1 WHERE telegram_id = $2",
      [order.amount, order.telegram_id]
    );

    await client.query(
      "UPDATE orders SET status = 'refunded' WHERE id = $1",
      [id]
    );

    await client.query("COMMIT");

    await bot.sendMessage(order.telegram_id,
      `↩️ Buyurtma #${id} bekor qilindi.\n${money(order.amount)} balansingizga qaytarildi.`
    );

    await bot.sendMessage(adminChatId, `Pul buyurtma #${id} uchun qaytarildi.`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    await bot.sendMessage(adminChatId, "Qaytarishda xatolik.");
  } finally {
    client.release();
  }
}

// ================= ADMIN =================

bot.onText(/^\/admin$/, async msg => {
  if (!isAdmin(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "⛔ Ruxsat yo'q.");
  }

  try {
    const users = await db.query("SELECT COUNT(*) FROM users");
    const topups = await db.query(
      "SELECT COUNT(*) FROM topups WHERE status = 'pending'"
    );
    const orders = await db.query(
      "SELECT COUNT(*) FROM orders WHERE status = 'pending'"
    );

    await bot.sendMessage(msg.chat.id,
      `⚙️ DONATOV UZ ADMIN

👥 Foydalanuvchilar: ${users.rows[0].count}
💳 Kutilayotgan to'lovlar: ${topups.rows[0].count}
📦 Kutilayotgan buyurtmalar: ${orders.rows[0].count}`
    );

  } catch (error) {
    console.error(error);
    await bot.sendMessage(msg.chat.id, "Admin panel xatosi.");
  }
});

// ================= CANCEL =================

bot.onText(/^\/cancel$/, msg => {
  sessions.delete(msg.from.id);
  bot.sendMessage(msg.chat.id, "Amal bekor qilindi.", mainKeyboard());
});

// ================= ERRORS =================

bot.on("polling_error", error => {
  console.error("Telegram polling:", error.message);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

// ================= START =================

async function start() {
  try {
    await initDB();
    await bot.startPolling();
    console.log("DONATOV UZ BOT IS RUNNING");
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

start();
