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

function isValidGitHubUrl(url) {
    // Check if URL matches GitHub raw URL pattern
    return url && (
        url.includes('raw.githubusercontent.com') || 
        url.includes('github.com') && url.includes('/raw/')
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
        const timeLeft = giveaway.endTime - Date.now();
        
        if (timeLeft > 0) {
            activeGiveaway = giveaway;
            setTimeout(async () => {
                const channel = client.channels.cache.get(giveaway.channelId);
                if (channel) await endGiveaway(channel, giveaway);
            }, timeLeft);
        } else {
            // Giveaway already expired, clean it up
            await giveawayCollection.deleteOne({ messageId: giveaway.messageId });
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
                    name: "**Staff Management** (Owner Only)",
                    value:
                        "`?newstaff @user` - Add a user as staff (Owner: the_noob_yt_ only)\n" +
                        "`?removestaff @user` - Remove a user from staff (Owner only)\n" +
                        "`?staff` - List all staff members",
                    inline: false
                },
                {
                    name: "**Roblox Script Generator** (Staff Only)",
                    value:
                        "`?ls <url>` or `?loadingstring <url>` - Generate script with GitHub upload\n" +
                        "`?ls <number>` or `?loadingstring <number>` - Get loadstring by script number\n" +
                        "`?lsl` or `?loadingstringlist` - List all scripts in repository\n" +
                        "`?lsd <number>` or `?loadingstringdelete <number>` - Delete script (Owner only)\n" +
                        "`?lsd all` - Delete ALL scripts with confirmation (Owner only)\n\n" +
                        "**Example:** `?lsl` → `?ls 1` → `?lsd 1`",
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
                },
                {
                    name: "**Giveaway Commands** (Staff Only)",
                    value:
                        "`?creategiveaway <prize> <winners> [@host] [#channel] <timer>` - Create giveaway (attach image)\n" +
                        "`?reroll` - Reroll giveaway winners\n" +
                        "`?endgiveaway` - End active giveaway\n\n" +
                        "**Timer formats:** 10s, 5m, 1h, 1d\n" +
                        "**Example:** `?creategiveaway 1000 3 @host #channel 10m` (with image attached)",
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

    // ===== ROBLOX SCRIPT GENERATOR =====

    if (cmd === "?ls" || cmd === "?loadingstring") {
        // Staff only command
        if (!(await isStaff(message.author.id, message.member))) {
            return message.reply("❌ Staff only command.");
        }

        const input = args.join(" ");
        
        if (!input) {
            return message.reply("❌ Please provide a URL, loadstring, or script number!\n\n**Usage:**\n`?ls <url>`\n`?ls <number>`\n`?ls loadstring(...)`");
        }

        // CHECK IF INPUT IS A NUMBER FIRST (Priority #1)
        if (/^\d+$/.test(input.trim())) {
            const scriptNumber = parseInt(input);

            await message.reply("⏳ Fetching script...");

            const files = await listGitHubFiles();

            if (!files) {
                return message.reply("❌ Failed to fetch scripts from GitHub.");
            }

            if (files.length === 0) {
                return message.reply("📭 No scripts found in the repository yet!");
            }

            if (scriptNumber < 1 || scriptNumber > files.length) {
                return message.reply(`❌ Invalid number! Please choose between 1 and ${files.length}.\nUse \`?lsl\` to see all scripts.`);
            }

            const scriptName = files[scriptNumber - 1];
            const githubUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${scriptName}`;
            const loadstringCode = `loadstring(game:HttpGet("${githubUrl}"))()`;

            const embed = new EmbedBuilder()
                .setTitle("✅ Script Loadstring")
                .setColor("Green")
                .addFields(
                    { name: "📝 Script Name", value: `\`${scriptName}\``, inline: false },
                    { name: "🔢 Number", value: `\`${scriptNumber}\``, inline: true },
                    { name: "🌐 GitHub URL", value: `\`${githubUrl}\``, inline: false }
                )
                .setFooter({ text: "Copy the loadstring below!" })
                .setTimestamp();

            await message.reply({ embeds: [embed] });
            
            // Send loadstring as clean text
            await message.channel.send(loadstringCode);

            return;
        }

        // IF NOT A NUMBER, process as URL/loadstring (original functionality)
        
        // Extract URL from input (handles both direct URL and loadstring format)
        const rawUrl = extractRawUrl(input);
        
        if (!rawUrl) {
            return message.reply("❌ Invalid input! Please provide a valid URL or loadstring.");
        }

        // Validate if it's a GitHub URL
        if (!isValidGitHubUrl(rawUrl)) {
            return message.reply("❌ Invalid URL! Please provide a valid GitHub raw URL.");
        }

        // Extract script name from URL
        const scriptName = extractScriptName(rawUrl);
        
        if (!scriptName) {
            return message.reply("❌ Could not extract script name from URL.");
        }

        // Generate the Roblox key system script
        const robloxScript = `-- Roblox Key System Script
-- Simple and functional key system with auto-save

local KeySystemUI = Instance.new("ScreenGui")
local MainFrame = Instance.new("Frame")
local Title = Instance.new("TextLabel")
local KeyBox = Instance.new("TextBox")
local SubmitButton = Instance.new("TextButton")
local GetKeyButton = Instance.new("TextButton")
local StatusLabel = Instance.new("TextLabel")
local CloseButton = Instance.new("TextButton")

-- Configuration
local CORRECT_KEY_URL = "https://pastebin.com/raw/CD4DyVWc"
local GET_KEY_LINK = "https://direct-link.net/1462308/RRaO8s6Woee8"
local SCRIPT_URL = "${rawUrl}"
local SAVE_KEY_NAME = "SavedKeySystem_v1"

-- Services
local HttpService = game:GetService("HttpService")
local TweenService = game:GetService("TweenService")
local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer

-- Functions
local function getSavedKey()
    local success, savedKey = pcall(function()
        return LocalPlayer:GetAttribute(SAVE_KEY_NAME)
    end)
    return success and savedKey or nil
end

local function saveKey(key)
    pcall(function()
        LocalPlayer:SetAttribute(SAVE_KEY_NAME, key)
    end)
end

local function fetchCorrectKey()
    local success, result = pcall(function()
        return game:HttpGet(CORRECT_KEY_URL)
    end)
    if success then
        return result:gsub("%s+", "")
    end
    return nil
end

local function loadMainScript()
    local success, err = pcall(function()
        loadstring(game:HttpGet(SCRIPT_URL))()
    end)
    if success then
        StatusLabel.Text = "✓ Script Loaded Successfully!"
        StatusLabel.TextColor3 = Color3.fromRGB(0, 255, 0)
        wait(1)
        KeySystemUI:Destroy()
    else
        StatusLabel.Text = "✗ Failed to load script"
        StatusLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
    end
end

local function verifyKey(inputKey)
    StatusLabel.Text = "Verifying key..."
    StatusLabel.TextColor3 = Color3.fromRGB(255, 255, 0)

    local correctKey = fetchCorrectKey()

    if not correctKey then
        StatusLabel.Text = "✗ Cannot verify key (connection error)"
        StatusLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
        return false
    end

    local cleanInput = inputKey:gsub("%s+", "")

    if cleanInput == correctKey then
        StatusLabel.Text = "✓ Key Correct! Loading script..."
        StatusLabel.TextColor3 = Color3.fromRGB(0, 255, 0)
        saveKey(cleanInput)
        wait(0.5)
        loadMainScript()
        return true
    else
        StatusLabel.Text = "✗ Invalid Key!"
        StatusLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
        return false
    end
end

local function checkSavedKey()
    local savedKey = getSavedKey()
    if savedKey then
        StatusLabel.Text = "Checking saved key..."
        StatusLabel.TextColor3 = Color3.fromRGB(255, 255, 0)

        local correctKey = fetchCorrectKey()
        if correctKey and savedKey == correctKey then
            StatusLabel.Text = "✓ Valid key found! Loading..."
            StatusLabel.TextColor3 = Color3.fromRGB(0, 255, 0)
            wait(0.5)
            loadMainScript()
            return true
        else
            StatusLabel.Text = "Saved key expired. Enter new key."
            StatusLabel.TextColor3 = Color3.fromRGB(255, 165, 0)
        end
    end
    return false
end

-- UI Setup
KeySystemUI.Name = "KeySystemUI"
KeySystemUI.Parent = game.CoreGui
KeySystemUI.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

MainFrame.Name = "MainFrame"
MainFrame.Parent = KeySystemUI
MainFrame.BackgroundColor3 = Color3.fromRGB(35, 35, 45)
MainFrame.BorderSizePixel = 0
MainFrame.Position = UDim2.new(0.5, -175, 0.5, -125)
MainFrame.Size = UDim2.new(0, 350, 0, 250)

local UICorner = Instance.new("UICorner")
UICorner.CornerRadius = UDim.new(0, 10)
UICorner.Parent = MainFrame

local UIStroke = Instance.new("UIStroke")
UIStroke.Color = Color3.fromRGB(70, 70, 90)
UIStroke.Thickness = 2
UIStroke.Parent = MainFrame

Title.Name = "Title"
Title.Parent = MainFrame
Title.BackgroundTransparency = 1
Title.Position = UDim2.new(0, 0, 0, 10)
Title.Size = UDim2.new(1, 0, 0, 40)
Title.Font = Enum.Font.GothamBold
Title.Text = "🔑 Key System"
Title.TextColor3 = Color3.fromRGB(255, 255, 255)
Title.TextSize = 24

KeyBox.Name = "KeyBox"
KeyBox.Parent = MainFrame
KeyBox.BackgroundColor3 = Color3.fromRGB(45, 45, 55)
KeyBox.BorderSizePixel = 0
KeyBox.Position = UDim2.new(0.1, 0, 0.28, 0)
KeyBox.Size = UDim2.new(0.8, 0, 0, 35)
KeyBox.Font = Enum.Font.Gotham
KeyBox.PlaceholderText = "Enter Key Here..."
KeyBox.Text = ""
KeyBox.TextColor3 = Color3.fromRGB(255, 255, 255)
KeyBox.TextSize = 14
KeyBox.ClearTextOnFocus = false

local KeyBoxCorner = Instance.new("UICorner")
KeyBoxCorner.CornerRadius = UDim.new(0, 6)
KeyBoxCorner.Parent = KeyBox

SubmitButton.Name = "SubmitButton"
SubmitButton.Parent = MainFrame
SubmitButton.BackgroundColor3 = Color3.fromRGB(0, 170, 255)
SubmitButton.BorderSizePixel = 0
SubmitButton.Position = UDim2.new(0.1, 0, 0.52, 0)
SubmitButton.Size = UDim2.new(0.8, 0, 0, 35)
SubmitButton.Font = Enum.Font.GothamBold
SubmitButton.Text = "Submit Key"
SubmitButton.TextColor3 = Color3.fromRGB(255, 255, 255)
SubmitButton.TextSize = 16

local SubmitCorner = Instance.new("UICorner")
SubmitCorner.CornerRadius = UDim.new(0, 6)
SubmitCorner.Parent = SubmitButton

GetKeyButton.Name = "GetKeyButton"
GetKeyButton.Parent = MainFrame
GetKeyButton.BackgroundColor3 = Color3.fromRGB(70, 200, 100)
GetKeyButton.BorderSizePixel = 0
GetKeyButton.Position = UDim2.new(0.1, 0, 0.72, 0)
GetKeyButton.Size = UDim2.new(0.8, 0, 0, 35)
GetKeyButton.Font = Enum.Font.GothamBold
GetKeyButton.Text = "Get Key"
GetKeyButton.TextColor3 = Color3.fromRGB(255, 255, 255)
GetKeyButton.TextSize = 16

local GetKeyCorner = Instance.new("UICorner")
GetKeyCorner.CornerRadius = UDim.new(0, 6)
GetKeyCorner.Parent = GetKeyButton

StatusLabel.Name = "StatusLabel"
StatusLabel.Parent = MainFrame
StatusLabel.BackgroundTransparency = 1
StatusLabel.Position = UDim2.new(0, 0, 0.9, 0)
StatusLabel.Size = UDim2.new(1, 0, 0, 20)
StatusLabel.Font = Enum.Font.Gotham
StatusLabel.Text = "Enter your key to continue"
StatusLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
StatusLabel.TextSize = 12

CloseButton.Name = "CloseButton"
CloseButton.Parent = MainFrame
CloseButton.BackgroundTransparency = 1
CloseButton.Position = UDim2.new(0.9, 0, 0, 5)
CloseButton.Size = UDim2.new(0, 30, 0, 30)
CloseButton.Font = Enum.Font.GothamBold
CloseButton.Text = "×"
CloseButton.TextColor3 = Color3.fromRGB(255, 255, 255)
CloseButton.TextSize = 24

-- Make draggable
local dragging
local dragInput
local dragStart
local startPos

local function update(input)
    local delta = input.Position - dragStart
    MainFrame.Position = UDim2.new(startPos.X.Scale, startPos.X.Offset + delta.X, startPos.Y.Scale, startPos.Y.Offset + delta.Y)
end

MainFrame.InputBegan:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
        dragging = true
        dragStart = input.Position
        startPos = MainFrame.Position

        input.Changed:Connect(function()
            if input.UserInputState == Enum.UserInputState.End then
                dragging = false
            end
        end)
    end
end)

MainFrame.InputChanged:Connect(function(input)
    if input.UserInputType == Enum.UserInputType.MouseMovement or input.UserInputType == Enum.UserInputType.Touch then
        dragInput = input
    end
end)

game:GetService("UserInputService").InputChanged:Connect(function(input)
    if input == dragInput and dragging then
        update(input)
    end
end)

-- Button hover effects
local function addHoverEffect(button, normalColor, hoverColor)
    button.MouseEnter:Connect(function()
        TweenService:Create(button, TweenInfo.new(0.2), {BackgroundColor3 = hoverColor}):Play()
    end)

    button.MouseLeave:Connect(function()
        TweenService:Create(button, TweenInfo.new(0.2), {BackgroundColor3 = normalColor}):Play()
    end)
end

addHoverEffect(SubmitButton, Color3.fromRGB(0, 170, 255), Color3.fromRGB(0, 200, 255))
addHoverEffect(GetKeyButton, Color3.fromRGB(70, 200, 100), Color3.fromRGB(90, 220, 120))

-- Button functionality
SubmitButton.MouseButton1Click:Connect(function()
    local inputKey = KeyBox.Text
    if inputKey == "" then
        StatusLabel.Text = "✗ Please enter a key"
        StatusLabel.TextColor3 = Color3.fromRGB(255, 0, 0)
        return
    end
    verifyKey(inputKey)
end)

GetKeyButton.MouseButton1Click:Connect(function()
    setclipboard(GET_KEY_LINK)
    StatusLabel.Text = "✓ Link copied! Opening in browser..."
    StatusLabel.TextColor3 = Color3.fromRGB(0, 255, 0)

    pcall(function()
        game:GetService("GuiService"):OpenBrowserWindow(GET_KEY_LINK)
    end)
end)

CloseButton.MouseButton1Click:Connect(function()
    KeySystemUI:Destroy()
end)

-- Check for saved key on load
spawn(function()
    wait(0.5)
    checkSavedKey()
end)`;

        await message.reply("⏳ Processing... Creating script and uploading to GitHub...");

        // Upload script to GitHub
        const githubUrl = await createGitHubFile(scriptName, robloxScript);
        
        if (!githubUrl) {
            return message.reply("❌ Failed to upload script to GitHub. Please check your GitHub token and try again.");
        }

        // Generate loadstring
        const loadstringCode = `loadstring(game:HttpGet("${githubUrl}"))()`;

        // Create embed with all information
        const embed = new EmbedBuilder()
            .setTitle("✅ Roblox Script Generated!")
            .setColor("Green")
            .addFields(
                { name: "📝 Script Name", value: `\`${scriptName}\``, inline: false },
                { name: "🔗 Original URL", value: `\`${rawUrl}\``, inline: false },
                { name: "🌐 GitHub URL", value: `\`${githubUrl}\``, inline: false }
            )
            .setFooter({ text: "Copy the loadstring below and paste in your executor!" })
            .setTimestamp();

        await message.reply({ embeds: [embed] });
        
        // Send loadstring as separate message for easy copying (clean format)
        await message.channel.send(loadstringCode);

        // Also send as a file for backup
        const fs = require('fs');
        const filePath = `./roblox_script_${scriptName}_${Date.now()}.lua`;
        
        fs.writeFileSync(filePath, robloxScript);

        await message.channel.send({
            content: `📁 **Backup File:**`,
            files: [{
                attachment: filePath,
                name: `${scriptName}.lua`
            }]
        });

        // Clean up the file after sending
        setTimeout(() => {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.error('File cleanup error:', err);
            }
        }, 5000);
    }

    // ===== LIST LOADSTRING COMMAND =====

    if (cmd === "?lsl" || cmd === "?loadingstringlist") {
        // Staff only command
        if (!(await isStaff(message.author.id, message.member))) {
            return message.reply("❌ Staff only command.");
        }

        await message.reply("⏳ Fetching scripts from GitHub...");

        const files = await listGitHubFiles();

        if (!files) {
            return message.reply("❌ Failed to fetch scripts from GitHub. Please check your connection.");
        }

        if (files.length === 0) {
            return message.reply("📭 No scripts found in the repository yet!");
        }

        // Create numbered list
        let scriptList = "**📋 Available Scripts:**\n\n";
        files.forEach((file, index) => {
            scriptList += `**${index + 1}.** ${file}\n`;
        });

        scriptList += `\n💡 **Usage:** \`?ls <number>\` to get loadstring\n**Example:** \`?ls 1\``;

        const embed = new EmbedBuilder()
            .setTitle("🗂️ Script Library")
            .setDescription(scriptList)
            .setColor("Blue")
            .setFooter({ text: `Total Scripts: ${files.length}` })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ===== DELETE LOADSTRING COMMAND =====

    if (cmd === "?lsd" || cmd === "?lsdelete" || cmd === "?lsdel" || cmd === "?loadingstringdelete") {
        // Owner only command
        if (message.author.id !== OWNER_ID) {
            return message.reply("❌ Only the bot owner can delete scripts.");
        }

        const input = args[0];

        if (!input) {
            return message.reply("❌ Please provide a script number or 'all'!\n\n**Usage:**\n`?lsd <number>`\n`?lsd all`");
        }

        // Handle "all" deletion
        if (input.toLowerCase() === "all") {
            await message.reply("⚠️ **WARNING:** This will delete ALL scripts from the repository!\n\nReact with ✅ to confirm or ❌ to cancel.");

            const confirmMsg = await message.channel.send("React within 30 seconds...");

            await confirmMsg.react("✅");
            await confirmMsg.react("❌");

            const filter = (reaction, user) => {
                return ['✅', '❌'].includes(reaction.emoji.name) && user.id === message.author.id;
            };

            const collected = await confirmMsg.awaitReactions({ filter, max: 1, time: 30000, errors: ['time'] })
                .catch(() => null);

            if (!collected || collected.first().emoji.name === '❌') {
                return message.reply("❌ Deletion cancelled.");
            }

            // Confirmed - delete all
            await message.reply("⏳ Deleting all scripts...");

            const files = await listGitHubFiles();

            if (!files || files.length === 0) {
                return message.reply("📭 No scripts to delete!");
            }

            let deleted = 0;
            let failed = 0;

            for (const file of files) {
                const success = await deleteGitHubFile(file);
                if (success) deleted++;
                else failed++;
            }

            return message.reply(`✅ Deleted ${deleted} scripts!${failed > 0 ? `\n❌ Failed to delete ${failed} scripts.` : ''}`);
        }

        // Handle number deletion
        if (!/^\d+$/.test(input)) {
            return message.reply("❌ Invalid input! Please provide a valid number or 'all'.");
        }

        const scriptNumber = parseInt(input);

        await message.reply("⏳ Fetching scripts...");

        const files = await listGitHubFiles();

        if (!files) {
            return message.reply("❌ Failed to fetch scripts from GitHub.");
        }

        if (files.length === 0) {
            return message.reply("📭 No scripts found in the repository!");
        }

        if (scriptNumber < 1 || scriptNumber > files.length) {
            return message.reply(`❌ Invalid number! No script exists at position ${scriptNumber}.\nTotal scripts: ${files.length}\nUse \`?lsl\` to see all scripts.`);
        }

        const scriptName = files[scriptNumber - 1];

        await message.reply(`⏳ Deleting script **${scriptName}**...`);

        const success = await deleteGitHubFile(scriptName);

        if (success) {
            return message.reply(`✅ Successfully deleted script: **${scriptName}**`);
        } else {
            return message.reply(`❌ Failed to delete script: **${scriptName}**\nPlease check GitHub token permissions.`);
        }
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
