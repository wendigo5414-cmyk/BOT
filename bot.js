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
const OWNER_ID = "1319539205885526018"; // Only this user can add staff

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Add this to your environment variables
const GITHUB_OWNER = "wendigo5414-cmyk"; // Your GitHub username
const GITHUB_REPO = "promotedscripts"; // Your new repo name
const GITHUB_BRANCH = "main";

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

// ===== GITHUB FUNCTIONS =====

async function createGitHubFile(fileName, content) {
    try {
        const axios = require('axios');
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${fileName}`;
        
        const response = await axios.put(url, {
            message: `Add ${fileName}`,
            content: Buffer.from(content).toString('base64'),
            branch: GITHUB_BRANCH
        }, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            }
        });

        const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${fileName}`;
        return rawUrl;
    } catch (error) {
        console.error('GitHub API Error:', error.response?.data || error.message);
        return null;
    }
}

async function listGitHubFiles() {
    try {
        const axios = require('axios');
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/`;
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        // Filter only files (not directories) and exclude README, etc.
        const files = response.data
            .filter(item => item.type === 'file' && !item.name.match(/^(README|LICENSE|\.)/))
            .map(item => item.name);

        return files;
    } catch (error) {
        console.error('GitHub List Error:', error.response?.data || error.message);
        return null;
    }
}

async function deleteGitHubFile(fileName) {
    try {
        const axios = require('axios');
        
        // First, get the file's SHA (required for deletion)
        const getUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${fileName}`;
        const getResponse = await axios.get(getUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        const fileSha = getResponse.data.sha;

        // Now delete the file
        const deleteUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${fileName}`;
        await axios.delete(deleteUrl, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: {
                message: `Delete ${fileName}`,
                sha: fileSha,
                branch: GITHUB_BRANCH
            }
        });

        return true;
    } catch (error) {
        console.error('GitHub Delete Error:', error.response?.data || error.message);
        return false;
    }
}

function extractScriptName(url) {
    // Extract the last part of the URL as script name
    const match = url.match(/\/([^\/]+)$/);
    return match ? match[1] : null;
}

function extractRawUrl(input) {
    // If input is a loadstring, extract URL from it
    const loadstringMatch = input.match(/game:HttpGet\("([^"]+)"\)/);
    if (loadstringMatch) {
        return loadstringMatch[1];
    }
    
    // If input is already a URL
    if (input.startsWith('http')) {
        return input;
    }
    
    return null;
}

async function endGiveaway(channel, giveaway, isReroll = false) {
    if (giveaway.participants.length === 0) {
        await channel.send("❌ No one joined the giveaway!");
        activeGiveaway = null;
        await giveawayCollection.deleteOne({ messageId: giveaway.messageId });
        return;
    }

    const winners = [];
    const participants = [...giveaway.participants];

    for (let i = 0; i < giveaway.winners && participants.length > 0; i++) {
        const randomIndex = Math.floor(Math.random() * participants.length);
        winners.push(participants.splice(randomIndex, 1)[0]);
    }

    const winnerMentions = winners.map(id => `<@${id}>`).join(", ");
    
    const resultEmbed = new EmbedBuilder()
        .setTitle(isReroll ? "🔄 Giveaway Rerolled!" : "🎉 Giveaway Ended!")
        .setDescription(`**Winners:** ${winnerMentions}\n**Prize:** ${giveaway.prize} Robux\n**Hosted by:** <@${giveaway.host}>`)
        .setColor("Gold")
        .setTimestamp();

    if (giveaway.image) {
        resultEmbed.setImage(giveaway.image);
    }

    await channel.send({ embeds: [resultEmbed] });

    // Award Robux to winners
    for (const winnerId of winners) {
        await addBalance(winnerId, giveaway.prize);
    }

    if (!isReroll) {
        activeGiveaway = null;
        await giveawayCollection.deleteOne({ messageId: giveaway.messageId });
    }
}

function parseTime(timeStr) {
    const match = timeStr.match(/^(\d+)([smhd])$/);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);
    
    // Restore active giveaway from database
    const savedGiveaway = await giveawayCollection.findOne({});
    if (savedGiveaway) {
        activeGiveaway = savedGiveaway;
        
        const remainingTime = savedGiveaway.endTime - Date.now();
        if (remainingTime > 0) {
            setTimeout(async () => {
                const channel = client.channels.cache.get(savedGiveaway.channelId);
                await endGiveaway(channel, savedGiveaway);
            }, remainingTime);
        } else {
            const channel = client.channels.cache.get(savedGiveaway.channelId);
            await endGiveaway(channel, savedGiveaway);
        }
    }
});

// ===== BUTTON INTERACTION HANDLER (THIS WAS MISSING!) =====
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    // Handle giveaway join button
    if (interaction.customId === "join_giveaway") {
        if (!activeGiveaway) {
            return interaction.reply({ content: "❌ This giveaway has ended!", ephemeral: true });
        }

        const userId = interaction.user.id;

        if (activeGiveaway.participants.includes(userId)) {
            return interaction.reply({ content: "❌ You've already joined this giveaway!", ephemeral: true });
        }

        activeGiveaway.participants.push(userId);
        await giveawayCollection.updateOne(
            { messageId: activeGiveaway.messageId },
            { $set: { participants: activeGiveaway.participants } }
        );

        return interaction.reply({ content: "✅ You've successfully joined the giveaway!", ephemeral: true });
    }

    // Handle script deletion confirmation buttons
    if (interaction.customId.startsWith("confirm_delete_") || interaction.customId.startsWith("cancel_delete_")) {
        // Extract script number from custom ID
        const parts = interaction.customId.split("_");
        const action = parts[0]; // "confirm" or "cancel"
        const scriptNumber = parseInt(parts[2]);

        if (action === "cancel") {
            await interaction.update({ 
                content: "❌ Deletion cancelled.", 
                components: [] 
            });
            return;
        }

        // Confirm deletion
        await interaction.update({ 
            content: "⏳ Deleting script...", 
            components: [] 
        });

        const files = await listGitHubFiles();

        if (!files || files.length === 0) {
            return interaction.followUp("📭 No scripts found in the repository!");
        }

        if (scriptNumber < 1 || scriptNumber > files.length) {
            return interaction.followUp(`❌ Invalid number! No script exists at position ${scriptNumber}.`);
        }

        const scriptName = files[scriptNumber - 1];
        const success = await deleteGitHubFile(scriptName);

        if (success) {
            return interaction.followUp(`✅ Successfully deleted script: **${scriptName}**`);
        } else {
            return interaction.followUp(`❌ Failed to delete script: **${scriptName}**\nPlease check GitHub token permissions.`);
        }
    }
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    let content = message.content.trim();
    let args = content.split(/\s+/);
    let cmd = args[0]?.toLowerCase();

    // ===== VOUCH COMMAND =====

    if (cmd === "?vouch") {
        let voucherUser = message.mentions.users.first();
        let oderUser = message.mentions.users.size > 1 ? Array.from(message.mentions.users.values())[1] : null;
        let rating = args.find(a => a === "+rep" || a === "-rep");

        if (!voucherUser || !oderUser || !rating) {
            return message.reply("Usage: `?vouch @Voucher @oder +rep/-rep`\nVoucher = The person giving the vouch\nOder = The person being vouched for");
        }

        if (voucherUser.id === oderUser.id) {
            return message.reply("❌ You can't vouch for yourself!");
        }

        let cooldownLeft = await checkCooldown(oderUser.id);
        if (cooldownLeft) {
            let min = Math.ceil(cooldownLeft / 60000);
            return message.reply(`⏱ Please wait ${min} minutes before vouching for this user again.`);
        }

        let data = await getVouch(oderUser.id);
        if (rating === "+rep") {
            data.plus++;
        } else {
            data.minus++;
        }

        data.history.push({
            voucher: voucherUser.id,
            rating: rating,
            date: new Date()
        });

        await updateVouch(oderUser.id, data);
        await setCooldown(oderUser.id);

        const embed = new EmbedBuilder()
            .setTitle("✅ Vouch Recorded")
            .setDescription(`**Voucher:** ${voucherUser.tag}\n**Oder:** ${oderUser.tag}\n**Rating:** ${rating}`)
            .addFields({ name: "Total Vouches", value: `+${data.plus} | -${data.minus}` })
            .setColor(rating === "+rep" ? "Green" : "Red")
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    if (cmd === "?vouches") {
        let user = message.mentions.users.first() || message.author;
        let data = await getVouch(user.id);

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Vouches`)
            .setDescription(`**+Rep:** ${data.plus}\n**-Rep:** ${data.minus}`)
            .setColor("Blue")
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ===== BALANCE COMMANDS =====

    if (cmd === "?balance" || cmd === "?bal") {
        let user = message.mentions.users.first() || message.author;
        let data = await getBalance(user.id);

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Balance`)
            .setDescription(`💰 **${data.robux} Robux**`)
            .setColor("Gold")
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    if (cmd === "?addbalance") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        let user = message.mentions.users.first();
        let amount = parseInt(args[1]);

        if (!user || isNaN(amount)) {
            return message.reply("Usage: `?addbalance @user <amount>`");
        }

        await addBalance(user.id, amount);

        return message.reply(`✅ Added **${amount} Robux** to ${user.tag}'s balance.`);
    }

    if (cmd === "?setbalance") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        let user = message.mentions.users.first();
        let amount = parseInt(args[1]);

        if (!user || isNaN(amount)) {
            return message.reply("Usage: `?setbalance @user <amount>`");
        }

        await setBalance(user.id, amount);

        return message.reply(`✅ Set ${user.tag}'s balance to **${amount} Robux**.`);
    }

    if (cmd === "?removebalance") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        let user = message.mentions.users.first();
        let amount = parseInt(args[1]);

        if (!user || isNaN(amount)) {
            return message.reply("Usage: `?removebalance @user <amount>`");
        }

        await addBalance(user.id, -amount);

        return message.reply(`✅ Removed **${amount} Robux** from ${user.tag}'s balance.`);
    }

    // ===== PROMOTED SCRIPT COMMANDS =====

    if (cmd === "?lsa") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        const scriptInput = args.slice(1).join(" ");
        
        if (!scriptInput) {
            return message.reply("Usage: `?lsa <loadstring OR raw URL>`\nExample: `?lsa loadstring(game:HttpGet(\"https://raw.githubusercontent.com/...\"))()`\nOr: `?lsa https://raw.githubusercontent.com/...`");
        }

        const rawUrl = extractRawUrl(scriptInput);
        
        if (!rawUrl) {
            return message.reply("❌ Could not extract URL from your input!\nPlease provide either:\n- A loadstring: `loadstring(game:HttpGet(\"URL\"))()`\n- A raw URL: `https://raw.githubusercontent.com/...`");
        }

        const scriptName = extractScriptName(rawUrl);
        
        if (!scriptName) {
            return message.reply("❌ Could not extract script name from URL!");
        }

        await message.reply(`⏳ Fetching script from: ${rawUrl}`);

        try {
            const axios = require('axios');
            const response = await axios.get(rawUrl);
            const scriptContent = response.data;

            const uploadedUrl = await createGitHubFile(scriptName, scriptContent);

            if (uploadedUrl) {
                const loadstring = `loadstring(game:HttpGet("${uploadedUrl}"))()`;
                
                const embed = new EmbedBuilder()
                    .setTitle("✅ Script Added Successfully!")
                    .setDescription(`**Script Name:** ${scriptName}\n**Raw URL:** ${uploadedUrl}`)
                    .addFields({ name: "Loadstring", value: `\`\`\`lua\n${loadstring}\n\`\`\`` })
                    .setColor("Green")
                    .setTimestamp();

                return message.reply({ embeds: [embed] });
            } else {
                return message.reply("❌ Failed to upload script to GitHub. Check your token permissions!");
            }
        } catch (error) {
            console.error('Fetch Error:', error.message);
            return message.reply(`❌ Failed to fetch script from URL: ${rawUrl}\nMake sure it's a valid raw URL!`);
        }
    }

    if (cmd === "?lsl") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        const files = await listGitHubFiles();

        if (!files || files.length === 0) {
            return message.reply("📭 No scripts found in the repository!");
        }

        const scriptList = files.map((file, index) => {
            const rawUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file}`;
            const loadstring = `loadstring(game:HttpGet("${rawUrl}"))()`;
            return `**${index + 1}.** ${file}\n\`\`\`lua\n${loadstring}\n\`\`\``;
        }).join("\n");

        const embed = new EmbedBuilder()
            .setTitle("📜 Promoted Scripts List")
            .setDescription(scriptList || "No scripts available.")
            .setColor("Blue")
            .setFooter({ text: `Total Scripts: ${files.length}` })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    if (cmd === "?lsd") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        const scriptNumber = parseInt(args[1]);

        if (!scriptNumber) {
            return message.reply("Usage: `?lsd <number>`\nExample: `?lsd 1` to delete the first script\nUse `?lsl` to see the list.");
        }

        const files = await listGitHubFiles();

        if (!files || files.length === 0) {
            return message.reply("📭 No scripts found in the repository!");
        }

        if (scriptNumber < 1 || scriptNumber > files.length) {
            return message.reply(`❌ Invalid number! No script exists at position ${scriptNumber}.\nTotal scripts: ${files.length}\nUse \`?lsl\` to see all scripts.`);
        }

        const scriptName = files[scriptNumber - 1];

        const confirmButton = new ButtonBuilder()
            .setCustomId(`confirm_delete_${scriptNumber}`)
            .setLabel("✅ Confirm")
            .setStyle(ButtonStyle.Success);

        const cancelButton = new ButtonBuilder()
            .setCustomId(`cancel_delete_${scriptNumber}`)
            .setLabel("❌ Cancel")
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

        return message.reply({
            content: `⚠️ Are you sure you want to delete script: **${scriptName}**?`,
            components: [row]
        });
    }

    // ===== GIVEAWAY COMMANDS =====

    if (cmd === "?creategiveaway") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        if (activeGiveaway) {
            return message.reply("❌ There's already an active giveaway! End it first with `?endgiveaway`");
        }

        const prize = parseInt(args[0]);
        const winners = parseInt(args[1]);
        const host = message.mentions.users.first() || message.author;
        const channel = message.mentions.channels.first() || message.channel;
        const timer = args[args.length - 1];
        
        // Get image from message attachment
        const image = message.attachments.first()?.url || null;

        if (!prize || !winners || !timer) {
            return message.reply("Usage: `?creategiveaway <prize> <winners> [@host] [#channel] <timer>`\nTimer format: 10s, 5m, 1h, 1d\nAttach an image with the command!");
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
            image: image || null,
            endTime: endTime,
            participants: []
        };

        await giveawayCollection.insertOne(activeGiveaway);

        message.reply(`✅ Giveaway created in <#${channel.id}>!`);

        setTimeout(async () => {
            await endGiveaway(channel, activeGiveaway);
        }, duration);
    }

    if (cmd === "?reroll") {
        if (!(await isStaff(message.author.id, message.member)))
            return message.reply("Staff only command.");

        if (!activeGiveaway) {
            return message.reply("❌ No active giveaway to reroll!");
        }

        await endGiveaway(message.channel, activeGiveaway, true);
    }

    if (cmd === "?endgiveaway") {
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
        // Only the owner can add staff
        if (message.author.id !== OWNER_ID) {
            return message.reply("❌ Only the bot owner can add staff members.");
        }

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
        // Only the owner can remove staff
        if (message.author.id !== OWNER_ID) {
            return message.reply("❌ Only the bot owner can remove staff members.");
        }

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
