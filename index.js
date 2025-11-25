// index.js (final, modifié)
const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActivityType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const OWNER_ID = process.env.OWNER_ID;

// ----- SQLITE -----
const db = new sqlite3.Database('./bot.db');
db.serialize(() => {
    // log table
    db.run(`CREATE TABLE IF NOT EXISTS stats (
        userId TEXT,
        action TEXT,
        timestamp INTEGER
    )`);

    // toutou table: store original nickname (nullable), addedBy, timestamp
    db.run(`CREATE TABLE IF NOT EXISTS toutou (
        userId TEXT PRIMARY KEY,
        originalNick TEXT,
        addedBy TEXT,
        addedAt INTEGER
    )`);

    // chut table: now stores originalNick as well so we can restore nickname on remove
    db.run(`CREATE TABLE IF NOT EXISTS chut (
        userId TEXT PRIMARY KEY,
        originalNick TEXT,
        addedBy TEXT,
        addedAt INTEGER
    )`);
});

// ----- CLIENT -----
// add partials for reactions/messages/users to ensure reaction removal works reliably
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

// ----- HELPERS -----
function randomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function makeEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x2F3136)
        .setDescription(description);
}

function noPermEmbed(userId) {
    return makeEmbed(`\`\`⚙️\`\` <@${userId}> \`(${userId})\` vous n'avez pas l'autorisation nécéssaire pour utilliser la commande`);
}

// helper to store toutou
function addToutouRecord(userId, originalNick, addedBy) {
    db.run(
        `INSERT OR REPLACE INTO toutou (userId, originalNick, addedBy, addedAt) VALUES (?, ?, ?, ?)`,
        [userId, originalNick, addedBy, Date.now()]
    );
}

// helper to remove toutou record and return original nick via callback
function removeToutouRecord(userId, cb) {
    db.get(`SELECT originalNick FROM toutou WHERE userId = ?`, [userId], (err, row) => {
        if (err) return cb(err);
        db.run(`DELETE FROM toutou WHERE userId = ?`, [userId], (dErr) => cb(dErr, row ? row.originalNick : null));
    });
}

// helper to add chut record (with originalNick)
function addChutRecord(userId, originalNick, addedBy) {
    db.run(
        `INSERT OR REPLACE INTO chut (userId, originalNick, addedBy, addedAt) VALUES (?, ?, ?, ?)`,
        [userId, originalNick, addedBy, Date.now()]
    );
}

// helper to remove chut record and return original nick via callback
function removeChutRecord(userId, cb) {
    db.get(`SELECT originalNick FROM chut WHERE userId = ?`, [userId], (err, row) => {
        if (err) return cb(err);
        db.run(`DELETE FROM chut WHERE userId = ?`, [userId], (dErr) => cb(dErr, row ? row.originalNick : null));
    });
}

// helper to check if user is in chut
function isChut(userId, cb) {
    db.get(`SELECT userId FROM chut WHERE userId = ?`, [userId], (err, row) => {
        if (err) return cb(err, false);
        cb(null, !!row);
    });
}

// ----- COMMANDES (registre) -----
const commands = [
    // existing commands (wakeup, mp, find, join, mv, vc, bot-avatar, bot-name, bot-status, bot-activities, bringcc, access)
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
        .addStringOption(o => o.setName('description').setDescription('Description').setRequired(true)),

    new SlashCommandBuilder()
        .setName('bringcc')
        .setDescription('Déplacer les membres dans des salons vocaux aléatoires d\'une catégorie')
        .addStringOption(o => o.setName('categorie').setDescription('ID de la catégorie').setRequired(true)),

    new SlashCommandBuilder()
        .setName('access')
        .setDescription('Donner l’accès à un salon vocal ou textuel à un membre')
        .addUserOption(o => o.setName('membre').setDescription('Membre à autoriser').setRequired(true))
        .addChannelOption(o => o.setName('salon').setDescription('Salon à autoriser').setRequired(true)),

    // --- toutou (with choices)
    new SlashCommandBuilder()
        .setName('toutou')
        .setDescription('Gérer la liste des toutous')
        .addStringOption(o => o.setName('action').setDescription('Action : add / remove / list').setRequired(true)
            .addChoices(
                { name: 'add', value: 'add' },
                { name: 'remove', value: 'remove' },
                { name: 'list', value: 'list' }
            ))
        .addUserOption(o => o.setName('membre').setDescription('Membre cible').setRequired(false)),

    // --- chut (with choices)
    new SlashCommandBuilder()
        .setName('chut')
        .setDescription('Gérer la liste des chut')
        .addStringOption(o => o.setName('action').setDescription('Action : add / remove / list').setRequired(true)
            .addChoices(
                { name: 'add', value: 'add' },
                { name: 'remove', value: 'remove' },
                { name: 'list', value: 'list' }
            ))
        .addUserOption(o => o.setName('membre').setDescription('Membre cible').setRequired(false)),

    // --- help
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Affiche l\'aide du bot')
];

// ----- REGISTER COMMANDS -----
client.once('ready', async () => {
    await client.application.commands.set(commands);
    console.log(`✅ ${client.user.tag} prêt !`);
});

// ----- EVENTS: messageCreate & messageReactionAdd & voiceStateUpdate (pour chut & follow toutou) -----

// messageCreate: supprimer les messages des users "chut"
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    db.get(`SELECT userId FROM chut WHERE userId = ?`, [message.author.id], async (err, row) => {
        if (err) return console.error(err);
        if (row) {
            // supprime le message immédiatement (aucun ping ni embed)
            try { await message.delete().catch(() => {}); } catch(e) {}
        }
    });
});

// messageReactionAdd: empêcher les reactions des users "chut"
client.on('messageReactionAdd', async (reaction, user) => {
    try {
        if (!reaction || !user || user.bot) return;

        // if partials, fetch as needed
        if (reaction.partial) {
            try { await reaction.fetch(); } catch (e) { /* ignore */ }
        }

        db.get(`SELECT userId FROM chut WHERE userId = ?`, [user.id], async (err, row) => {
            if (err) return console.error(err);
            if (row) {
                // remove the reaction added by the user
                try { await reaction.users.remove(user.id).catch(() => {}); } catch (e) {}
            }
        });
    } catch (e) {
        console.error('reaction handler error', e);
    }
});

// voiceStateUpdate: - pour chut (déco instant) - pour suivi toutou quand staff bouge
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        const guild = newState.guild || oldState.guild;
        // 1) CHUT handling: si user rejoint / switch vocal et est dans chut => disconnect
        const userId = newState.member?.id ?? oldState.member?.id;
        if (userId) {
            db.get(`SELECT userId FROM chut WHERE userId = ?`, [userId], async (err, row) => {
                if (err) return console.error(err);
                if (row) {
                    // If they are connected now (newState.channel), kick them out by moving to null
                    if (newState.channel) {
                        try {
                            // prefer disconnect() when available
                            if (newState.member && newState.member.voice && typeof newState.member.voice.disconnect === 'function') {
                                await newState.member.voice.disconnect().catch(async () => { await newState.member.voice.setChannel(null).catch(() => {}); });
                            } else {
                                await newState.member.voice.setChannel(null).catch(() => {});
                            }
                        } catch(e){
                            // ignore
                        }
                    }
                }
            });
        }

        // 2) Toutou follow: if a staff (someone who added toutous) moved channels, move their toutous
        // detect staff movement: oldState.channel !== newState.channel
        const movedMember = newState.member;
        if (!movedMember) return;
        const movedId = movedMember.id;
        if ((oldState.channel?.id ?? null) !== (newState.channel?.id ?? null)) {
            // find toutous where addedBy == movedId
            db.all(`SELECT userId FROM toutou WHERE addedBy = ?`, [movedId], async (err, rows) => {
                if (err) return console.error(err);
                if (!rows || rows.length === 0) return;
                if (!newState.channel) {
                    // staff left voice: do nothing
                    return;
                }
                // move each toutou who is currently in voice to staff's new channel
                for (const r of rows) {
                    try {
                        const memberToMove = await guild.members.fetch(r.userId).catch(() => null);
                        if (memberToMove && memberToMove.voice.channel) {
                            await memberToMove.voice.setChannel(newState.channel).catch(() => {});
                        }
                    } catch(e) {
                        // ignore per-member errors
                    }
                }
            });
        }
    } catch (e) {
        console.error('voiceStateUpdate error', e);
    }
});

// ----- INTERACTIONS -----
client.on('interactionCreate', async interaction => {
    // handle button interactions from help embed
    if (interaction.isButton && interaction.isButton()) {
        const id = interaction.customId;
        if (id === 'help_toutou') {
            return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x2F3136).setDescription('`/toutou add membre: @user` — ajouter\n`/toutou remove membre: @user` — retirer\n`/toutou list` — lister')] });
        }
        if (id === 'help_chut') {
            return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x2F3136).setDescription('`/chut add membre: @user` — ajouter\n`/chut remove membre: @user` — retirer\n`/chut list` — lister')] });
        }
        if (id === 'help_vc') {
            return interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setColor(0x2F3136).setDescription('`/vc` — Affiche les statistiques du serveur (membres, en-ligne, en-vocal, boosts)')] });
        }
        // unknown button
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    // uniform permission check (owner-only)
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ embeds: [noPermEmbed(interaction.user.id)], ephemeral: true });

    const { commandName } = interaction;

    // ---------------- /wakeup ----------------
    if (commandName === 'wakeup') {
        await interaction.deferReply();
        const member = interaction.options.getMember('membre');
        let times = interaction.options.getInteger('fois');
        const message = interaction.options.getString('mp');

        if (!member || !member.voice.channel) return interaction.editReply(makeEmbed(`\`\`⚙️\`\` <@${member ? member.id : '???'}> \`(${member ? member.id : '???'})\` n’est pas en vocal !`));

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
        return;
    }

    // ---------------- /mp ----------------
    if (commandName === 'mp') {
        const member = interaction.options.getUser('membre');
        const msg = interaction.options.getString('message');
        try {
            await member.send(msg);
            interaction.reply({ embeds: [makeEmbed(`\`\`💉\`\` Le message à belle et bien été envoyé à <@${member.id}> \`(${member.id})\``)] });
            db.run(`INSERT INTO stats VALUES (?, ?, ?)`, [interaction.user.id, 'mp', Date.now()]);
        } catch {
            interaction.reply({ embeds: [noPermEmbed(interaction.user.id)] });
        }
        return;
    }

    // ---------------- /find ----------------
    if (commandName === 'find') {
        const member = interaction.options.getUser('membre');
        const guildMember = interaction.guild.members.cache.get(member.id) || await interaction.guild.members.fetch(member.id).catch(() => null);
        if (guildMember && guildMember.voice.channel) {
            interaction.reply({ embeds: [makeEmbed(`\`\`✔️\`\` <@${member.id}> \`(${member.id})\` est dans le canal vocal **${guildMember.voice.channel.name}** | <#${guildMember.voice.channel.id}>`)] });
        } else {
            interaction.reply({ embeds: [makeEmbed(`\`\`⚙️\`\` <@${member.id}> \`(${member.id})\` n’est pas en vocal`)] });
        }
        return;
    }

    // ---------------- /join ----------------
    if (commandName === 'join') {
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
        return;
    }

    // ---------------- /mv ----------------
    if (commandName === 'mv') {
        const member = interaction.options.getMember('membre');
        const channel = interaction.options.getChannel('salon');
        try {
            await member.voice.setChannel(channel);
            interaction.reply({ embeds: [makeEmbed(`\`\`🔀\`\` <@${member.id}> \`(${member.id})\` à été déplacé vers **${channel.name}** | <#${channel.id}>`)] });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de déplacer le membre.')] });
        }
        return;
    }

    // ---------------- /vc ----------------
    if (commandName === 'vc') {
        const totalMembers = interaction.guild.memberCount;
        const onlineMembers = interaction.guild.members.cache.filter(m => m.presence?.status !== 'offline').size;
        const inVoice = interaction.guild.members.cache.filter(m => m.voice.channel).size;
        const boosts = interaction.guild.premiumSubscriptionCount || 0;

        const desc = `\`\`👥\`\` ***Membre :*** \`\`${totalMembers}\`\`
\`\`🌍\`\` ***En Lignes :*** \`\`${onlineMembers}\`\`
\`\`🎤\`\` ***En Vocal :*** \`\`${inVoice}\`\`
\`\`🔮\`\` ***Boosts :*** \`\`${boosts}\`\``;

        const embed = new EmbedBuilder()
            .setColor(0x2F3136)
            .setTitle(`💮${interaction.guild.name} #Statistiques !`)
            .setURL('https://discord.gg/anyme')
            .setThumbnail(interaction.guild.iconURL({ size: 1024 }))
            .setImage(interaction.guild.bannerURL?.({ size: 1024 }) ?? null)
            .setDescription(desc);

        interaction.reply({ embeds: [embed] });
        return;
    }

    // ---------------- /bot-avatar ----------------
    if (commandName === 'bot-avatar') {
        const type = interaction.options.getString('type');
        try {
            await client.user.setAvatar(type);
            interaction.reply({ embeds: [makeEmbed(`\`\`💊\`\` L'avatar du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé avec succès !`)] });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer l’avatar.')] });
        }
        return;
    }

    // ---------------- /bot-name ----------------
    if (commandName === 'bot-name') {
        const name = interaction.options.getString('type');
        try {
            await client.user.setUsername(name);
            interaction.reply({ embeds: [makeEmbed(`\`\`🍀\`\` Le nom du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${name}**`)] });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer le nom.')] });
        }
        return;
    }

    // ---------------- /bot-status ----------------
    if (commandName === 'bot-status') {
        const status = interaction.options.getString('type');
        try {
            await client.user.setStatus(status);
            interaction.reply({ embeds: [makeEmbed(`\`\`🦋\`\` Le status du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${status}**`)] });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer le status.')] });
        }
        return;
    }

    // ---------------- /bot-activities ----------------
    if (commandName === 'bot-activities') {
        const type = interaction.options.getString('type');
        const descAct = interaction.options.getString('description');
        let actType, url;
        switch (type) {
            case 'playing': actType = ActivityType.Playing; break;
            case 'watching': actType = ActivityType.Watching; break;
            case 'streaming': actType = ActivityType.Streaming; url = 'https://twitch.tv/serial'; break;
            case 'competing': actType = ActivityType.Competing; break;
        }
        try {
            await client.user.setActivity(descAct, type === 'streaming' ? { type: actType, url } : { type: actType });
            interaction.reply({ embeds: [makeEmbed(`\`\`🍦\`\` L'activité du bot <@${client.user.id}> \`(${client.user.id})\` à bien été changé en **${type}**`)] });
        } catch {
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de changer l’activité.')] });
        }
        return;
    }

    // ---------------- /bringcc ----------------
    if (commandName === 'bringcc') {
        const categoryId = interaction.options.getString('categorie');
        const category = interaction.guild.channels.cache.get(categoryId);
        if (!category || category.type !== 4) return interaction.reply({ embeds: [makeEmbed('``⚙️`` Catégorie invalide !')] });

        const voiceChannels = category.children.filter(c => c.isVoiceBased());
        if (voiceChannels.size === 0) return interaction.reply({ embeds: [makeEmbed('``⚙️`` Aucun salon vocal dans cette catégorie !')] });

        const membersToMove = interaction.guild.members.cache.filter(m => m.voice.channel);
        membersToMove.forEach(member => {
            const randomChannel = randomElement(Array.from(voiceChannels.values()));
            member.voice.setChannel(randomChannel).catch(() => {});
        });

        interaction.reply({ embeds: [makeEmbed(`\`\`🔀\`\` Tous les membres en vocal ont été déplacés aléatoirement dans la catégorie <#${category.id}>`)] });
        return;
    }

    // ---------------- /access ----------------
    if (commandName === 'access') {
        const member = interaction.options.getMember('membre');
        const channel = interaction.options.getChannel('salon');

        try {
            if (channel.isVoiceBased()) {
                await channel.permissionOverwrites.edit(member.id, { Connect: true, Speak: true });
            } else {
                await channel.permissionOverwrites.edit(member.id, { SendMessages: true });
            }
            interaction.reply({ embeds: [makeEmbed(`\`\`✔️\`\` <@${member.id}> \`(${member.id})\` a reçu l'accès au salon **${channel.name}** | <#${channel.id}>`)] });
        } catch (err) {
            console.error(err);
            interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de modifier les permissions.')] });
        }
        return;
    }

    // ---------------- /toutou (add / remove / list) ----------------
    if (commandName === 'toutou') {
        const action = (interaction.options.getString('action') || '').toLowerCase();
        const target = interaction.options.getMember('membre');

        if (action === 'list') {
            // list all toutous (mention users)
            db.all(`SELECT userId, addedBy FROM toutou`, [], async (err, rows) => {
                if (err) return interaction.reply({ embeds: [makeEmbed('``⚙️`` Erreur lors de la lecture de la base.')] });
                if (!rows || rows.length === 0) return interaction.reply({ embeds: [makeEmbed('``✔️`` Aucun utilisateur dans la liste des toutous.')] });

                let desc = '';
                for (const r of rows) {
                    const adderMention = r.addedBy ? `<@${r.addedBy}>` : r.addedBy;
                    desc += `\`\`🐕\`\` <@${r.userId}> — ajouté par ${adderMention}\n`;
                }
                interaction.reply({ embeds: [makeEmbed(desc)] });
            });
            return;
        }

        if (!target) return interaction.reply({ embeds: [makeEmbed('``⚙️`` Vous devez indiquer un membre pour add/remove !')] });

        if (action === 'add') {
            try {
                // store original nickname (server nickname if any, else username)
                const originalNick = target.nickname ?? target.user.username;
                const addedBy = interaction.user.id;
                addToutouRecord(target.id, originalNick, addedBy);

                // change nickname: "🐕 original (👑 staffUsername)" using staff global username (Option B)
                const staffName = interaction.user.username; // Option B
                const newNick = `🐕 ${originalNick} (👑 ${staffName})`;

                await target.setNickname(newNick).catch(() => {});
                // If staff is in voice, move target to staff channel and enable follow behavior later
                if (interaction.member && interaction.member.voice.channel) {
                    await target.voice.setChannel(interaction.member.voice.channel).catch(() => {});
                }
                interaction.reply({ embeds: [makeEmbed(`\`\`🐕\`\` <@${target.id}> \`(${target.id})\` a été ajouté à la liste des toutous par <@${interaction.user.id}>`)] });
            } catch (err) {
                console.error(err);
                interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible d\'ajouter en toutou.')] });
            }
            return;
        }

        if (action === 'remove') {
            removeToutouRecord(target.id, async (err, originalNick) => {
                if (err) {
                    console.error(err);
                    return interaction.reply({ embeds: [makeEmbed('``⚙️`` Erreur lors de la suppression.')] });
                }
                // if not found in DB, respond with embed error
                if (!originalNick) {
                    return interaction.reply({ embeds: [makeEmbed(`\`\`⚙️\`\` <@${target.id}> \`(${target.id})\` n'est pas dans la liste des toutous.`)], ephemeral: true });
                }
                try {
                    // restore original nickname if available
                    if (originalNick) {
                        await target.setNickname(originalNick).catch(() => {});
                    } else {
                        // no original found: try to reset nickname to null
                        await target.setNickname(null).catch(() => {});
                    }
                    interaction.reply({ embeds: [makeEmbed(`\`\`✔️\`\` <@${target.id}> \`(${target.id})\` a été retiré de la liste des toutous et son pseudo a été réinitialisé.`)] });
                } catch (e) {
                    console.error(e);
                    interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de réinitialiser le pseudo.')] });
                }
            });
            return;
        }

        // unknown action
        return interaction.reply({ embeds: [makeEmbed('``⚙️`` Action invalide — utilisez add / remove / list')] });
    }

    // ---------------- /chut (add / remove / list) ----------------
    if (commandName === 'chut') {
        const action = (interaction.options.getString('action') || '').toLowerCase();
        const target = interaction.options.getMember('membre');

        if (action === 'list') {
            db.all(`SELECT userId, addedBy FROM chut`, [], async (err, rows) => {
                if (err) return interaction.reply({ embeds: [makeEmbed('``⚙️`` Erreur lors de la lecture de la base.')] });
                if (!rows || rows.length === 0) return interaction.reply({ embeds: [makeEmbed('``✔️`` Aucun utilisateur dans la liste des chut.')] });

                let desc = '';
                for (const r of rows) {
                    desc += `\`\`🔇\`\` <@${r.userId}> — ajouté par <@${r.addedBy}>\n`;
                }
                interaction.reply({ embeds: [makeEmbed(desc)] });
            });
            return;
        }

        if (!target) return interaction.reply({ embeds: [makeEmbed('``⚙️`` Vous devez indiquer un membre pour add/remove !')] });

        if (action === 'add') {
            try {
                // store original nickname (server nickname if any, else username) for chut
                const originalNick = target.nickname ?? target.user.username;
                const addedBy = interaction.user.id;
                addChutRecord(target.id, originalNick, addedBy);

                // rename like toutou but with 🔇 emoji and staff username
                const staffName = interaction.user.username;
                const newNick = `🔇 ${originalNick} (👑 ${staffName})`;
                await target.setNickname(newNick).catch(() => {});

                // If target is currently in voice, disconnect immediately (Option 1)
                if (target.voice && target.voice.channel) {
                    try {
                        if (typeof target.voice.disconnect === 'function') {
                            await target.voice.disconnect().catch(async () => { await target.voice.setChannel(null).catch(() => {}); });
                        } else {
                            await target.voice.setChannel(null).catch(() => {});
                        }
                    } catch(e){ /* ignore */ }
                }

                interaction.reply({ embeds: [makeEmbed(`\`\`🔀\`\` <@${target.id}> \`(${target.id})\` a été ajouté à la liste des chut par <@${interaction.user.id}>`)] });
            } catch (err) {
                console.error(err);
                interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible d\'ajouter en chut.')] });
            }
            return;
        }

        if (action === 'remove') {
            // fetch originalNick then delete and restore
            db.get(`SELECT originalNick FROM chut WHERE userId = ?`, [target.id], async (err, row) => {
                if (err) {
                    console.error(err);
                    return interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de vérifier la base.')] });
                }
                if (!row) {
                    return interaction.reply({ embeds: [makeEmbed(`\`\`⚙️\`\` <@${target.id}> \`(${target.id})\` n'est pas dans la liste des chut.`)], ephemeral: true });
                }

                const originalNick = row.originalNick;

                db.run(`DELETE FROM chut WHERE userId = ?`, [target.id], async (err2) => {
                    if (err2) {
                        console.error(err2);
                        return interaction.reply({ embeds: [makeEmbed('``⚙️`` Impossible de retirer de la liste.')] });
                    }

                    // restore nickname
                    try {
                        if (originalNick) {
                            await target.setNickname(originalNick).catch(() => {});
                        } else {
                            await target.setNickname(null).catch(() => {});
                        }
                    } catch (e) {
                        console.error(e);
                    }

                    interaction.reply({ embeds: [makeEmbed(`\`\`✔️\`\` <@${target.id}> \`(${target.id})\` a été retiré de la liste des chut et son pseudo a été réinitialisé.`)] });
                });
            });
            return;
        }

        return interaction.reply({ embeds: [makeEmbed('``⚙️`` Action invalide — utilisez add / remove / list')] });
    }

    // ---------------- /help ----------------
    if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle(`💮 ${interaction.guild.name} #Statistiques !`)
            .setColor(0x2F3136)
            .setDescription('**Commandes disponibles**')
            .addFields(
                { name: '/wakeup', value: '`/wakeup membre: @user fois: 1-5 mp: "message"`', inline: false },
                { name: '/mp', value: '`/mp membre: @user message: "text"`', inline: false },
                { name: '/find', value: '`/find membre: @user`', inline: false },
                { name: '/join', value: '`/join membre: @user` ou `/join salon: #voice`', inline: false },
                { name: '/mv', value: '`/mv membre: @user salon: #voice`', inline: false },
                { name: '/vc', value: '`/vc` (statistiques)', inline: false },
                { name: '/toutou', value: '`/toutou add/remove/list membre:@user`', inline: false },
                { name: '/chut', value: '`/chut add/remove/list membre:@user`', inline: false },
                { name: '/bringcc', value: '`/bringcc categorie: ID`', inline: false },
                { name: '/access', value: '`/access membre: @user salon: #channel`', inline: false },
                { name: '/bot-avatar|bot-name|bot-status|bot-activities', value: 'Commandes bot (owner only)', inline: false }
            )
            .setFooter({ text: 'Cliquez sur un bouton pour voir un usage rapide (réponse éphémère).' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('help_toutou').setLabel('Toutou').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('help_chut').setLabel('Chut').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('help_vc').setLabel('VC Stats').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [helpEmbed], components: [row], ephemeral: true });
    }

});

// ----- LOGIN -----
client.login(TOKEN);
