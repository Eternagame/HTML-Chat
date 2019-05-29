// jQuery and jQuery-ui
import $ from 'jquery';
import 'jquery-ui/ui/widgets/tabs';
import 'jquery-ui/ui/widgets/dialog';
import 'jquery-ui/ui/widgets/button';
import 'jquery-ui/ui/position';
import 'jquery-ui/themes/base/core.css';
import 'jquery-ui/themes/base/tabs.css';
import 'jquery-ui/themes/base/menu.css';
import 'jquery-ui/themes/base/dialog.css';
import 'jquery-ui/themes/base/button.css';

// mCustomScrollbar
import scrollbar from 'malihu-custom-scrollbar-plugin';

// Context Menu
import 'ui-contextmenu';

// Markdown-it
import MarkdownIt from 'markdown-it';

// SockJS
import SockJS from 'sockjs-client';

// Our assets
import './polyfills';
import { CHAT_CHANNEL, CURRENT_USER, WORKBRANCH } from './define-user';
import '../css/chat.css';

scrollbar($);

window.$ = window.jQuery = $;
const md = new MarkdownIt({
  linkify: true,
  typographer: true,
}).disable('image');
// Via https://github.com/markdown-it/markdown-it/blob/e6f19eab4204122e85e4a342e0c1c8486ff40c2d/docs/architecture.md
const defaultRender = md.renderer.rules.link_open || function (tokens, idx, options, env, self) {
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  // If you are sure other plugins can't add `target` - drop check below
  const aIndex = tokens[idx].attrIndex('target');

  if (aIndex < 0) {
    tokens[idx].attrPush(['target', '_blank']); // add new attribute
  } else {
    tokens[idx].attrs[aIndex][1] = '_blank'; // replace value of existing attr
  }

  // pass token to default renderer.
  return defaultRender(tokens, idx, options, env, self);
};

// Create an instance of markdown-it with no rules enabled, using it just to strip/sanitize HTML
const mdSanitizer = new MarkdownIt('zero');

// Username, if not logged in "Annonymous"
const USERNAME = CURRENT_USER ? CURRENT_USER.name : 'Anonymous';
// User ID, if not logged in "0"
const UID = CURRENT_USER ? CURRENT_USER.uid : 0;
// Replace invalid IRC nick characters with "-" (or _ if first char), limit its length (max is 32, minux 2 for __ and minus a max of 3 for ^##, then subtract the UID length), and add UID and initial connection number
let NICK = `${USERNAME.replace(/^[^a-zA-Z\x5B-\x60\x7B-\x7D]/, '_').replace(/[^a-zA-Z\x5B-\x60\x7B-\x7D\d-]/g, '-').substr(0, 27-String(UID).length)}__${UID}^1`;
// If no channel has been specified via development-message, connect to #global
const CHANNEL = CHAT_CHANNEL;

// Online users
const onlineUsers = [];

let failedAttempts = 1;
const disconnectionTimers = [5, 10, 15, 30];
let currentTimer = 0;
let timerInterval;

const postedMessages = [];
const toBePosted = [];
let connected = false;
let firstConnection = true;

// Initialize saved preferences
try {
  var persistantSettings = localStorage;
} catch (e) {
  console.warn('Local storage not available (either unsupported or permission denied) - message preferences will not be saved');
  var persistantSettings = {};
}
let ignoredUsers = persistantSettings.chatIgnored ? persistantSettings.chatIgnored.split(',') : [];
// Chat should start automaticcally scrolling as new messages come in
let chatAutoScroll = 'bottom';

let sock;

// DEBUG ONLY
function getSock() {
  return sock;
}

/**
 *  Parse messages sent by server
 *  @param data: Raw data sent by server
 *  @return: Array of parsed messages
 */
function parseCommands(data) {
  let msgs; let
    portions;
  // Split into individual messages (commands)
  msgs = data.split('\r\n');
  // The presence of \r\n at the end causes an extra element, remove it
  msgs.pop();
  for (let i=0; i<msgs.length; i++) {
    // Split into prefix, command, params, and trailer (does not represent RFC1459/2812 specs, only what's needed to parse)
    portions = msgs[i].match(/(?::([^ ]+) )?([^ ]+)((?: (?:[^ :])[^ ]*)*)?(?: :(.+))?/);
    msgs[i] = {};
    msgs[i].origin = portions[1];
    msgs[i].command = portions[2];
    // Fill in params, if a trailer exists, append it (if there are no normal params, sure there's an array)
    msgs[i].params = [];
    if (portions[3]) {
      msgs[i].params = msgs[i].params.concat(portions[3].trim().split(' '));
    }
    if (portions[4]) {
      msgs[i].params.push(portions[4]);
    }
  }
  return msgs;
}

/**
 *  Returns object of onlineUsers which has the given username
 *  @param username: Nick of message to search for
 *  @return: Found element of onlineUsers
 */
function onlineUserWithName(username) {
  const res = $.grep(onlineUsers, o => o.name==username.toLowerCase())[0];
  if (!res) return false;
  res.index = onlineUsers.indexOf(res);
  return res;
}

/**
 *  When a message joins, make sure they're on the online list
 *  @param username: Nick of joining message
 */
function addUser(username) {
  let portions; let uid; let
    userli;
  const usernamesToIgnore = ['Anonymous', 'history', 'ChatBot'];
  const ircIds = {
    hoglahoo: 36921,
    Nando: 49507,
    machinelves: 2577,
    LinkBot: 126938,
    LFP6: 48290,
    jnicol: 48166,
    staryjess: 11775,
    bro: 24263,
    brourd: 24263,
  };

  // Parse automatic suffix
  portions = username.match(/(?:^(.+)(?:__(\d+)\^\d+))|(.+)/);
  // If userid is included, get it, if it's an IRC regular, get their userID from the list
  uid = portions[2]|| ircIds[username] || 0;
  // Get actual username
  username = portions[1] || portions[3];
  // Remove @ from Op's username
  if (username[0] == '@') {
    username = username.slice(1);
  }

  // If the message isn't online and isn't to be ignored, add it to the page in the right place and keep track of it
  if (usernamesToIgnore.includes(username)) return;

  if (!onlineUserWithName(username)) {
    onlineUsers.push({ name: username.toLowerCase(), connections: 1, id: uid });
    onlineUsers.sort((userA, userB) => {
      if (userA.name < userB.name) return -1;
      if (userA.name > userB.name) return 1;
      return 0;
    });

    userli = '<li id="chat-userlist-message-{USERNAME_LOW}" class="chat-userlist-message"><a target="_blank" href="http://{WORKBRANCH}/web/player/{UID}/">{USERNAME}</a>{OPTS}</li>';
    userli = userli.replace('{USERNAME_LOW}', username.toLowerCase())
      .replace('{USERNAME}', username)
      .replace('{UID}', uid)
      .replace('{OPTS}', USERNAME !== 'Anonymous' ? '<a class="chat-message-options">&vellip;</a>' : '')
      .replace('{WORKBRANCH}', WORKBRANCH);

    // If there's a message ahead of this one in the array, insert it before that one in the list, else add to the end
    if (onlineUsers[onlineUserWithName(username).index+1]) {
      $(userli).insertBefore(`li#chat-userlist-user-${onlineUsers[onlineUserWithName(username).index+1].name}`);
    } else {
      $('#chat-users-list').append(userli);
    }
    $('#chat-users-online').html(parseInt($('#chat-users-online').html()) + 1);
  } else {
    onlineUsers[onlineUserWithName(username).index].connections++;
  }
}

/**
 *  When a message leaves, remove them from the list
 *  @param username: Nick of parting/quitting message
 */
function removeUser(username) {
  const usernamesToIgnore = ['Anonymous', 'history', 'ChatBot'];

  username = username.match(/(?:^(.+)(?:__(\d+)\^\d+))|(.+)/);
  // Get actual username
  username = username[1] || username[3];
  // Remove @ from Op's username
  if (username[0] == '@') {
    username = username.slice(1);
  }

  if (usernamesToIgnore.includes(username)) return;

  if (onlineUsers[onlineUserWithName(username).index].connections == 1) {
    onlineUsers.splice(onlineUserWithName(username).index, 1);
    $(`li#chat-userlist-user-${username.toLowerCase()}`).remove();
    $('#chat-users-online').html(parseInt($('#chat-users-online').html()) - 1);
  } else {
    onlineUsers[onlineUserWithName(username).index].connections--;
  }
}

/**
 *  HTML escape regular expression
 *  @param search: Regex search stirng
 *  @param mod: Regex modifier string
 *  @return: Encoded regex
 */
function encodedRegex(search) {
  let mod= '';
  if (search.global) { mod += 'g'; }
  if (search.multiline) { mod += 'm'; }
  if (search.ignoreCase) { mod += 'i'; }

  return new RegExp(search.source.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;'),
  mod);
}

/**
 *  Add color to a username based on the UID in the message or font tags
 *  @param data: Username to be colored
 *  @param uid: UID to use for determining default color
 *  @param isAction: boolean indicating if the message is an action. May need to be reworked once Flash chat is dropped to better coincide with IRC specs
 *  @return: Formatted username HTML
 */
function colorizeUser(data, uid, isAction) {
  const colors = ['#f39191', '#f39691', '#f39b91', '#f39f91', '#f3a491', '#f3a891', '#f3ad91', '#f3b191', '#f3b691', '#f3ba91', '#f3bf91', '#f3c491', '#f3c891', '#f3cd91', '#f3d191', '#f3d691', '#f3da91', '#f3df91', '#f3e491', '#f3e891', '#f3ed91', '#f3f191', '#f0f391', '#ebf391', '#e7f391', '#e2f391', '#ddf391', '#d9f391', '#d4f391', '#d0f391', '#cbf391', '#c7f391', '#c2f391', '#bef391', '#b9f391', '#b4f391', '#b0f391', '#abf391', '#a7f391', '#a2f391', '#9ef391', '#99f391', '#94f391', '#91f393', '#91f398', '#91f39c', '#91f3a1', '#91f3a5', '#91f3aa', '#91f3ae', '#91f3b3', '#91f3b7', '#91f3bc', '#f391ba', '#f391b6', '#f391b1', '#f391ad', '#f391a8', '#f391a4', '#f3919f', '#f3919b', '#f39196'];
  // Find escaped font tags, and replace them with a span and the hex color signified, if it's an action remove the tag
  const customColored = data.replace(/&lt;font color=(?:&#x27;|\&quot;)?(#[a-fA-F\d]{6})(?:&#x27;|\&quot;)?&gt;(.+)&lt;\/font&gt;/i, isAction ? '$2':'<span style="color:$1;">$2</span>');
  // Construct span, if it's an action omit the coloring
  return `<a target="_blank" class="chat-message-user-link" href="http://${WORKBRANCH}/web/player/${uid}/"><span class="chat-message-user" ${isAction ? '' : `style="color:${colors[uid % colors.length]};"`}>${customColored}</span></a>${!isAction ? ': ' : ' '}`;
}

/**
 *  Format the current time to a Flash-chat compatible timestamp
 *  @param time: Timestamp at beginning of message
 *  @return: Formatted timestamp
 */
function formatTime(string) {
  // Construct date from string, get the time
  return new Date(Date.parse(string)).toTimeString().replace(/(\d{2}):(\d{2}).+/, (match, hour, minutes) => `[${hour%12||12}:${minutes} ${hour > 11 ? 'PM' : 'AM'}]`);
}

/**
 *  Display a message in the chat window
 *  @param raw_msg: The contents of the privmsg to be posted
 *  @param isHistory: If true, it should be pushed at the top, as it is an older message (and may be coming in late)
 *
 */
function postMessage(raw_msg, isHistory) {
  if (!isHistory && !connected) {
    toBePosted.push(raw_msg);
    return;
  }
  postedMessages.push(raw_msg.trim());

  let parts; let prefix; let uid; let name; let time; let isAction; let message; let
    classes = '';
  // In a readable format, the regex looks like: ((UID)_(Display Name)_(Date/Time)_)?(Message)
  // Time format: ShortDay ShortMonth Date HH:MM:SS Year UTC
  parts = raw_msg.match(/((\d+)_(.+)_((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-3]?\d [0-2]\d(?::[0-6]\d){2} \d{4} UTC)_)?(.+)/);
  prefix = parts[1];
  uid = parts[2];
  name = parts[3];
  time = parts[4];
  raw_msg = parts[5];
  // TODO: In the future, remove this, it's due to Flash chat's pre-escaping before sending.
  raw_msg = raw_msg.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  // TODO: Eventually remove, only needed for Flash chat compatible /me (once the Flash app is removed ACTION should be used)
  raw_msg = raw_msg.replace(/<I>(.+)<\/I>/g, '$1');
  // TODO: Because of how chat works right now, we can only handle the inline styles,
  // but some of the block-level pieces could be nice too once we have multiline messages (lists, blockquotes, and fences mostly).
  // Also, the `code` should be styled (ie have a background color and maybe a different text color), and it currently isn't.
  // Images are also disabled, as we currently don't have a way to format them properly.
  raw_msg = md.renderInline(raw_msg);


  // Don't show messages from message on ignore list
  if (ignoredUsers.includes(name)) { return; }

  // For /me
  // NOTE: May need to be reworked once Flash chat is dropped to better coincide with IRC specs
  isAction = raw_msg.startsWith('ACTION ') || name ? name.match(/<I><FONT COLOR="#C0DCE7">(.*)<\/FONT><\/I>/) : false;
  raw_msg = raw_msg.replace(/ACTION /, '');

  // Determine possible message classes
  if (isAction) { classes += ' chat-message-action'; }
  if (!prefix) { classes += ' chat-message-system'; }

  // Fill template and post
  message = '<li class="chat-message{MSG_CLASS}"><div class="chat-message-content">{USER}&lrm;<span class="chat-message-message">{MESSAGE}</span><span class="chat-message-time"> &lrm;{TIME}</span></div>{OPTS}</li>';
  message = message.replace('{MSG_CLASS}', classes)
  // TODO: Eventually remove the italicise replacement, only needed for Flash chat compatible /me (once the Flash app is removed ACTION should be used)
    .replace('{USER}', prefix ? colorizeUser(mdSanitizer.renderInline(name.replace(/<I>(.+)<\/I>/g, '$1')), uid, isAction) : '')
    .replace('{MESSAGE}', raw_msg)
    .replace('{OPTS}', USERNAME !== 'Anonymous' ? '<a class="chat-message-options">&vellip;</a>' : '')
    .replace('{TIME}', prefix ? formatTime(time) : '');
  $('#global-chat-messages').append(message);
  setTimeout(() => {
    $('#chat-tab-global').mCustomScrollbar('scrollTo', chatAutoScroll, { callbacks: false });
  }, 100);
}

/**
 * Adds the message to the current message's ignore list
 * @param user: Username to add to the ignore list
 */
function ignoreUser(user) {
  if (!ignoredUsers.includes(user)) {
    ignoredUsers.push(user);
    persistantSettings.chatIgnored = ignoredUsers;
    postMessage(`Ignored ${user}. To unignore this user, either use the options menu again (on a message or the user list) or type /unignore ${user}`);
  } else {
    postMessage(`${user} has already been ignored`);
  }
}

/**
 * Remove the message to the current message's ignore list
 * @param user: Username to remove from the ignore list, or `*` to clear the list entirely
 */
function unignoreUser(user) {
  if (user == '*') {
    ignoredUsers = [];
    postMessage('Unignored all');
  } else {
    ignoredUsers.splice(ignoredUsers.indexOf(user), 1);
    postMessage(`Unignored ${user}`);
  }
  persistantSettings.chatIgnored = ignoredUsers;
}

/**
 * Close report dialog and reset its contents
 */
function closeReportDialog() {
  $('#report-dialog').dialog('close');
  $('#report-message').val('');
  $('#report-message').parent().hide();
  $('#report-report, #report-ignore').prop('checked', false);
  $('#report-username').val('');
  $('#report-uid').val('');
  $('#report-time').val('');
  $('#report-offending-message').val('');
}

/**
 * Get username from the element a passed message options element is attached to,
 * be it a message or a message list item
 * @param target: Message options DOM element
 */
function usernameFromOptions(target) {
  const container = $(target).parent();
  if (container.hasClass('chat-message')) {
    return container.children('.chat-message-content').children('.chat-message-message-link').text();
  } if (container.hasClass('chat-userlist-message')) {
    return container.children().eq(0).text();
  }

  throw new Error('Unhandled options target');
}

$(document).ready(() => {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') $('#chat-tab-global').mCustomScrollbar('scrollTo', chatAutoScroll, { callbacks: false });
  });

  $('#minimization-triangle').click(toggleVisibility);

  $('#disconnect').click(() => {
    sock.close();
  });

  initSock();
  // Initialize UI
  // Initialize tabs
  $('#chat').tabs({
    activate(event, ui) {
      if (ui) {
        if (ui.newPanel[0].id == 'chat-tab-global') {
          setTimeout(() => {
            $('#chat-tab-global').mCustomScrollbar('scrollTo', chatAutoScroll, { callbacks: false });
          }, 100);
        }
      }
    },
  });
  // Initialize scrollbar
  $('#chat-tabs').children().mCustomScrollbar({
    // No fancy animation, it makes it feel awkward
    scrollInertia: 0,
    mouseWheelPixels: 100,
    callbacks: {
      // The message has scrolled, so don't automatically move to the bottom on a new message
      onScroll() {
        if ($('#chat-tab-global').css('display') !== 'none') {
          chatAutoScroll = this.mcs.top;
        }
      },
      // We've hit the bottom, resume scrolling
      onTotalScroll() {
        if ($('#chat-tab-global').css('display') !== 'none') {
          chatAutoScroll = 'bottom';
        }
      },
    },
  });
  // Fill out max length of message
  // Breakdown - IRC server max: 324, timestamp: 28, underscores: 3, max length of username formatting (for /me, discounting the 3 characters for the command): 40, username: dynamic, UID: dynamic
  $('#chat-input').prop('maxLength', 253 - UID.toString().length - USERNAME.length);
  // `[Report] ` is simply added at the beginning of messages
  $('#report-message').prop('maxLength', 324 - 9);

  // Auto-resize chat input (adapted from https://www.impressivewebs.com/textarea-auto-resize/)
  // Set up input and duplicated div
  const input = $('#chat-input');


  let hiddenDiv = '<div id="chat-input-hidden"></div>';


  let content = null;
  $(hiddenDiv).insertAfter('#chat-input');
  hiddenDiv = $('#chat-input-hidden');
  input.css('overflow', 'hidden');

  input.on('keydown keypress keyup', function () {
    content = md.renderInline($(this).val());
    // Fill content apropriately
    content = content.replace(/\n/g, '<br>');
    hiddenDiv.html(`${content}`);
    // Determine height from duplicate div
    $(this).css('height', hiddenDiv.height());
  });
  // Message options menu
  $('#chat-tabs').contextmenu({
    delegate: '.chat-message-options',
    preventSelect: true,
    autoTrigger: false,
    addClass: 'message-options-menu',
    position: { my: 'right-10 center-15' },
    menu: [
      { title: 'User Options', cmd: 'header', isHeader: true },
      { title: 'Report User/Message', cmd: 'report' },
      { title: 'Ignore User', cmd: 'ignore', disabled(event, ui) { return ignoredUsers.includes(usernameFromOptions(ui.target)) ? 'hide' : false; } },
      { title: 'Unignore User', cmd: 'unignore', disabled(event, ui) { return !ignoredUsers.includes(usernameFromOptions(ui.target)) ? 'hide' : false; } },
    ],
    beforeOpen(event, ui) {
      $('#chat-tabs').contextmenu('setTitle', 'header', usernameFromOptions(ui.target));
    },
    select(event, ui) {
      switch (ui.cmd) {
        case 'report':
          $('#report-report').click();
          break;
        case 'ignore':
          $('#report-ignore').click();
          break;
        case 'unignore':
          unignoreUser(usernameFromOptions(ui.target));
          return;
      }
      if ($(ui.target).parent().hasClass('chat-message')) {
        const msg = $(ui.target).parent().children('.chat-message-content');
        $('#report-username').val(usernameFromOptions(ui.target));
        $('#report-uid').val(msg.children('.chat-message-message-link').prop('href').match(/player\/(\d+)/)[1]);
        const time = msg.children('.chat-message-time').text().match(/(\d+):(\d+) ((AM)|(PM))/);
        $('#report-time').val(
          // Using a random date, as we only need the time
          new Date(`Jan 1 2000 ${time[1]}:${time[2]} ${time[3]}`)
            .toUTCString().match(/(?:\d+:?)+ GMT$/)[0].replace('GMT', 'UTC'),
        );
        $('#report-offending-message').val(msg.children('.chat-message-message').text());
      } else if ($(ui.target).parent().hasClass('chat-userlist-user')) {
        $('#report-username').val(usernameFromOptions(ui.target));
        $('#report-uid').val($(ui.target).parent().children().eq(0)
          .prop('href')
          .match(/player\/(\d+)/)[1]);
      }

      $('#report-dialog').dialog('open');
    },
  });
  $('#chat-tabs').on('click', '.chat-message-options', function () {
    $('#chat-tabs').contextmenu('open', $(this));
  });
  $('#report-dialog').dialog({
    dialogClass: 'report-dialog',
    autoOpen: false,
    minHeight: 0,
    width: '100%',
    position: { at: 'center center-30px' },
  });
  $('#report-report').click(() => {
    $('#report-message').parent().toggle();
  });
  $('#report-cancel').click(closeReportDialog);
  $('#report-submit').click(() => {
    if ($('#report-ignore').prop('checked') == true) {
      ignoreUser($('#report-username').val());
    }

    if ($('#report-report').prop('checked')) {
      sock.send(
        'PRIVMSG #ops-notifications :[REPORT] Reporting {username} ({uid}) by {curr_username} ({curr_uid}).\r\n'
          .replace('{username}', $('#report-username').val())
          .replace('{uid}', $('#report-uid').val())
          .replace('{time}', $('#report-time').val() != '' ? ` Reported message sent at ${$('#report-time').val()}` : '')
          .replace('{curr_username}', USERNAME)
          .replace('{curr_uid}', UID),
      );
      if ($('#report-offending-message').val() != '') {
        sock.send(`PRIVMSG #ops-notifications :[REPORTED MESSAGE] ${$('#report-offending-message').val()}\r\n`);
      }
      sock.send(`PRIVMSG #ops-notifications :[REPORT REASON] ${$('#report-message').val()}\r\n`);
    }

    closeReportDialog();
  });
  // Key bindings
  $('#chat-input').keypress((e) => {
    if (e.which == 13) {
      // Hit enter in chat
      sendMessage($('#chat-input').val());
      $('#chat-input').val('');
      return false;
    }
  });
  $('#reconnect').click(initSock);
});

function sendMessage(message) {
  let isAction = false;
  const channel = `#${CHANNEL}`;
  // No posting as annon or if nothing has been actually posted
  if (USERNAME !== 'Anonymous' && message.trim() !== '') {
    var message = message;
    var post = true;
    // Chat commands
    if (message.startsWith('/')) {
      var post = false;
      const command = message.match(/^\/([^ ]+)/)[1];
      try {
        var params = message.match(/^\/\w+ (.+)/)[1];
      } catch (e) {}
      switch (command) {
        case 'help':
          switch (params) {
            case 'me':
              postMessage('/me: Posts message formatted as an action');
              postMessage('Usage: /me <message>');
              postMessage('Example: /me laughs');
              break;
            case 'ignore':
              postMessage("/ignore: Don't show messages from a particular message. Show currently ignored users with /ignore-list. Unignore message with /unignore.");
              postMessage('Usage: /ignore <username>');
              postMessage('Example: /ignore player1');
              break;
            case 'ignore-list':
              postMessage('/ignore-list: Shows currently ignored users. Ignore a message with /ignore. Unignore message with /unignore.');
              postMessage('Usage: /ignore-list');
              postMessage('Example: /ignore-list');
              break;
            case 'unignore':
              postMessage('/unignore: Shows messages from a message after being igored. Unignores all users when username is *. Ignore a message with /ignore. Show currently ignored users with /ignore-list.');
              postMessage('Usage: /unignore <username>');
              postMessage('Example: /unignore player1');
              postMessage('Example: /unignore *');
              break;
            default:
              postMessage('Available commands: help, me, ignore, ignore-list, unignore');
              postMessage('Type /help <command> for information on individual commands');
              postMessage('Example: /help me');
              postMessage('Additional commands available via LinkBot (see the [wiki](http://eternawiki.org/wiki/index.php5/HELP) for more information)');
              break;
          }
          break;
        case 'me':
          if (!params) { postMessage('Please include command parameters. Type /help me for usage instructions'); break; }
          isAction = true;
          post = true;
          message = params;
          break;
        case 'ignore':
          if (!params) { postMessage('Please include command parameters. Type /help ignore for more usage instructions'); break; }
          ignoreUser(params);
          break;
        case 'ignore-list':
          postMessage(`Currently ignored users: ${ignoredUsers.join(', ')}`);
          break;
        case 'unignore':
          if (!params) { postMessage('Please include command parameters. Type /help unignore for more usage instructions'); break; }
          unignoreUser(params);
          break;
        default:
          postMessage('Invalid command. Type /help for more available commands');
          break;
      }
    }

    if (post) {
      // So Flash chat doesn't break
      message = message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Format time to work with Flash chat
      // TODO: Could use a refactor, might be able to remove this necessity after Flash is removed)
      if (isAction) {
        message = `${UID}_<I><FONT COLOR="#C0DCE7">${USERNAME}</FONT></I>_${new Date().toUTCString().replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-3]\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([0-2]\d(?::[0-6]\d){2}) GMT/, '$1 $3 $2 $5 $4 UTC')}_<I>${message}</I>`;
      } else {
        message = `${UID}_${USERNAME}_${new Date().toUTCString().replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-3]\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([0-2]\d(?::[0-6]\d){2}) GMT/, '$1 $3 $2 $5 $4 UTC')}_${message}`;
      }
      sock.send(`PRIVMSG ${channel} :${message}\r\n`);
      postMessage(message, false);
    }
  }
}

function initSock() {
  clearInterval(timerInterval);
  $('#reconnect').addClass('active');
  $('#reconnect').prop('onclick', null);
  $('#chat-loading > #connecting').show();
  $('#chat-loading > #failed').hide();

  sock = new SockJS('https://irc.eternagame.org/chatws', [], { transports: ['websocket', 'xhr-streaming', 'xdr-streaming', 'eventsource', 'iframe-eventsource', 'htmlfile', 'iframe-htmlfile', 'xhr-polling', 'xdr-polling', 'iframe-xhr-polling'] });
  // Initial Chat Connection
  sock.onopen = function () {
    sock.send(`NICK ${NICK}\r\n`);
    sock.send(`${'USER ' + 'anon' + ' 0 * :'}${USERNAME}\r\n`);
  };

  // Attempt to reconnect
  sock.onclose = function () {
    console.log('sock closed normally');
    onDisconnect();
  };
  sock.onerror = function () {
    console.log('sock closed by an error');
    onDisconnect();
  };
  function onDisconnect() {
    connected = false;
    $('#reconnect').removeClass('active');
    $('#global-chat-messages').append($('chat-loading').detach());
    $('#chat-loading').show();
    if (failedAttempts == 0) {
      $('#chat-loading > #connecting').show();
      failedAttempts++;
      initSock();
    } else {
      currentTimer = disconnectionTimers[Math.min(failedAttempts - 1, 3)];
      $('#chat-loading > #connecting').hide();
      $('#chat-loading > #failed').show();
      $('#chat-loading > #failed > #timer').text(currentTimer);
      $('#reconnect').show();
      $('#chat-input').hide();
      failedAttempts++;
      clearInterval(timerInterval);
      timerInterval = setInterval(updateTimer, 1000);
    }
  }
  function updateTimer() {
    currentTimer--;
    $('#chat-loading > #failed > #timer').text(currentTimer);
    if (currentTimer <= 0) {
      initSock();
    }
  }

  sock.onmessage = function (e) {
    const commands = parseCommands(e.data);
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      switch (cmd.command) {
        case 'PING':
          sock.send('PONG :0.0.0.0\r\n');
          break;
        case '433':
          // Nick already used, try with fallback
          var nickNum = parseInt(NICK.match(/\^(\d+)/)[1]) + 1;
          NICK = NICK.replace(/\^(\d+)/, `^${nickNum}`);
          sock.send(`NICK ${NICK}\r\n`);
          break;
        case '001':
          // Initial info
          console.log('Authenticated');
          sock.send(`JOIN #${CHANNEL}\r\n`);
          break;
        case 'JOIN':
          failedAttempts = 0;

          // $("#chat-content").css("background-color", "rgba(0,0,0,0)");
          var nick = cmd.origin.split('!')[0];
          if (nick == NICK) {
            console.log(`Joined ${cmd.params[0]}`);
            console.log('Loading history...');
            $.get('https://irc.eternagame.org/history', (data) => {
              console.log('History recieved');
              const messages = data.trim().split('\n');
              const firstNewMessage = 0;
              let j;
              for (j = 0; j < messages.length; j++) if (postedMessages.indexOf(messages[j].trim()) == -1) break;
              if (!firstConnection) postMessage('Reconnected to chat - Some messages might be missing if you were away for a long time', true);
              for (; j < messages.length; j++) {
                postMessage(messages[j], true);
              }
              while (toBePosted.length) {
                postMessage(toBePosted.shift(), true);
              }
              firstConnection = false;
              connected = true;
              $('#reconnect').hide();
              $('#chat-loading').hide();
              $('#chat-input').show();
              $('div#chat-loading').detach();
              $('#chat-tabs').show();
              setTimeout(() => {
                $('#chat-tabs').children().mCustomScrollbar('scrollTo', 'bottom', { callbacks: false });
              }, 100);
              if (USERNAME !== 'Anonymous') {
                $('#chat-input').prop('disabled', false);
              } else {
                $('#chat-input').attr('placeholder', 'Please log in to chat');
              }
            });
          } else {
            addUser(cmd.origin.split('!')[0]);
          }
          break;
        case '331':
        case '332':
          // Topic, display?
          break;
          // Part and quit both need to be handled the same way in our case - a message left the room
        case 'PART':
        case 'QUIT':
          removeUser(cmd.origin.split('!')[0]);
          break;
        case '353':
          var users = cmd.params[3].trim().split(' ');
          for (let j = 0; j < users.length; j++) {
            addUser(users[j]);
          }
          break;
        case '366':
          // Signifies end of names, don't think this is needed?
          break;
        case 'NOTICE':
        case 'PRIVMSG':
          postMessage(cmd.params[1], false);
          break;
        case 'MODE':
          // Check if message has been banned, if so disable input and notify in chat
          if (cmd.params[1] == '+b') {
            const maskParts = cmd.params[2].match(/(~q:)?(.+)!.+/);
            if (NICK.match(new RegExp(maskParts[2].replace('*', '.+').replace('^', '\\^')))) {
              $('#chat-input').prop('disabled', true);
              if (maskParts[1]) {
                postMessage('You are no longer allowed to post in chat');
              } else {
                postMessage('You have been banned from chat');
              }
            }
          } else if (cmd.params[1] == '-b') {
            const maskUser = cmd.params[2].match(/(?:~q:)?(.+)!.+/)[1];
            if (NICK.match(new RegExp(maskUser.replace('*', '.+').replace('^', '\\^')))) {
              $('#chat-input').prop('disabled', false);
              postMessage('You are now allowed to post in chat');
            }
          }
          break;
          // Check if message has been kicked, if so disable input and notify in chat, if other message remove them from online list
        case 'KICK':
          if (cmd.params[1] == NICK) {
            $('#chat-input').prop('disabled', true);
            postMessage(`You have been kicked from chat${cmd.params[2] ? ` - ${cmd.params[2]}` : ''}`);
          } else {
            removeUser(cmd.params[1]);
          }
          break;
        case '404':
          // Can't post message
          if (cmd.params[2].startsWith('You are banned')) {
            $('#chat-input').prop('disabled', true);
            postMessage('You are not allowed to post in chat');
          }
          break;
        case '474':
          // Can't join channel
          if (cmd.params[1] == 'Cannot join channel (+b)') {
            $('#chat-input').prop('disabled', true);
            postMessage('You have been banned from chat');
          }
          break;
          // Ignore information stuff
        case '002':
        case '003':
        case '004':
        case '005':
        case '251':
        case '252':
        case '253':
        case '254':
        case '255':
        case '265':
        case '266':
        case '333':
          // Topic set by _ at _
        case '422':
          break;

        default:
          console.log(`[Chat] Unhandled command recieved. Command: ${cmd.command} Origin: ${cmd.origin} Params: ${cmd.params}`);
      }
    }
  };
}

window.addEventListener('message', screenshotHook, false);
window.addEventListener('message', scrollHook, false);

function screenshotHook(event) {
  if (event.origin.match(/https?:\/\/((127.0.0.1)|(localhost)|((.*\.)?eternagame\.org)|((.*\.?)eternadev\.org))/).length !== 0) if (event.data.type === 'chat-message') sendMessage(event.data.content);
}

function scrollHook(event) {
  if (event.origin.match(/https?:\/\/((127.0.0.1)|(localhost)|((.*\.)?eternagame\.org)|((.*\.?)eternadev\.org))/).length !== 0) {
    if (event.data.type === 'chat-scroll') {
      setTimeout(() => {
        $('#chat-tab-global').mCustomScrollbar('scrollTo', 'bottom', { callbacks: false });
      }, 100);
      chatAutoScroll = 'bottom';
    }
  }
}

function toggleVisibility() {
  $('#minimization-triangle').toggleClass('flipped');
  $('#chat-content').fadeToggle('fast');
  $('.tab').fadeToggle('fast');
  if ($('#chat-content').css('display') !== 'none') $('#chat-tab-global').mCustomScrollbar('scrollTo', 'bottom');
}
