const http = require('http');

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
}).listen(3000, () => {
    console.log('Keep-alive server running on port 3000');
});

const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

let vouchDB = {};
if (fs.existsSync("./vouchDB.json")) {
    vouchDB = JSON.parse(fs.readFileSync("./vouchDB.json"));
} else {
    fs.writeFileSync("./vouchDB.json", JSON.stringify(vouchDB, null, 4));
}

function saveDB() {
    fs.writeFileSync("./vouchDB.json", JSON.stringify(vouchDB, null, 4));
}

client.once("ready", () => {
    console.log(`Bot is online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/g);
    const cmd = args.shift()?.toLowerCase();

    // --------------------- POSITIVE VOUCH ---------------------
    if (cmd === "+vouch") {
        let user = message.mentions.users.first();
        if (!user) return message.reply("Tag someone to vouch!");

        let description = args.join(" ");
        if (!description) description = "No description provided.";

        if (!vouchDB[user.id]) {
            vouchDB[user.id] = { plus: 0, minus: 0, history: [] };
        }

        vouchDB[user.id].plus++;
        vouchDB[user.id].history.push({
            type: "+",
            by: message.author.id,
            desc: description,
            date: new Date().toLocaleString()
        });

        saveDB();

        const embed = new EmbedBuilder()
            .setTitle("Vouch Added ✔️")
            .setColor("Green")
            .setDescription(`**Vouch Info**`)
            .addFields(
                { name: "Seller", value: `<@${user.id}>`, inline: false },
                { name: "Description", value: description, inline: false },
                { name: "Vouched By", value: `<@${message.author.id}>`, inline: false },
                { name: "Date", value: new Date().toLocaleDateString(), inline: false },
                { name: "Total Vouches", value: `+${vouchDB[user.id].plus}\n-${vouchDB[user.id].minus}`, inline: false }
            )
            .setFooter({ text: "Goblox Bot" });

        message.reply({ embeds: [embed] });
    }

    // --------------------- NEGATIVE VOUCH ---------------------
    if (cmd === "-vouch") {
        let user = message.mentions.users.first();
        if (!user) return message.reply("Tag someone to vouch!");

        let description = args.join(" ");
        if (!description) description = "No description provided.";

        if (!vouchDB[user.id]) {
            vouchDB[user.id] = { plus: 0, minus: 0, history: [] };
        }

        vouchDB[user.id].minus++;
        vouchDB[user.id].history.push({
            type: "-",
            by: message.author.id,
            desc: description,
            date: new Date().toLocaleString()
        });

        saveDB();

        const embed = new EmbedBuilder()
            .setTitle("Negative Vouch Added ❌")
            .setColor("Red")
            .setDescription(`**Vouch Info**`)
            .addFields(
                { name: "Seller", value: `<@${user.id}>`, inline: false },
                { name: "Description", value: description, inline: false },
                { name: "Vouched By", value: `<@${message.author.id}>`, inline: false },
                { name: "Date", value: new Date().toLocaleDateString(), inline: false },
                { name: "Total Vouches", value: `+${vouchDB[user.id].plus}\n-${vouchDB[user.id].minus}`, inline: false }
            )
            .setFooter({ text: "Goblox Bot" });

        message.reply({ embeds: [embed] });
    }

    // --------------------- PROFILE CHECK ---------------------
    if (cmd === "+p") {
        let user = message.mentions.users.first() || message.author;

        if (!vouchDB[user.id]) {
            return message.reply("This user has no vouches yet.");
        }

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Vouch Profile`)
            .setColor("Blue")
            .addFields(
                { name: "Positive Vouches", value: `${vouchDB[user.id].plus}`, inline: true },
                { name: "Negative Vouches", value: `${vouchDB[user.id].minus}`, inline: true }
            )
            .setFooter({ text: "Goblox Bot" });

        message.reply({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);

