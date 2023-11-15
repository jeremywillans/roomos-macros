/* eslint-disable no-useless-escape */
/* eslint-disable no-console */
/* eslint-disable no-nested-ternary */
/*
# Customer Satisfaction Survey Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 2.1
#
# USE AT OWN RISK, MACRO NOT FULLY TESTED NOR SUPPLIED WITH ANY GUARANTEE
#
# Usage -
#  This macro will show a survey at the end of each call to capture user perception
#  The data can be made available to the following destinations
#  Webex Space, HTTP Server (POST) and/or Service Now Incident.
#
# Change History
# 1.0 20210308 Initial Release
# 1.1 20220209 Add Timeout to Issue Prompt
# 1.2 20220524 Add HTTP JSON POST Option
# 1.3 20220720 Add Timestamp to JSON Message
# 1.4 20220906 Refactor Macro Code
# 1.5 20220908 Add Loki Logging Support and further refactoring
# 1.6 20221101 Fix to update Duration to Number
# 1.7 20230530 Capture Voluntary Survey Response and enable Log upload
# 1.8 20230609 Add Meeting Type for each call and support PowerBI Streaming Dataset
# 1.9 20230719 Improve Service Now customizations
# 2.0 20230817 Refactoring and allow customizing SNOW Tickets raised for Poor and/or Average
# 2.1 20231115 Update variable to reflect Bot Token, not Bot Id.
#
*/
// eslint-disable-next-line import/no-unresolved
import xapi from 'xapi';

// Webex Space Parameters
const webexEnabled = false; // Enable for Webex Space Message Logging
const roomId = '#### ROOM ID ####'; // Specify a Room ID
const botToken = '#### BOT TOKEN ####'; // Specify a Bot Token
// HTTP JSON Post Parameters
const httpEnabled = false; // Enable for JSON HTTP POST Destination
const httpUrl = 'http://10.xx.xx.xx:3000'; // HTTP POST URL (append /loki/api/v1/push if using Loki)
const httpAuthorization = 'supersecret123'; // Authorization Header Content for HTTP POST
const httpLoki = false; // Enable if destination server is Loki Log Server
const httpPowerBi = false; // Enable if destination service is Power BI Streaming Dataset
// Service Now Parameters
const snowEnabled = false; // Enable for Service NOW Incident Raise
const snowRaiseAvg = true; // Raise SNOW Incident for Average Responses
const snowInstance = '#### INSTANCE ####.service-now.com'; // Specify the base url for Service Now
const snowCredentials = '#### BASE64 CREDENTIALS ####'; // Basic Auth format is "username:password" base64-encoded.
const snowCallerId = ''; // Default Caller for Incidents, needs to be sys_id of Caller
const snowCmdbCi = ''; // Default CMDB CI, needs to be sys_id of CI
const snowCmdbLookup = false; // Lookup Device using Serial Number in Service Now
const snowExtra = { // Any extra parameters to pass to Service Now
  // "assignment_group": "sys_id-of-assignment-group"
};
// Global Parameters
const minDuration = 10; // Minimum call duration (seconds) before Survey is displayed
const defaultExcellent = false; // Enable to send Excellent result as default if no user input.
const promptTitle = 'Call Experience Feedback'; // Title shown on displayed prompts.
const debugMode = true; // Enable extended logging to debug console
// Timeout Parameters
const timeoutMenu = 20; // Timeout before initial survey menu is dismissed (seconds)
const timeoutFollowup = 20; // Timeout before remaining survey options are dismissed (seconds)

// ----- EDIT BELOW THIS LINE AT OWN RISK ----- //

const webexAuth = `Authorization: Bearer ${botToken}`;
const contentType = 'Content-Type: application/json';
const acceptType = 'Accept: application/json';
const webexMessageUrl = 'https://webexapis.com/v1/messages'; // Message URL
const httpAuth = `Authorization: ${httpAuthorization}`;
const snowIncidentUrl = `https://${snowInstance}/api/now/table/incident`; // Specify a URL to a service like serviceNow etc.
const snowUserUrl = `https://${snowInstance}/api/now/table/sys_user`; // Specify a URL to a service like serviceNow etc.
const snowCMDBUrl = `https://${snowInstance}/api/now/table/cmdb_ci`; // Specify a URL to a service like serviceNow etc.
const snowAuth = `Authorization: Basic ${snowCredentials}`; // SNOW PERMISSIONS NEEDED - sn_incident_write
const vimtDomain = '@m.webex.com';
const googleDomain = 'meet.google.com';
const msftDomain = 'teams.microsoft.com';
const zoomDomain = '(@zm..\.us|@zoomcrc.com)';

let callInfo = {};
const systemInfo = {};
let userInfo = {};
let qualityInfo = {};
let showFeedback = true;
let voluntaryRating = false;
let errorResult = false;
let skipLog = false;
let callDestination = false;
let callType = '';
let callMatched = false;

// Initialize Variables
function initVariables() {
  qualityInfo = {};
  showFeedback = true;
  voluntaryRating = false;
  errorResult = false;
  skipLog = false;
  userInfo = {};
  callDestination = false;
  callType = '';
  callMatched = false;
}

// Sleep Function
async function sleep(ms) {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Time Formatter
function formatTime(seconds) {
  const d = Math.floor((seconds / 3600) / 24);
  const h = Math.floor((seconds / 3600) % 24);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 3600 % 60);
  const dDisplay = d > 0 ? d + (d === 1 ? (h > 0 || m > 0 ? ' day, ' : ' day') : (h > 0 || m > 0 ? ' days, ' : ' days')) : '';
  const hDisplay = h > 0 ? h + (h === 1 ? (m > 0 || s > 0 ? ' hour, ' : ' hour') : (m > 0 || s > 0 ? ' hours, ' : ' hours')) : '';
  const mDisplay = m > 0 ? m + (m === 1 ? ' minute' : ' minutes') : '';
  const sDisplay = s > 0 ? s + (s === 1 ? ' second' : ' seconds') : '';

  if (m < 1) {
    return `${dDisplay}${hDisplay}${mDisplay}${sDisplay}`;
  }

  return `${dDisplay}${hDisplay}${mDisplay}`;
}

function formatRating(rating) {
  switch (rating) {
    case 1:
      return 'Excellent';
    case 2:
      return 'Average';
    case 3:
      return 'Poor';
    default:
      return 'Unknown';
  }
}

function formatLevel(rating) {
  switch (rating) {
    case 1:
      return 'info';
    case 2:
      return 'warning';
    case 3:
      return 'error';
    default:
      return 'debug';
  }
}

function formatIssue(issue) {
  switch (issue) {
    case 1:
      return 'Audio/Video';
    case 2:
      return 'Content/Sharing';
    case 3:
      return 'Other';
    default:
      return 'Unknown';
  }
}

function formatType(type) {
  switch (type) {
    case 'webex':
      return 'Webex';
    case 'endpoint':
      return 'Device/User';
    case 'vimt':
      return 'Teams VIMT';
    case 'msft':
      return 'Teams WebRTC';
    case 'google':
      return 'Google WebRTC';
    case 'zoom':
      return 'Zoom';
    default:
      return 'Unknown';
  }
}

// Post content to Webex Space
async function postContent() {
  if (debugMode) console.debug('Process postContent function');
  let blockquote;
  switch (qualityInfo.rating) {
    case 1:
      blockquote = '<blockquote class=success>';
      break;
    case 2:
      blockquote = '<blockquote class=warning>';
      break;
    case 3:
      blockquote = '<blockquote class=danger>';
      break;
    default:
      console.debug('Unhandled Response');
  }

  let markdown = (`**Call Quality Report - ${formatRating(qualityInfo.rating)}**${blockquote}**System Name:** ${systemInfo.systemName}  \n**Serial Number:** ${systemInfo.serialNumber}  \n**SW Release:** ${systemInfo.softwareVersion}`);
  if (callDestination) { markdown += `\n**Destination:** \`${callDestination}\`  \n**Call Type:** ${formatType(callType)}`; }
  if (callInfo.Duration) { markdown += `  \n**Call Duration:** ${formatTime(callInfo.Duration)}`; }
  if (callInfo.CauseType) { markdown += `  \n**Disconnect Cause:** ${callInfo.CauseType}`; }
  if (qualityInfo.issue) { markdown += `  \n**Quality Issue:** ${formatIssue(qualityInfo.issue)}`; }
  if (qualityInfo.feedback) { markdown += `  \n**Quality Feedback:** ${qualityInfo.feedback}`; }
  const voluntary = voluntaryRating ? 'Yes' : 'No';
  if (defaultExcellent) { markdown += `  \n**Voluntary Rating:** ${voluntary}`; }
  if (qualityInfo.incident) { markdown += `  \n**Incident Ref:** ${qualityInfo.incident}`; }
  if (userInfo.sys_id) {
    markdown += `  \n**Reporter:**  [${userInfo.name}](webexteams://im?email=${userInfo.email}) (${userInfo.email})`;
  } else if (qualityInfo.reporter) {
    // Include Provided Email if not matched in SNOW
    markdown += `  \n**Provided Email:** ${qualityInfo.reporter}`;
  }
  markdown += '</blockquote>';

  const messageContent = { roomId, markdown };

  try {
    const result = await xapi.command('HttpClient Post', { Header: [contentType, acceptType, webexAuth], Url: webexMessageUrl }, JSON.stringify(messageContent));
    if (result.StatusCode !== '200') {
      console.error(`postContent response: ${result}`);
      errorResult = true;
    }
    console.debug('postContent message sent.');
  } catch (error) {
    console.error(`postContent error: ${error.message}`);
    errorResult = true;
  }
}

// Post JSON content to HTTP Server
async function postJSON() {
  console.debug('Process postJSON function');
  let timestamp = Date.now();
  if (httpPowerBi) {
    const ts = new Date(timestamp);
    timestamp = ts.toISOString();
  }
  let messageContent = {
    timestamp,
    system: systemInfo.systemName,
    serial: systemInfo.serialNumber,
    software: systemInfo.softwareVersion,
    rating: qualityInfo.rating,
    rating_fmt: formatRating(qualityInfo.rating),
    destination: callDestination,
    call_type: callType,
    duration: callInfo.Duration,
    duration_fmt: formatTime(callInfo.Duration),
    cause: callInfo.CauseType,
    issue: qualityInfo.issue,
    feedback: qualityInfo.feedback,
    reporter: qualityInfo.reporter,
    voluntary: voluntaryRating,
  };

  if (qualityInfo.issue) messageContent.issue_fmt = formatIssue(qualityInfo.issue);

  if (httpLoki) {
    messageContent = {
      streams: [
        {
          stream: {
            app: 'call-survey',
            level: formatLevel(qualityInfo.rating),
          },
          values: [[`${timestamp}000000`, messageContent]],
        },
      ],
    };
  }

  if (httpPowerBi) {
    messageContent = [messageContent];
  }

  try {
    const result = await xapi.command('HttpClient Post', { Header: [contentType, acceptType, httpAuth], Url: httpUrl }, JSON.stringify(messageContent));
    if (result.StatusCode.match(/20[04]/)) {
      if (debugMode) console.debug('postJSON message sent.');
      return;
    }
    console.error(`postJSON status: ${result.StatusCode}`);
    if (result.message && debugMode) {
      console.debug(result.message);
    }
  } catch (error) {
    console.error('postJSON error encountered');
    if (debugMode) console.debug(error.message);
  }
}

// Raise ticket in Service Now
async function raiseTicket() {
  if (debugMode) console.debug('Process raiseTicket function');
  let description = `Call Quality Report - ${formatRating(qualityInfo.rating)}\n\nSystem Name: ${systemInfo.systemName}\nSerial Number: ${systemInfo.serialNumber}\nSW Release: ${systemInfo.softwareVersion}`;
  if (callDestination) { description += `\nDestination: \`${callDestination}\`  \nCall Type: ${formatType(callType)}`; }
  if (callInfo.Duration) { description += `\nCall Duration: ${formatTime(callInfo.Duration)}`; }
  if (callInfo.CauseType) { description += `\nDisconnect Cause: ${callInfo.CauseType}`; }
  if (qualityInfo.issue) { description += `\n\nQuality Issue: ${formatIssue(qualityInfo.issue)}`; }
  if (qualityInfo.feedback) { description += `\nQuality Feedback: ${qualityInfo.feedback}`; }
  const shortDescription = `${systemInfo.systemName}: ${formatRating(qualityInfo.rating)} Call Quality Report`;

  // Initial Construct Incident
  let messageContent = { short_description: shortDescription, description };
  // Add Default Caller, if defined.
  if (snowCallerId) {
    messageContent.caller_id = snowCallerId;
  }

  // SNOW Reporter Lookup, or append to description.
  if (qualityInfo.reporter) {
    try {
      let result = await xapi.command('HttpClient Get', { Header: [contentType, snowAuth], Url: `${snowUserUrl}?sysparm_limit=1&email=${qualityInfo.reporter}` });
      result = result.Body;
      [userInfo] = JSON.parse(result).result;
      // Validate User Data
      if ((userInfo !== undefined) || (userInfo.sys_id !== undefined)) {
        messageContent.caller_id = userInfo.sys_id;
      } else {
        messageContent.description += `\nProvided Email Address: ${qualityInfo.reporter}}`;
      }
    } catch (error) {
      console.error('raiseTicket getUser error encountered');
      if (debugMode) console.debug(error.message);
    }
  }

  if (snowCmdbCi) {
    messageContent.cmdb_ci = snowCmdbCi;
  }

  if (snowCmdbLookup) {
    try {
      let result = await xapi.command('HttpClient Get', { Header: [contentType, snowAuth], Url: `${snowCMDBUrl}?sysparm_limit=1&serial_number=${systemInfo.serialNumber}` });
      result = result.Body;
      const [ciInfo] = JSON.parse(result).result;
      // Validate CI Data
      if ((ciInfo !== undefined) && (ciInfo.sys_id !== undefined)) {
        messageContent.cmdb_ci = ciInfo.sys_id;
      }
    } catch (error) {
      console.error('raiseTicket getCMDBCi error encountered');
      if (debugMode) console.debug(error.message);
    }
  }

  // Merge Extra Params
  if (snowExtra) {
    messageContent = { ...messageContent, ...snowExtra };
  }

  try {
    let result = await xapi.command('HttpClient Post', { Header: [contentType, snowAuth], Url: snowIncidentUrl }, JSON.stringify(messageContent));
    const incidentUrl = result.Headers.find((x) => x.Key === 'Location').Value;
    result = await xapi.command('HttpClient Get', { Header: [contentType, snowAuth], Url: incidentUrl });
    qualityInfo.incident = JSON.parse(result.Body).result.number;
    if (debugMode) console.debug(`raiseTicket successful: ${qualityInfo.incident}`);
  } catch (error) {
    console.error('raiseTicket error encountered');
    if (debugMode) console.debug(JSON.stringify(error));
    errorResult = true;
  }
}

// Initial Survey menu shown after call disconnect
function initialMenu() {
  const excellentText = defaultExcellent ? `${formatRating(1)} (default)` : formatRating(1);
  if (callInfo.Duration > minDuration) {
    xapi.command('UserInterface Message Prompt Display', {
      Duration: timeoutMenu,
      Title: promptTitle,
      Text: 'How would you rate your call today?',
      FeedbackId: 'call_rating',
      'Option.1': excellentText,
      'Option.2': formatRating(2), // Average
      'Option.3': formatRating(3), // Poor
    });
  } else {
    initVariables();
    /*
    xapi.command('UserInterface Message Prompt Display', {
      Title: promptTitle,
      Text: 'Call did not complete. What happened?',
      FeedbackId: 'no_call_rating',
      'Option.1': 'I dialled the wrong number!',
      'Option.2': 'Call did not answer',
      'Option.3': 'Oops, wrong button',
    });
    */
  }
}

// Process enabled services
async function processRequest() {
  if (httpEnabled) {
    postJSON();
  }
  if (snowEnabled && ((qualityInfo.rating === 3) || (qualityInfo.rating === 2 && snowRaiseAvg))) {
    await raiseTicket();
  }
  if (webexEnabled) {
    await postContent();
  }
  await sleep(600);
  if (showFeedback) {
    if (errorResult) {
      await xapi.Command.UserInterface.Message.Alert.Display({
        Title: 'Error Encountered',
        Text: 'Sorry we were unable to submit your feedback.<br>Please advise your IT Support team of this error.',
        Duration: 20,
      });
      return;
    }
    let textContent = 'Thanks for your feedback!';
    if (qualityInfo.incident) {
      textContent += `<br>Incident ${qualityInfo.incident} raised.`;
    }
    await xapi.Command.UserInterface.Message.Alert.Display({
      Title: 'Acknowledgement',
      Text: textContent,
      Duration: 5,
    });
  }
  await sleep(3000);
  if (debugMode) console.debug('Init Variables');
  initVariables();
}

// Process Call Disconnect event
xapi.Event.CallDisconnect.on((event) => {
  callInfo = event;
  callInfo.Duration = Number(event.Duration);
  initialMenu();
});

async function processCall() {
  if (callMatched) {
    return;
  }
  let call;
  try {
    [call] = await xapi.Status.Call.get();
  } catch (e) {
    // No Active Call
    return;
  }

  if (call.Protocol === 'WebRTC') {
    callType = 'webrtc';
    callDestination = call.CallbackNumber;
    // Matched WebRTC Call
    if (call.CallbackNumber.match(msftDomain)) {
      // Matched Teams Call
      callType = 'msft';
      callMatched = true;
      if (debugMode) console.debug(`[${callType}] ${callDestination}`);
      return;
    }
    if (call.CallbackNumber.match(googleDomain)) {
      // Matched Google Call
      callType = 'google';
      callMatched = true;
      if (debugMode) console.debug(`[${callType}] ${callDestination}`);
      return;
    }
    // Fallback WebRTC Call
    if (debugMode) console.debug(`[${callType}] ${callDestination}`);
    return;
  }

  // Default Call Type
  callType = 'sip';
  callDestination = call.CallbackNumber;
  if (call.CallbackNumber.match(vimtDomain)) {
    // Matched VIMT Call
    callType = 'vimt';
    callMatched = true;
    if (debugMode) console.debug(`[${callType}] ${callDestination}`);
    return;
  }
  if (call.CallbackNumber.match('.webex.com')) {
    // Matched Webex Call
    callType = 'webex';
    callMatched = true;
    if (debugMode) console.debug(`[${callType}] ${callDestination}`);
    return;
  }
  if (call.CallbackNumber.match(zoomDomain)) {
    // Matched Zoom Call
    callType = 'zoom';
    callMatched = true;
    if (debugMode) console.debug(`[${callType}] ${callDestination}`);
    return;
  }
  if (call.DeviceType === 'Endpoint' && call.CallbackNumber.match('^[^.]*$')) {
    // Matched Endpoint/User Call
    callType = 'endpoint';
    callDestination = `${call.DisplayName}: ${call.CallbackNumber})`;
    if (debugMode) console.debug(`[${callType}] ${callDestination}`);
    return;
  }
  // Fallback SIP Call
  if (debugMode) console.debug(`[${callType}] ${callDestination}`);
}

xapi.Status.SystemUnit.State.NumberOfActiveCalls.on(async (numCalls) => {
  console.log(numCalls);
  if (numCalls === '1') {
    processCall();
  }
});

// Capture Call Destination
xapi.Event.OutgoingCallIndication.on(() => {
  processCall();
});

// Process responses to TextInput prompts
xapi.Event.UserInterface.Message.TextInput.Response.on(async (event) => {
  switch (event.FeedbackId) {
    case 'feedback_step2':
      qualityInfo.feedback = event.Text;
      await sleep(200);
      xapi.command('UserInterface Message TextInput Display', {
        Duration: timeoutFollowup,
        FeedbackId: 'feedback_step3',
        InputType: 'SingleLine',
        KeyboardState: 'Open',
        Placeholder: 'Email Address',
        SubmitText: 'Submit',
        Text: 'Please advise your email address (optional)',
        Title: promptTitle,
      });
      break;
    case 'feedback_step3':
      qualityInfo.reporter = event.Text;
      processRequest();
      break;
    default:
      console.warn('Unhandled TextInput.Response');
  }
});

// Process responses to Message prompts
xapi.Event.UserInterface.Message.Prompt.Response.on(async (event) => {
  switch (event.FeedbackId) {
    case 'call_rating':
      voluntaryRating = true;
      switch (event.OptionId) {
        case '1':
          qualityInfo.rating = 1; // Excellent
          processRequest();
          return;
        case '2':
          qualityInfo.rating = 2; // Average
          break;
        case '3':
          qualityInfo.rating = 3; // Poor
          break;
        default:
          console.warn('Unhandled call_rating Prompt.Response');
          return;
      }
      // Send Logs for Average/Poor Ratings
      if (!skipLog) { xapi.Command.Logging.SendLogs(); }
      await sleep(200);
      xapi.Command.UserInterface.Message.Prompt.Display({
        Duration: timeoutFollowup,
        Title: promptTitle,
        Text: `What is the primary issue for your rating of ${formatRating(qualityInfo.rating)}?`,
        FeedbackId: 'feedback_step1',
        'Option.1': formatIssue(1), // Audio/Video
        'Option.2': formatIssue(2), // Content/Sharing
        'Option.3': formatIssue(3), // Other
      });
      break;
    case 'feedback_step1':
      switch (event.OptionId) {
        case '1':
          qualityInfo.issue = 1; // Audio/Video
          break;
        case '2':
          qualityInfo.issue = 2; // Content/Sharing
          break;
        case '3':
          qualityInfo.issue = 3; // Other
          break;
        default:
          console.warn('Unhandled feedback_step1 Prompt.Response');
          return;
      }
      await sleep(200);
      xapi.Command.UserInterface.Message.TextInput.Display({
        Duration: timeoutFollowup,
        FeedbackId: 'feedback_step2',
        InputType: 'SingleLine',
        KeyboardState: 'Open',
        Placeholder: 'Additional details here',
        SubmitText: 'Submit',
        Text: 'Please provide any additional details (optional)',
        Title: promptTitle,
      });
      break;
    default:
      console.warn('Unhandled Prompt.Response');
  }
});

// Process Clear/Cancel/Closure of prompt dialogues
xapi.Event.UserInterface.Message.Prompt.Cleared.on((event) => {
  showFeedback = false;
  switch (event.FeedbackId) {
    case 'call_rating':
      if (defaultExcellent) {
        qualityInfo.rating = 1;
        processRequest();
      } else {
        initVariables();
      }
      return;
    case 'feedback_step1':
      processRequest();
      return;
    default:
      console.warn('Unhandled Prompt.Cleared');
  }
});

// Process Clear/Cancel/Closure of TextInput dialogues
xapi.Event.UserInterface.Message.TextInput.Clear.on((event) => {
  showFeedback = false;
  switch (event.FeedbackId) {
    case 'feedback_step2':
    case 'feedback_step3':
      processRequest();
      return;
    default:
      console.warn('Unhandled TextInput.Clear');
  }
});

// Debugging Buttons
xapi.Event.UserInterface.Extensions.Panel.Clicked.on((event) => {
  if (event.PanelId === 'test_services') {
    qualityInfo.rating = 3;
    qualityInfo.reporter = 'aileen.mottern@example.com';
    callInfo.Duration = 15;
    callInfo.CauseType = 'LocalDisconnect';
    callType = 'webex';
    callDestination = 'spark:123456789@webex.com';
    voluntaryRating = true;
    skipLog = true;
    processRequest();
  }
  if (event.PanelId === 'test_survey') {
    callInfo.Duration = 15;
    callInfo.CauseType = 'LocalDisconnect';
    callType = 'webex';
    callDestination = 'spark:123456789@webex.com';
    initialMenu();
  }
});

// Initialize Function
async function init() {
  // Get System Name / Contact Name
  systemInfo.systemName = await xapi.Status.UserInterface.ContactInfo.Name.get();
  // Get System SN
  systemInfo.serialNumber = await xapi.Status.SystemUnit.Hardware.Module.SerialNumber.get();
  if (systemInfo.systemName === '') {
    systemInfo.systemName = systemInfo.serialNumber;
  }
  // Get SW Version
  systemInfo.softwareVersion = await xapi.Status.SystemUnit.Software.Version.get();
  // HTTP Client needed for sending outbound requests
  await xapi.Config.HttpClient.Mode.set('On');
  initVariables();
}

init();
