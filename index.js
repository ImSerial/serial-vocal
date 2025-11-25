const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActivityType 
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const OWNER_ID = process.env.OWNER_ID;

// ----- SQLITE -----
const db = new sqlite3.Database('./bot.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        userId TEXT,
        action TEXT,
        timestamp INTEGER
    )`);
});

// ----- CLIENT -----
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

// ----- UTILS -----
function randomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function makeEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x2F3136)
        .setDescription(description);
}

// ----- COMMANDES -----
const commands = [
    new SlashCommandBuilder()
        .setName('wakeup')
        .setDescription('Réveille un membre en le déplaçant aléatoirement et en envoyant un DM')
        .addUserOption(o => o.setName('membre').setDescription('Membre à réveiller').setRequired(true))
        .addIntegerOption(o => o.setName('fois').setDescription('Nombre de déplacements aléatoires (1-5)').setRequired(true))
        .addStringOption(o => o.setName('mp').setDescription('Message à envoyer').setRequired(true)),

    new SlashCommandBuilder()
        .setName('mp')
        .setDescription('Envoyer un message en DM avec le bot')
        .addUserOption(o => o.setName('membre').setDescription('Membre à contacter').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),

    new SlashCommandBuilder()
        .setName('find')
        .setDescription('Trouver le salon vocal d’un membre')
        .addUserOption(o => o.setName('membre').setDescription('Membre à chercher').setRequired(true)),

    new SlashCommandBuilder()
        .setName('join')
        .setDescription('Rejoindre un membre ou un salon')
        .addUserOption(o => o.setName('membre').setDescription('Membre à rejoindre').setRequired(false))
        .addChannelOption(o => o.setName('salon').setDescription('Salon à rejoindre').setRequired(false)),

    new SlashCommandBuilder()
        .setName('mv')
        .setDescription('Déplacer un membre vers un autre salon vocal')
        .addUserOption(o => o.setName('membre').setDescription('Membre à déplacer').setRequired(true))
        .addChannelOption(o => o.setName('salon').setDescription('Salon de destination').setRequired(true)),

    new SlashCommandBuilder()
        .setName('vc')
        .setDescription('Statistiques du serveur'),

    new SlashCommandBuilder()
        .setName('bot-avatar')
        .setDescription('Changer l’avatar du bot')
        .addStringOption(o => o.setName('type').setDescription('Photo ou lien').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bot-name')
        .setDescription('Changer le nom du bot')
        .addStringOption(o => o.setName('type').setDescription('Nouveau nom').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bot-status')
        .setDescription('Changer le status du bot')
        .addStringOption(o => o.setName('type')
            .setDescription('Choisir un status')
            .setRequired(true)
            .addChoices(
                { name: 'online', value: 'online' },
                { name: 'idle', value: 'idle' },
                { name: 'dnd', value: 'dnd' },
                { name: 'invisible', value: 'invisible' }
            )),

    new SlashCommandBuilder()
        .setName('bot-activities')
        .setDescription('Changer l’activité du bot')
        .addStringOption(o => o.setName('type')
            .setDescription('Choisir une activité')
            .setRequired(true)
            .addChoices(
                { name: 'Playing', value: 'playing' },
                { name: 'Watching', value: 'watching' },
                { name: 'Streaming', value: 'streaming' },
                { name: 'Competing', value: 'competing' }
            ))
        .addStringOption(o => o.setName('description').setDescription('Description').setRequired(true))
];

// ----- REGISTER COMMANDS -----
client.once('ready', async () => {
    await client.application.commands.set(commands);
    console.log(`✅ ${client.user.tag} prêt !`);
});

// ----- INTERACTIONS -----
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ embeds: [makeEmbed(`\`\`⚙️\`\` <@${interaction.user.id}> \`(${interaction.user.id})\` vous n'avez pas l'autorisation nécéssaire pour utilliser la commande`)], ephemeral: true });

    const { commandName } = interaction;

    // ---- /wakeup ----
    if (commandName === 'wakeup') {
        await interaction.deferReply();
        const member = interaction.options.getMember('membre');
        let times = interaction.options.getInteger('fois');
        const message = interaction.options.getString('mp');

        if (!member.voice.channel) return interaction.editReply(makeEmbed(`\`\`⚙️\`\` <@${member.id}> \`(${member.id})\` n’est pas en vocal !`));

        if (times < 1) times = 1;
        if (times > 5) times = 5;

        const originalChannel = member.voice.channel;
        const voiceChannels = interaction.guild.channels.cache.filter(c => c.isVoiceBased() && c.id !== originalChannel.id);

        if (voiceChannels.size === 0) return interaction.editReply(makeEmbed('``⚙️`` Aucun autre salon vocal disponible.'));

        try {
            for (let i = 0; i < times; i++) {
                const randomChannel = randomElement(Array.from(voiceChannels.values()));
                await member.voice.setChannel(randomChannel).catch(() => {});
                await new Promise(r => setTimeout(r, 800));
            }
            await member.voice.setChannel(originalChannel).catch(() => {});
            await member.send(message).catch(() => {});

            interaction.editReply({ embeds: [makeEmbed(`\`\`💤\`\` <@${member.id}> \`(${member.id})\` a été wakeup **${times}** fois | et il est bien retourné dans son salon vocal de base <#${originalChannel.id}> <#${originalChannel.id}>`)] });
            db.run(`INSERT INTO stats VALUES (?, ?, ?)`, [interaction.user.id, 'wakeup', Date.now()]);
        } catch (err) {
            console.error(err);
            interaction.editReply(makeEmbed('``⚙️`` Une erreur est survenue pendant le wakeup.'));
        }
    }

    // ---- /mp ----
    else if (commandName === 'mp') {
        const member = interaction.options.getUser('membre');
        const msg = interaction.options.getString('message');
        try {
            await member.send(msg);
            interaction.reply({ embeds: [makeEmbed(`\`\`💉\`\` Le message à belle et bien été envoyé à <@${member.id}> \`(${member.id})\``)] });
            db.run(`INSERT INTO stats VALUES (?, ?, ?)`, [interaction.user.id, 'mp', Date.now()]);
        } catch {
            interaction.reply(makeEmbed('``⚙️`` Impossible d’envoyer le message.'));
        }
    }

    // ---- /find ----
    else if (commandName === 'find') {
        const member = interaction.options.getUser('membre');
        const guildMember = interaction.guild.members.cache.get(member.id);
        if (guildMember.voice.channel) {
            interaction.reply({ embeds: [makeEmbed(`\`\`✔️\`\` <@${member.id}> \`(${member.id})\` est dans le canal vocal **${guildMember.voice.channel.name}** | <#${guildMember.voice.channel.id}>`)] });
        } else {
            interaction.reply({ embeds: [makeEmbed(`\`\`⚙️\`\` <@${member.id}> \`(${member.id})\` n’est pas en vocal`)] });
        }
    }

    // ---- /join ----
    else if (commandName === 'join') {
        const memberOption = interaction.options.getMember('membre');
        const channelOption = interaction.options.getChannel('salon');

        if (memberOption && channelOption)
            return interaction.reply({ embeds: [makeEmbed('``⚙️`` Vous ne pouvez pas utiliser **membre** et **salon** en même temps !')] });

        let targetChannel;
        if (memberOption) {
            if (!memberOption.voice.channel)
                return interaction.reply({ embeds: [makeEmbed(`\`\`⚙️\`\` <@${interaction.user.id}> \`(${interaction.user.id})\` le membre ciblé n’est pas en vocal !`)] });
            targetChannel = memberOption.voice.channel;
        } else if (channelOption) {
            if (!channelOption.isVoiceBased())
                return interaction.reply({ embeds: [makeEmbed('``⚙️`` Le salon sélectionné n’est pas un vocal !')] });
            targetChannel = channelOption;
        } else {
            return interaction.reply({ embeds: [makeEmbed('``⚙️`` Vous devez indiquer soit un membre, soit un salon !')] });
        }

        try {
            const member = interaction.member;
            if (!member.voice.channel) return interaction.reply({ embeds: [makeEmbed(`\`\`⚙️\`\` <@${member.id}> \`(${member.id})\` vous devez être en vocal pour utiliser cette commande !`)] });
            await member.voice.setChannel(targetChannel);
            interaction.reply({ embeds: [makeEmbed(`\`\`✔️\`\` <@${member.id}> \`(${member.id})\` a été déplacé vers **${targetChannel.name}** | <#${targetChannel.id}>`)] });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de vous déplacer dans le salon.')] });
        }
    }

    // ---- /mv ----
    else if (commandName === 'mv') {
        const member = interaction.options.getMember('membre');
        const channel = interaction.options.getChannel('salon');
        try {
            await member.voice.setChannel(channel);
            interaction.reply({ embeds: [makeEmbed(`\`\`🔀\`\` <@${member.id}> \`(${member.id})\` à été déplacé vers **${channel.name}** | <#${channel.id}>`)] });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de déplacer le membre.')] });
        }
    }

    // ---- /vc ----
    else if (commandName === 'vc') {
        const totalMembers = interaction.guild.memberCount;
        const onlineMembers = interaction.guild.members.cache.filter(m => m.presence?.status !== 'offline').size;
        const inVoice = interaction.guild.members.cache.filter(m => m.voice.channel).size;
        const boosts = interaction.guild.premiumSubscriptionCount;

        const desc = `\`\`👥\`\` ***Membre :*** \`\`${totalMembers}\`\`
\`\`🌍\`\` ***En Lignes :*** \`\`${onlineMembers}\`\`
\`\`🎤\`\` ***En Vocal :*** \`\`${inVoice}\`\`
\`\`🔮\`\` ***Boosts :*** \`\`${boosts}\`\``;

        const embed = new EmbedBuilder()
            .setColor(0x2F3136)
            .setTitle(`💮 ${interaction.guild.name} #Statistiques !`)
            .setURL('https://discord.gg/anyme')
            .setDescription(desc);

        interaction.reply({ embeds: [embed] });
    }

    // ---- /bot-avatar ----
    else if (commandName === 'bot-avatar') {
        const type = interaction.options.getString('type');
        try {
            await client.user.setAvatar(type);
            interaction.reply({ embeds: [makeEmbed(`\`\`💊\`\` L'avatar du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé avec succès !`)], ephemeral: true });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer l’avatar.')], ephemeral: true });
        }
    }

    // ---- /bot-name ----
    else if (commandName === 'bot-name') {
        const name = interaction.options.getString('type');
        try {
            await client.user.setUsername(name);
            interaction.reply({ embeds: [makeEmbed(`\`\`🍀\`\` Le nom du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${name}**`)], ephemeral: true });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer le nom.')], ephemeral: true });
        }
    }

    // ---- /bot-status ----
    else if (commandName === 'bot-status') {
        const status = interaction.options.getString('type');
        try {
            await client.user.setStatus(status);
            interaction.reply({ embeds: [makeEmbed(`\`\`🦋\`\` Le status du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${status}**`)], ephemeral: true });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer le status.')], ephemeral: true });
        }
    }

    // ---- /bot-activities ----
    else if (commandName === 'bot-activities') {
        const type = interaction.options.getString('type');
        const desc = interaction.options.getString('description');
        let actType, url;
        switch (type) {
            case 'playing': actType = ActivityType.Playing; break;
            case 'watching': actType = ActivityType.Watching; break;
            case 'streaming': actType = ActivityType.Streaming; url = 'https://twitch.tv/serial'; break;
            case 'competing': actType = ActivityType.Competing; break;
        }
        try {
            await client.user.setActivity(desc, type === 'streaming' ? { type: actType, url } : { type: actType });
            interaction.reply({ embeds: [makeEmbed(`\`\`🍦\`\` L'activité du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${type}**`)], ephemeral: true });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer l’activité.')], ephemeral: true });
        }
    }
});

client.login(TOKEN);
