const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const { MongoClient } = require("mongodb");

// Keep-alive server
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
}).listen(3000, () => {
    console.log('Keep-alive server running on port 3000');
});

// Self-ping every 5 minutes
setInterval(() => {
    https.get('https://bot-3-1tgd.onrender.com', () => {
        console.log('Self-ping successful');
    }).on('error', err => {
        console.log('Self-ping failed:', err.message);
    });
}, 5 * 60 * 1000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

let vouchCollection;
let cooldownCollection;
let staffCollection;
let warnCollection;

const COOLDOWN_TIME = 10 * 60 * 1000;

async function connectDB() {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("gobloxbot");

    vouchCollection = db.collection("vouches");
    cooldownCollection = db.collection("cooldowns");
    staffCollection = db.collection("staff");
    warnCollection = db.collection("warnings");

    console.log("Connected to MongoDB!");
}

// ===== VOUCH FUNCTIONS (UNCHANGED) =====

async function getVouch(userId) {
    let data = await vouchCollection.findOne({ userId });
    if (!data) {
        data = { userId, plus: 0, minus: 0, history: [] };
        await vouchCollection.insertOne(data);
    }
    return data;
}

async function updateVouch(userId, data) {
    await vouchCollection.updateOne({ userId }, { $set: data }, { upsert: true });
}

async function checkCooldown(oderId) {
    let data = await cooldownCollection.findOne({ oderId });
    if (!data) return null;

    let timeLeft = COOLDOWN_TIME - (Date.now() - data.lastVouch);
    return timeLeft > 0 ? timeLeft : null;
}

async function setCooldown(oderId) {
    await cooldownCollection.updateOne(
        { oderId },
        { $set: { oderId, lastVouch: Date.now() } },
        { upsert: true }
    );
}

// ===== STAFF FUNCTIONS =====

async function isStaff(userId) {
    return !!(await staffCollection.findOne({ userId }));
}

async function addStaff(userId) {
    await staffCollection.updateOne({ userId }, { $set: { userId } }, { upsert: true });
}

async function removeStaff(userId) {
    await staffCollection.deleteOne({ userId });
}

// ===== BOT READY =====

client.once("ready", () => {
    console.log(`Bot is online as ${client.user.tag}`);
});

// ===== COMMAND HANDLER =====

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/g);
    const cmd = args.shift()?.toLowerCase();

    // ===== HELP COMMAND =====

    if (cmd === "?help" || cmd === "?h") {
        const embed = new EmbedBuilder()
            .setTitle("📋 Goblox Bot Commands")
            .setColor("Blue")
            .setDescription("Here are all available commands:")
            .addFields(
                {
                    name: "**Vouch Commands**",
                    value: 
                        "`+vouch @user [description]` - Give a positive vouch\n" +
                        "`-vouch @user [description]` - Give a negative vouch\n" +
                        "`+p [@user]` - View vouch profile (yourself or mentioned user)",
                    inline: false
                },
                {
                    name: "**Staff Management** (Admin Only)",
                    value:
                        "`?newstaff @user` - Add a user as staff\n" +
                        "`?removestaff @user` - Remove a user from staff\n" +
                        "`?staff` - List all staff members",
                    inline: false
                },
                {
                    name: "**Moderation Commands** (Staff Only)",
                    value:
                        "`?ban @user [reason]` - Ban a user\n" +
                        "`?kick @user [reason]` - Kick a user\n" +
                        "`?timeout @user <time>` - Timeout a user (e.g., 10m or 1h)\n" +
                        "`?untimeout @user` - Remove timeout from a user\n" +
                        "`?warn @user [reason]` - Warn a user",
                    inline: false
                },
                {
                    name: "**Other Commands**",
                    value: "`?help` or `?h` - Show this help menu",
                    inline: false
                }
            )
            .setFooter({ text: "Goblox Bot | Made with ❤️" })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ===== VOUCH COMMANDS (UNCHANGED) =====

    if (cmd === "+vouch" || cmd === "-vouch") {
        let user = message.mentions.users.first();
        if (!user) return message.reply("Tag someone to vouch!");

        let cooldown = await checkCooldown(message.author.id);
        if (cooldown) {
            let m = Math.floor(cooldown / 60000);
            let s = Math.floor((cooldown % 60000) / 1000);
            return message.reply(`Wait ${m}m ${s}s before vouching again!`);
        }

        let description = args.slice(1).join(" ") || "No description provided.";
        let data = await getVouch(user.id);

        if (cmd === "+vouch") data.plus++;
        else data.minus++;

        data.history.push({
            type: cmd === "+vouch" ? "+" : "-",
            by: message.author.id,
            desc: description,
            date: new Date().toLocaleString()
        });

        await updateVouch(user.id, data);
        await setCooldown(message.author.id);

        const embed = new EmbedBuilder()
            .setTitle(cmd === "+vouch" ? "Vouch Added" : "Negative Vouch Added")
            .setColor(cmd === "+vouch" ? "Green" : "Red")
            .addFields(
                { name: "User", value: `<@${user.id}>` },
                { name: "Description", value: description },
                { name: "By", value: `<@${message.author.id}>` },
                { name: "Total", value: `+${data.plus} / -${data.minus}` }
            )
            .setFooter({ text: "Goblox Bot" });

        return message.reply({ embeds: [embed] });
    }

    if (cmd === "+p") {
        let user = message.mentions.users.first() || message.author;
        let data = await getVouch(user.id);
        if (!data.plus && !data.minus) return message.reply("No vouches yet.");

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Profile`)
            .setColor("Blue")
            .addFields(
                { name: "Positive", value: `${data.plus}`, inline: true },
                { name: "Negative", value: `${data.minus}`, inline: true }
            );

        return message.reply({ embeds: [embed] });
    }

    // ===== STAFF PANEL =====

    if (cmd === "?newstaff") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("Admins only.");

        let user = message.mentions.users.first();
        if (!user) return message.reply("Mention a user.");

        await addStaff(user.id);
        return message.reply(`✅ ${user.tag} added as staff.`);
    }

    if (cmd === "?removestaff") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("Admins only.");

        let user = message.mentions.users.first();
        if (!user) return message.reply("Mention a user.");

        await removeStaff(user.id);
        return message.reply(`❌ ${user.tag} removed from staff.`);
    }

    if (cmd === "?staff") {
        const staff = await staffCollection.find().toArray();
        if (!staff.length) return message.reply("No staff found.");

        return message.reply("👑 **Staff List**\n" + staff.map(s => `<@${s.userId}>`).join("\n"));
    }

    // ===== MOD COMMANDS (STAFF ONLY) =====

    if (["?ban", "?kick", "?timeout", "?untimeout", "?warn"].includes(cmd)) {
        if (!(await isStaff(message.author.id)))
            return message.reply("Staff only command.");
    }

    if (cmd === "?ban") {
        let m = message.mentions.members.first();
        if (!m) return message.reply("Mention user.");
        await m.ban({ reason: args.slice(1).join(" ") || "No reason" });
        return message.reply(`🔨 Banned ${m.user.tag}`);
    }

    if (cmd === "?kick") {
        let m = message.mentions.members.first();
        if (!m) return message.reply("Mention user.");
        await m.kick(args.slice(1).join(" ") || "No reason");
        return message.reply(`👢 Kicked ${m.user.tag}`);
    }

    if (cmd === "?timeout") {
        let m = message.mentions.members.first();
        let t = args[1];
        if (!m || !t) return message.reply("?timeout @user 10m");

        let ms = t.endsWith("m") ? parseInt(t) * 60000 : t.endsWith("h") ? parseInt(t) * 3600000 : null;
        if (!ms) return message.reply("Use 10m or 1h");

        await m.timeout(ms);
        return message.reply(`⏱ Timed out ${m.user.tag}`);
    }

    if (cmd === "?untimeout") {
        let m = message.mentions.members.first();
        if (!m) return message.reply("Mention user.");
        await m.timeout(null);
        return message.reply(`🔓 Timeout removed`);
    }

    if (cmd === "?warn") {
        let user = message.mentions.users.first();
        if (!user) return message.reply("Mention user.");

        await warnCollection.insertOne({
            userId: user.id,
            by: message.author.id,
            reason: args.slice(1).join(" ") || "No reason",
            date: new Date()
        });

        return message.reply(`⚠ Warned ${user.tag}`);
    }
});

connectDB().then(() => client.login(process.env.DISCORD_TOKEN));
