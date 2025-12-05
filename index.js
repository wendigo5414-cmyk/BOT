const http = require('http');
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const { MongoClient } = require("mongodb");

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
}).listen(3000, () => {
    console.log('Keep-alive server running on port 3000');
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

let vouchCollection;

async function connectDB() {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db("gobloxbot");
    vouchCollection = db.collection("vouches");
    console.log("Connected to MongoDB!");
}

async function getVouch(userId) {
    let data = await vouchCollection.findOne({ userId: userId });
    if (!data) {
        data = { userId: userId, plus: 0, minus: 0, history: [] };
        await vouchCollection.insertOne(data);
    }
    return data;
}

async function updateVouch(userId, data) {
    await vouchCollection.updateOne({ userId: userId }, { $set: data }, { upsert: true });
}

client.once("ready", () => {
    console.log(`Bot is online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    const args = message.content.trim().split(/ +/g);
    const cmd = args.shift()?.toLowerCase();

    if (cmd === "+vouch") {
        let user = message.mentions.users.first();
        if (!user) return message.reply("Tag someone to vouch!");

        let description = args.slice(1).join(" ");
        if (!description) description = "No description provided.";

        let data = await getVouch(user.id);
        data.plus++;
        data.history.push({
            type: "+",
            by: message.author.id,
            desc: description,
            date: new Date().toLocaleString()
        });
        await updateVouch(user.id, data);

        const embed = new EmbedBuilder()
            .setTitle("Vouch Added")
            .setColor("Green")
            .setDescription("**Vouch Info**")
            .addFields(
                { name: "Seller", value: `<@${user.id}>`, inline: false },
                { name: "Description", value: description, inline: false },
                { name: "Vouched By", value: `<@${message.author.id}>`, inline: false },
                { name: "Date", value: new Date().toLocaleDateString(), inline: false },
                { name: "Total Vouches", value: `+${data.plus}\n-${data.minus}`, inline: false }
            )
            .setFooter({ text: "Goblox Bot" });

        message.reply({ embeds: [embed] });
    }

    if (cmd === "-vouch") {
        let user = message.mentions.users.first();
        if (!user) return message.reply("Tag someone to vouch!");

        let description = args.slice(1).join(" ");
        if (!description) description = "No description provided.";

        let data = await getVouch(user.id);
        data.minus++;
        data.history.push({
            type: "-",
            by: message.author.id,
            desc: description,
            date: new Date().toLocaleString()
        });
        await updateVouch(user.id, data);

        const embed = new EmbedBuilder()
            .setTitle("Negative Vouch Added")
            .setColor("Red")
            .setDescription("**Vouch Info**")
            .addFields(
                { name: "Seller", value: `<@${user.id}>`, inline: false },
                { name: "Description", value: description, inline: false },
                { name: "Vouched By", value: `<@${message.author.id}>`, inline: false },
                { name: "Date", value: new Date().toLocaleDateString(), inline: false },
                { name: "Total Vouches", value: `+${data.plus}\n-${data.minus}`, inline: false }
            )
            .setFooter({ text: "Goblox Bot" });

        message.reply({ embeds: [embed] });
    }

    if (cmd === "+p") {
        let user = message.mentions.users.first() || message.author;
        let data = await getVouch(user.id);

        if (data.plus === 0 && data.minus === 0) {
            return message.reply("This user has no vouches yet.");
        }

        const embed = new EmbedBuilder()
            .setTitle(`${user.username}'s Vouch Profile`)
            .setColor("Blue")
            .addFields(
                { name: "Positive Vouches", value: `${data.plus}`, inline: true },
                { name: "Negative Vouches", value: `${data.minus}`, inline: true }
            )
            .setFooter({ text: "Goblox Bot" });

        message.reply({ embeds: [embed] });
    }
});

connectDB().then(() => {
    client.login(process.env.DISCORD_TOKEN);
});
