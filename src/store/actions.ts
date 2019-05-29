import Vue from "vue";
import { ActionTree } from "vuex";
import { HttpResponse } from "vue-resource/types/vue_resource";
import SockJS from "sockjs-client";
import { State, state } from "./state";
import { parseCommands } from "../tools/ParseCommands";
// import { discordActions } from './discordActions'
import { Message } from "../types/message";
import { Connection } from "./websocket";
import { consts } from "../types/consts";
import { User } from "../types/user";
import { parseUsername } from "../tools/ParseUsername";
import Irc, {
  IrcKickEventArgs,
  IrcMessageEventArgs,
  Client,
  IrcModeEventArgs
} from "irc-framework/browser";

export const actions: ActionTree<State, any> = {
  initClient({ state, commit, dispatch }) {
    // console.log(new Irc.IrcMessage());
    const client = new Client({
      host: "irc.eternagame.org/chatws/websocket",//"localhost:3000/websocket",//
      nick: state.nick,
      username: state.currentUser.uid,
      gecos: state.currentUser.username,
      transport: Connection,
      ssl: true
    });
    client.requestCap("server-time");
    client.on("registered", e => {
        console.log(e);
        for (let channelName of state.channels) {
          const channel = client.channel(channelName);
          channel.join();
          
          channel.updateUsers(chan => {
            for (const user of channel.users)
              commit("addUser", { nick: user.nick, uid: user.ident });
            // commit("postMessage", { message: new Message("connected") });
            for (let i = 0; i < 100; i++) {
              commit("postMessage", {
                message: new Message(i.toString(), channel.name, state.currentUser)
              });
            }
          });
        }
        state.connectionData.failedAttempts = 0;
        commit("setConnected", { connected: true });
        // dispatch('loadHistory');
      });

    client.on("join", e => {
      console.log(e);
      commit("addUser", { nick: e.nick, uid: e.ident });
    });
    client.on("quit", e => {
      console.log({ quit: e });
      commit("removeUser", { nick: e.nick });
    }); //TODO: Change the param
    client.on("part", e => {
      console.log({ part: e });
      commit("removeUser", { nick: e.nick });
    }); //TODO: Change the param //TODO: Make it call another function once we implement joining specific channels (!!!!!)
    client.on("kick", e => dispatch("userKicked", { data: e })); //TODO;

    client.on("message", event => {
      console.log(event); 
      dispatch("onMessageReceived", event);
    });
    client.on("notice", event => {
      dispatch("onMessageReceived", event);
    });
    client.on("raw", event => {
      dispatch("onRawMessageRecieved", event);
    });
    client.on("mode", event => {
      dispatch("onModeMessageRecieved", event);
    });
    client.on("socket close", () => {
      console.log("sock closed");
      dispatch("onDisconnect");
    });
    client.on("socket connected", () => {
      console.log("sock connected");
      clearInterval(state.connectionData.timerInterval);
      state.connectionData.currentTimer = 0;
    });
    state.client = client;
    dispatch("connect");
  },
  connect({ state, commit, dispatch }) {
    state.client!.connect();
    state.connectionData.currentTimer = 0;
    clearInterval(state.connectionData.timerInterval);
  },
  // sendMessage({state, commit}, {message}: { message: string }) {
  //   commit('postMessage', {
  //     message: {nick: state.currentUser.nick, message, target: state.channels[state.activeTab]},
  //   });
  //   state.client!.sendMessage('privmsg', '#test', message);
  //   // state.client!.raw(`@+message-color PRIVMSG #test ${message}`);
  // },
  sendMessage(
    { state, commit, dispatch },
    { message, channel }: { message: string; channel: string }
  ) {
    function postMessage(
      message: string,
      { user = User.annonymous, isHistory = false, isAction = false } = {}
    ) {
      commit("postMessage", {
        message: new Message(message, channel, user, isAction)
      });
    }
    message = message.trim();
    let isAction = false;
    // No posting as annon or if nothing has been actually posted
    if (state.currentUser.username && message !== "") {
      let post = true;
      // Chat commands
      if (message.startsWith("/")) {
        post = false;
        let parts = message.match(/^\/([^ ]+)/);
        const command = parts ? parts[1] : "";
        parts = message.match(/^\/\w+ (.+)/);
        let params = parts ? parts[1] : "";
        // console.log({command, params});
        switch (command) {
          case "help":
            switch (params) {
              case "me":
                postMessage("/me: Posts message formatted as an action");
                postMessage("Usage: /me <message>");
                postMessage("Example: /me laughs");
                break;
              case "ignore":
                postMessage(
                  "/ignore: Don't show messages from a particular message. Show currently ignored users with /ignore-list. Unignore message with /unignore."
                );
                postMessage("Usage: /ignore <username>");
                postMessage("Example: /ignore player1");
                break;
              case "ignore-list":
                postMessage(
                  "/ignore-list: Shows currently ignored users. Ignore a message with /ignore. Unignore message with /unignore."
                );
                postMessage("Usage: /ignore-list");
                postMessage("Example: /ignore-list");
                break;
              case "unignore":
                postMessage(
                  "/unignore: Shows messages from a message after being igored. Unignores all users when username is *. Ignore a message with /ignore. Show currently ignored users with /ignore-list."
                );
                postMessage("Usage: /unignore <username>");
                postMessage("Example: /unignore player1");
                postMessage("Example: /unignore *");
                break;
              default:
                postMessage("Available commands: help, me, ignore, ignore-list, unignore");
                postMessage("Type /help <command> for information on individual commands");
                postMessage("Example: /help ignore");
                postMessage(
                  "Additional commands available via LinkBot (see the [wiki](http://eternawiki.org/wiki/index.php5/HELP) for more information)"
                );
                break;
            }
            break;
          case "me":
            if (!params) {
              postMessage(
                "Please include command parameters. Type /help me for usage instructions"
              );
              break;
            }
            isAction = true;
            post = true;
            message = params;
            break;
          case "ignore":
            if (!params) {
              postMessage(
                "Please include command parameters. Type /help ignore for more usage instructions"
              );
              break;
            }
            dispatch("ignoreUser", { username: params, channel });
            break;
          case "ignore-list":
            postMessage(`Currently ignored users: ${state.ignoredUsers.join(", ") || "none"}`);
            break;
          case "unignore":
            if (!params) {
              postMessage(
                "Please include command parameters. Type /help unignore for more usage instructions"
              );
              break;
            }
            commit("unignoreUser", { username: params, channel });
            break;
          default:
            postMessage("Invalid command. Type /help for more available commands");
            break;
        }
      }

      if (post) {
        if (!state.banned[channel]) {
          if (isAction) {
            state.client!.action(channel, message);
          } else {
            state.client!.say(channel, message);
          }
          commit("postMessage", {
            message: new Message(message, channel, state.currentUser, isAction)
          });
        } else
          commit("postedMessage", {
            message: new Message("Can't send messages because you are banned")
          }); //TODO
      }
    }
  },
  ignoreUser(
    { state, commit, dispatch },
    { username, channel }: { username: string; channel: string }
  ) {
    if (!state.ignoredUsers.includes(username)) {
      state.ignoredUsers.push(username);
      localStorage.ignoredUsers = JSON.stringify(state.ignoredUsers);
      console.log({ state: state.ignoredUsers, local: localStorage.ignoredUsers });
      commit("postMessage", {
        message: new Message(
          `Ignored ${username}. To unignore this user, either use the options menu again (on a message or the user list) or type /unignore ${username}`,
          channel
        )
      });
    } else {
      commit("postMessage", {
        message: new Message(`${username} has already been ignored`, channel)
      });
    }
  },
  sendMessageRaw({ state }) {},
  /* sendMessage({ state, commit }, { channel, message }: { channel: string | undefined; message: string }) {
      if(! channel)
          channel = state.currentChannel;
      // So Flash chat doesn't break
      message = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // Format time to work with Flash chat
      // TODO: Could use a refactor, might be able to remove this necessity after Flash is removed)
      //if (isAction) {
      //    message = UID + '_<I><FONT COLOR="#C0DCE7">' + USERNAME + "</FONT></I>_" + new Date().toUTCString().replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-3]\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([0-2]\d(?::[0-6]\d){2}) GMT/, "$1 $3 $2 $5 $4 UTC") + "_<I>" + message + "</I>";
      //} else {
      message =
        state.userData.uid +
        "_" +
        state.userData.username +
        "_" +
        new Date()
          .toUTCString()
          .replace(
            /(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-3]\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([0-2]\d(?::[0-6]\d){2}) GMT/,
            "$1 $3 $2 $5 $4 UTC"
          ) +
        "_" +
        message;
      //}
      state.sock.send("PRIVMSG " + channel + " :" + message + "\r\n");
      console.log("PRIVMSG " + channel + " :" + message + "\r\n");
      commit("postMessage", { message, isHistory: false });
    }, */
  //type === 'message'
  userKicked(
    { state, commit, dispatch },
    {
      params
    }: {
      params: IrcKickEventArgs;
    }
  ) {
    const username = parseUsername(params.nick);
    if (username === state.currentUser.username) {
      state.banned[params.channel] = consts.BAN_STATUS_BANNED;
      commit("postMessage", {
        message: new Message(
          `You have been kicked from chat${params.message ? ` - ${params.message}` : ""}`
        )
      });
    } else {
      commit("removeUser", { username: username });
    }
  },
  onMessageReceived(
    { state, commit, dispatch },
    { message, nick, tags, time, type, target }: IrcMessageEventArgs
  ) {
    console.log(time);
    const username = parseUsername(nick);
    commit("postMessage", {
      message: new Message(message, target, state.connectedUsers[username], type === "action", time)
    });
  },
  onUserQuit(
    { state, commit, dispatch },
    {
      message
    }: {
      message: any;
    }
  ) {
    commit("removeUser", { username: message });
  },
  onModeMessageRecieved({ state, commit, dispatch }, event: IrcModeEventArgs) {
    console.log({ modeEvent: event });
    for (let mode of event.modes) {
      let mute = false;
      if (mode.param && mode.param.startsWith("m;")) {
        mute = true;
        mode.param = mode.param.substr(2);
      }
      // Check if message has been either banned or muted, if so disable input and notify in chat
      if (mode.mode === "+b") {
        const maskParts = mode.param.match(/(~q:)?(.+)!.+/)!;
        console.log({ maskParts, param: mode.param });
        if (state.nick.match(new RegExp(maskParts[2].replace("*", ".+").replace("^", "\\^")))) {
          state.banned[event.target] = mute ? consts.BAN_STATUS_QUIET : consts.BAN_STATUS_BANNED;
          if (maskParts[1]) {
            commit("postMessage", {
              message: new Message(`You are no longer allowed to post in chat`, event.target)
            });
          } else {
            commit("postMessage", {
              message: new Message(
                `You have been ${mute ? "muted" : "banned"} from chat`,
                event.target
              )
            });
          }
        }
      } else if (mode.mode == "-b") {
        console.log({ param: mode.param, maskuser: mode.param.match(/(?:~q:)?(.+)!.+/)![1] });
        const maskUser = mode.param.match(/(?:~q:)?(.+)!.+/)![1];
        if (state.nick.match(new RegExp(maskUser.replace("*", ".+").replace("^", "\\^")))) {
          state.banned[event.target] = consts.BAN_STATUS_NORMAL;
          commit("postMessage", {
            message: new Message("You are now allowed to post in chat", event.target)
          });
        }
      }
    }
  },
  onRawMessageRecieved(
    { state, commit, dispatch },
    {
      line
    }: {
      line: string;
    }
  ) {
    const client = state.client!;
    let NICK = state.nick;
    console.log(line);
    const commands = parseCommands(line);
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      console.log(cmd);
      switch (cmd.command) {
        // case "433":
        //   // Nick already used, try with fallback
        //   const nickNum = parseInt(NICK.match(/\^(\d+)/)![1]) + 1;
        //   NICK = state.userData.nick = NICK.replace(/\^(\d+)/, `^${nickNum}`);
        //   client.raw(`NICK ${NICK}\r\n`);
        //   commit("changeNick", { nick: NICK });
        //   break;
        case "404":
          // Can't post message
          dispatch("onBanned", { channel: cmd.params[1] });
          break;

        case "474":
          // Can't join channel
          dispatch("onBanned", { channel: cmd.params[1] });
          break;

        // default:
        //   console.log(
        //     `[Chat] Unhandled command received. Command: ${cmd.command} Origin: ${
        //     cmd.origin
        //     } Params: ${cmd.params}`
        //   );
      }
    }
  },
  onBanned({ state, dispatch, commit }, { channel }: { channel: string }) {
    if (!state.banned[channel])
      commit("postMessage", { message: new Message("You have been banned", channel) });
    state.banned[channel] = consts.BAN_STATUS_BANNED;
  },
  onDisconnect({ state, dispatch, commit }) {
    const data = state.connectionData;
    if (data.currentTimer > 0) return; // TODO: What if connect is called and then immidiately a late "onDisconnect" arives?
    console.log("onDisconnect");
    commit("setConnected", { connected: false });
    commit("setFirstConnection", { firstConnection: false });
    if (data.failedAttempts === 0) {
      data.failedAttempts++;
      dispatch("connect");
    } else {
      data.currentTimer = data.disconnectionTimers[Math.min(data.failedAttempts - 1, 3)];
      data.failedAttempts++;
      clearInterval(data.timerInterval);
      data.timerInterval = setInterval(() => dispatch("updateTimer"), 1000);
    }
  },
  updateTimer({ state, commit, dispatch }) {
    commit("connectionTimerTick");
    console.log(state.connectionData.currentTimer);
    if (state.connectionData.currentTimer <= 0) {
      console.log("connect");
      dispatch("connect");
    }
  }
};
