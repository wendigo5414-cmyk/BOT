const http = require('http');
const https = require('https');
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
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
let balanceCollection;
let giveawayCollection;

const COOLDOWN_TIME = 10 * 60 * 1000;
const STAFF_ROLE_ID = "1449394350009356481";

let activeGiveaway = null;

async function connectDB() {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("gobloxbot");

    vouchCollection = db.collection("vouches");
    cooldownCollection = db.collection("cooldowns");
    staffCollection = db.collection("staff");
    warnCollection = db.collection("warnings");
    balanceCollection = db.collection("balances");
    giveawayCollection = db.collection("giveaways");

    console.log("Connected to MongoDB!");
}

// ===== VOUCH FUNCTIONS =====

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

async function isStaff(userId, member) {
    const hasRole = member?.roles?.cache.has(STAFF_ROLE_ID);
    const inDB = !!(await staffCollection.findOne({ userId }));
    return hasRole || inDB;
}

async function addStaff(userId) {
    await staffCollection.updateOne({ userId }, { $set: { userId } }, { upsert: true });
}

async function removeStaff(userId) {
    await staffCollection.deleteOne({ userId });
}

// ===== BALANCE FUNCTIONS =====

async function getBalance(userId) {
    let data = await balanceCollection.findOne({ userId });
    if (!data) {
        data = { userId, robux: 0 };
        await balanceCollection.insertOne(data);
    }
    return data;
}

async function addBalance(userId, amount) {
    await balanceCollection.updateOne(
        { userId },
        { $inc: { robux: amount } },
        { upsert: true }
    );
}

async function setBalance(userId, amount) {
    await balanceCollection.updateOne(
        { userId },
        { $set: { robux: amount } },
        { upsert: true }
    );
}

// ===== GIVEAWAY FUNCTIONS =====

function parseTime(timeStr) {
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const multipliers = {
        s: 1000,
        m: 60000,
        h: 3600000,
        d: 86400000
    };
    
    return value * multipliers[unit];
}

async function endGiveaway(channel, giveaway, reroll = false) {
    if (!giveaway.participants || giveaway.participants.length === 0) {
        return channel.send("❌ No one participated in the giveaway!");
    }

    const winners = [];
    const participants = [...giveaway.participants];
    
    for (let i = 0; i < Math.min(giveaway.winners, participants.length); i++) {
        const randomIndex = Math.floor(Math.random() * participants.length);
        winners.push(participants[randomIndex]);
        participants.splice(randomIndex, 1);
    }

    // Award robux to winners
    for (const winnerId of winners) {
        await addBalance(winnerId, giveaway.prize);
    }

    const winnerMentions = winners.map(id => `<@${id}>`).join(", ");

    const endEmbed = new EmbedBuilder()
        .setTitle("🎉 GIVEAWAY ENDED 🎉")
        .setDescription(`**Prize:** ${giveaway.prize} Robux`)
        .addFields(
            { name: "Winners", value: winnerMentions || "None" },
            { name: "Hosted by", value: `<@${giveaway.host}>` }
        )
        .setColor("Gold")
        .setTimestamp();

    if (giveaway.image) {
        endEmbed.setImage(giveaway.image);
    }

    await channel.send({ content: `🎊 Congratulations ${winnerMentions}!`, embeds: [endEmbed] });

    if (reroll) {
        await channel.send(`🔄 Giveaway rerolled! New winners: ${winnerMentions}`);
    }

    // Clear active giveaway
    activeGiveaway = null;
    await giveawayCollection.deleteOne({ messageId: giveaway.messageId });
}

// ===== BOT READY =====

client.once("ready", async () => {
    console.log(`Bot is online as ${client.user.tag}`);
    
    // Check for active giveaways on restart
    const giveaway = await giveawayCollection.findOne({});
    if (giveaway) {
        activeGiveaway = giveaway;
        const timeLeft = giveaway.endTime - Date.now();
        
        if (timeLeft > 0) {
            setTimeout(async () => {
                const channel = client.channels.cache.get(giveaway.channelId);
                if (channel) await endGiveaway(channel, giveaway);
            }, timeLeft);
        }
    }
});

// ===== BUTTON INTERACTION =====

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === "join_giveaway") {
        if (!activeGiveaway) {
            return interaction.reply({ content: "This giveaway has ended!", ephemeral: true });
        }

        const userId = interaction.user.id;
        
        if (activeGiveaway.participants.includes(userId)) {
            return interaction.reply({ content: "You already joined this giveaway!", ephemeral: true });
        }

        activeGiveaway.participants.push(userId);
        await giveawayCollection.updateOne(
            { messageId: activeGiveaway.messageId },
            { $push: { participants: userId } }
        );

        await interaction.reply({ content: "✅ You joined the giveaway! Good luck!", ephemeral: true });
    }
});

// ===== COMMAND HANDLER =====

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/g);
    const cmd = args.shift()?.toLowerCase();

    // ===== HELP COMMANDS =====

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
                        "`+p [@user]` - View vouch profile",
                    inline: false
                },
                {
                    name: "**Currency Commands**",
                    value:
                        "`?balance [@user]` - Check robux balance\n" +
                        "`?give @user <amount>` - Give robux to a user (Staff)\n" +
                        "`?set @user <amount>` - Set user's robux balance (Staff)\n" +
                        "`?take @user <amount>` - Take robux from a user (Staff)",
                    inline: false
                },
                {
                    name: "**Giveaway Commands**",
                    value:
                        "`/creategiveaway <prize> <winners> <image> <host> <channel> <timer>` - Create giveaway (Staff)\n" +
                        "`/reroll` - Reroll giveaway winners (Staff)\n" +
                        "`/endgiveaway` - End active giveaway (Staff)",
                    inline: false
                },
                {
                    name: "**Other Commands**",
                    value: 
                        "`?help` or `?h` - Show this help menu\n" +
                        "`?modhelp` or `?mp` - Show moderation commands",
                    inline: false
                }
            )
            .setFooter({ text: "Goblox Bot | Made with ❤️" })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    if (cmd === "?modhelp" || cmd === "?mp") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        const embed = new EmbedBuilder()
            .setTitle("🛡️ Moderation Commands")
            .setColor("Red")
            .setDescription("Staff & Admin commands:")
            .addFields(
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
                        "`?warn @user [reason]` - Warn a user\n" +
                        "`?clear <1-1000>` - Delete messages from the channel",
                    inline: false
                }
            )
            .setFooter({ text: "Goblox Bot | Moderation Panel" })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ===== VOUCH COMMANDS =====

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

    // ===== BALANCE COMMANDS =====

    if (cmd === "?balance" || cmd === "?bal") {
        let user = message.mentions.users.first() || message.author;
        let data = await getBalance(user.id);

        const embed = new EmbedBuilder()
            .setTitle(`💰 ${user.username}'s Balance`)
            .setDescription(`**Robux:** ${data.robux} R$`)
            .setColor("Green")
            .setThumbnail(user.displayAvatarURL())
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    if (cmd === "?give") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        let user = message.mentions.users.first();
        let amount = parseInt(args[1]);

        if (!user || !amount || amount <= 0)
            return message.reply("Usage: `?give @user <amount>`");

        await addBalance(user.id, amount);

        return message.reply(`✅ Given ${amount} Robux to <@${user.id}>`);
    }

    if (cmd === "?set") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        let user = message.mentions.users.first();
        let amount = parseInt(args[1]);

        if (!user || amount < 0)
            return message.reply("Usage: `?set @user <amount>`");

        await setBalance(user.id, amount);

        return message.reply(`✅ Set <@${user.id}>'s balance to ${amount} Robux`);
    }

    if (cmd === "?take") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        let user = message.mentions.users.first();
        let amount = parseInt(args[1]);

        if (!user || !amount || amount <= 0)
            return message.reply("Usage: `?take @user <amount>`");

        await addBalance(user.id, -amount);

        return message.reply(`✅ Taken ${amount} Robux from <@${user.id}>`);
    }

    // ===== GIVEAWAY COMMANDS =====

    if (cmd === "/creategiveaway") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        if (activeGiveaway) {
            return message.reply("❌ There's already an active giveaway! End it first with `/endgiveaway`");
        }

        const prize = parseInt(args[0]);
        const winners = parseInt(args[1]);
        const image = args[2];
        const host = message.mentions.users.first() || message.author;
        const channel = message.mentions.channels.first() || message.channel;
        const timer = args[args.length - 1];

        if (!prize || !winners || !timer) {
            return message.reply("Usage: `/creategiveaway <prize> <winners> <image> [@host] [#channel] <timer>`\nTimer format: 10s, 5m, 1h, 1d");
        }

        const duration = parseTime(timer);
        if (!duration) {
            return message.reply("Invalid timer format! Use: 10s, 5m, 1h, or 1d");
        }

        const endTime = Date.now() + duration;

        const giveawayEmbed = new EmbedBuilder()
            .setTitle("🎉 GIVEAWAY 🎉")
            .setDescription(`**Prize:** ${prize} Robux\n**Winners:** ${winners}\n**Hosted by:** <@${host.id}>\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>`)
            .setColor("Purple")
            .setFooter({ text: "Click the button below to join!" })
            .setTimestamp(endTime);

        if (image && image.startsWith("http")) {
            giveawayEmbed.setImage(image);
        }

        const button = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("join_giveaway")
                .setLabel("🎉 Join Giveaway")
                .setStyle(ButtonStyle.Primary)
        );

        const giveawayMsg = await channel.send({ embeds: [giveawayEmbed], components: [button] });

        activeGiveaway = {
            messageId: giveawayMsg.id,
            channelId: channel.id,
            prize: prize,
            winners: winners,
            host: host.id,
            image: image && image.startsWith("http") ? image : null,
            endTime: endTime,
            participants: []
        };

        await giveawayCollection.insertOne(activeGiveaway);

        message.reply(`✅ Giveaway created in <#${channel.id}>!`);

        setTimeout(async () => {
            await endGiveaway(channel, activeGiveaway);
        }, duration);
    }

    if (cmd === "/reroll") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        if (!activeGiveaway) {
            return message.reply("❌ No active giveaway to reroll!");
        }

        await endGiveaway(message.channel, activeGiveaway, true);
    }

    if (cmd === "/endgiveaway") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        if (!activeGiveaway) {
            return message.reply("❌ No active giveaway to end!");
        }

        const channel = client.channels.cache.get(activeGiveaway.channelId);
        await endGiveaway(channel, activeGiveaway);
        message.reply("✅ Giveaway ended!");
    }

    // ===== STAFF PANEL =====

    if (cmd === "?newstaff") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("Admins only.");

        let user = message.mentions.users.first();
        if (!user) return message.reply("Mention a user.");

        await addStaff(user.id);

        const member = message.guild.members.cache.get(user.id);
        if (member) {
            try {
                await member.roles.add(STAFF_ROLE_ID);
            } catch (error) {
                console.error("Failed to assign role:", error);
            }
        }

        return message.reply(`✅ ${user.tag} added as staff and role assigned.`);
    }

    if (cmd === "?removestaff") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
            return message.reply("Admins only.");

        let user = message.mentions.users.first();
        if (!user) return message.reply("Mention a user.");

        await removeStaff(user.id);

        const member = message.guild.members.cache.get(user.id);
        if (member) {
            try {
                await member.roles.remove(STAFF_ROLE_ID);
            } catch (error) {
                console.error("Failed to remove role:", error);
            }
        }

        return message.reply(`❌ ${user.tag} removed from staff.`);
    }

    if (cmd === "?staff") {
        const staff = await staffCollection.find().toArray();
        if (!staff.length) return message.reply("No staff found.");

        return message.reply("👑 **Staff List**\n" + staff.map(s => `<@${s.userId}>`).join("\n"));
    }

    // ===== MOD COMMANDS (STAFF ONLY) =====

    if (["?ban", "?kick", "?timeout", "?untimeout", "?warn", "?clear"].includes(cmd)) {
        if (!(await isStaff(message.author.id, message.member)))
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

    if (cmd === "?clear") {
        let amount = parseInt(args[0]);
        
        if (!amount || amount < 1 || amount > 1000) {
            return message.reply("Please provide a number between 1 and 1000.");
        }

        try {
            await message.delete();
            const fetched = await message.channel.messages.fetch({ limit: amount });
            await message.channel.bulkDelete(fetched, true);

            const reply = await message.channel.send(`🗑️ Cleared ${fetched.size} messages.`);
            setTimeout(() => reply.delete().catch(() => {}), 3000);
        } catch (error) {
            console.error("Clear error:", error);
            return message.channel.send("Failed to clear messages. (Messages older than 14 days cannot be bulk deleted)");
        }
    }
});

connectDB().then(() => client.login(process.env.DISCORD_TOKEN));
