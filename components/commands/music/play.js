const { promisify } = require('util');
const ytdl = require('ytdl-core');
const Discord = require('discord.js');

const streamOptions = { seek: 0, volume: 1 };
const opus = require('node-opus');
const libs = require('./../../libs/');

module.exports = {
  /**
  * Play a song by searching a song title in youtube, by a youtube url, or
  * by a number in the user playlist(more will be added in relation to this).
  * @param {string} msg - A Discord message.
  * @param {number} argSeparator The index where the message is separated.
  * @param redisClient A connected and ready to use Redis client.
  * @param {string} youtubeAPI The YoutubeAPI key, used to search songs.
  */
  async cmd(msg, argSeparator, redisClient, youtubeAPI) {
    if (!redisClient || !youtubeAPI) return;
    const singleArgument = msg.content.substring(argSeparator);
    const memberVoiceChannelID = msg.member.voiceChannelID;
    const memberVC = msg.member.voiceChannel;
    const graceVC = msg.guild.me.voiceChannelID;
    const graceVCInGuild = msg.guild.voiceConnection;

    if (!memberVoiceChannelID) return msg.reply('you need to be in a voice channel :p');
    if (!singleArgument) return msg.reply('you need to tell me a song, with a name, youtube link or from your playlist.');
    if (graceVC && msg.guild.me.speaking && memberVoiceChannelID !== graceVC) return msg.reply('I\'m busy! owo');
    if (memberVoiceChannelID !== graceVC && (memberVC.joinable === false && memberVC.speakable === false && memberVC.full === true)) {
      return msg.reply(`please check my permissions for that voice chat or if it is full! I need to be able to speak and join that
        voice channel, huh.`);
    }

    const hgetAsync = promisify(redisClient.hget).bind(redisClient);
    const youtubeLinkPos = msg.content.indexOf('youtube.com/watch?v=');
    let songTitle;
    let songId;

    if (youtubeLinkPos !== -1) {
      const idFromLink = msg.content.substring(youtubeLinkPos + 20, youtubeLinkPos + 31);
      const searchResults = await libs.music.searchYoutubeSong(msg, youtubeAPI, idFromLink);
      if (!searchResults) return msg.reply('no results found :p');
      [songId, songTitle] = searchResults;
    } else if (isNaN(Number(singleArgument))) {
      const searchResults = await libs.music.searchYoutubeSong(msg, youtubeAPI, singleArgument);
      if (!searchResults) return msg.reply('no results found :p');
      [songId, songTitle] = searchResults;
    } else {
      const songNumber = Number(singleArgument) << 0;
      if (songNumber < 1 || songNumber > 15) return msg.reply('the song number doesn\'t look valid.');

      const userPlaylist = await hgetAsync(msg.author.id, 'userPlaylist');
      if (!userPlaylist) return msg.reply('that song number isn\'t in your playlist.');
      const song = libs.music.findSongByIndex(userPlaylist, songNumber);
      if (!song) return msg.reply('that song number isn\'t in your playlist.');
      const songTitlePos = song.indexOf('!SongTitle');
      songTitle = song.substring(0, songTitlePos);
      songId = song.substring(songTitlePos + 10);
    }

    if (!songTitle || !songId) return msg.reply('couldn\'t get the song title or id.');
    const stream = ytdl(`https://www.youtube.com/watch?v=${songId}`, { filter: 'audioonly' });

    let dispatcher;
    if (!graceVCInGuild) {
      const joinVC = memberVC.join();
      dispatcher = await joinVC.then(connection => connection.playStream(stream, streamOptions));
    } else if (!(msg.guild.voiceConnection.dispatcher) && msg.guild.me.speaking === false) {
      dispatcher = graceVCInGuild.playStream(stream, streamOptions);
    } else {
      libs.music.addSongToQueue(msg.guild.id, songId, songTitle, redisClient, msg);
      return;
    }

    async function endDispatcher() {
      msg.guild.voiceConnection.speaking = false;
      if (libs.music.checkForSomeoneInVC(msg.guild.voiceConnection.channel.members) === false) {
        if (msg.guild.voiceConnection) msg.guild.voiceConnection.disconnect();
        msg.guild.me.voiceChannel.leave();
        dispatcher.removeListener('end', endDispatcher);
        redisClient.del(`${msg.guild.id}_queue`);
      } else {
        const lpopAsync = promisify(redisClient.lpop).bind(redisClient);
        let nextSong = await lpopAsync(`${msg.guild.id}_queue`);
        if (!nextSong) {
          if (msg.guild.voiceConnection) msg.guild.voiceConnection.disconnect();
          msg.guild.me.voiceChannel.leave();
          dispatcher.removeListener('end', endDispatcher);
          return;
        }
        const songTitle = nextSong.substring(11);
        nextSong = nextSong.substring(0, 12);
        const newStream = ytdl(`https://www.youtube.com/watch?v=${nextSong}`, { filter: 'audioonly' });
        dispatcher = msg.guild.voiceConnection.playStream(newStream, streamOptions);
        dispatcher.once('end', endDispatcher);

        const _ = new Discord.RichEmbed()
          .setTitle(songTitle)
          .setURL(`https://www.youtube.com/watch?v=${nextSong}`)
          .setColor(11529967)
          .setThumbnail(`https://img.youtube.com/vi/${nextSong}/hqdefault.jpg`)
          .setAuthor('Song playing now');

        msg.channel.send({ embed: _ });
      }
    }

    dispatcher.once('end', endDispatcher);
    const _ = new Discord.RichEmbed()
      .setTitle(songTitle)
      .setURL(`https://www.youtube.com/watch?v=${songId}`)
      .setColor(11529967)
      .setThumbnail(`https://img.youtube.com/vi/${songId}/hqdefault.jpg`)
      .setAuthor('Song playing now');
    msg.channel.send({ embed: _ });
  },
};
