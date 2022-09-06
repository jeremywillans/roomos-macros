/* eslint-disable import/no-unresolved */
/* eslint-disable no-console */
/* eslint-disable no-nested-ternary */
/*
# Customer Satisfaction Survey Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.4
#
# USE AT OWN RISK, MACRO NOT FULLY TESTED NOR SUPPLIED WITH ANY GUARANTEE
#
# Usage - Shows Survey at end of call which output into Webex Space and/or Service Now Incident.
#
# Change History
# 1.0 20210308 Initial Release
# 1.1 20220209 Add Timeout to Issue Prompt
# 1.2 20220524 Add HTTP JSON POST Option
# 1.3 20220720 Add Timestamp to JSON Message
# 1.4 20220906 Refactor Macro Code
#
*/
const xapi = require('xapi');

// Webex Space Parameters
const WEBEX_ENABLED = false; // Enable for Webex Space Message Logging
const ROOM_ID = '#### ROOM ID ####'; // Specify a Room ID
const BOT_ID = '#### BOT ID ####'; // Specify a Bot ID
// HTTP JSON Post Parameters
const HTTP_ENABLED = false; // Enable for JSON HTTP POST Destination
const HTTP_URL = 'http://10.xx.xx.xx:3000'; // HTTP POST URL
const HTTP_AUTHORIZATION = 'supersecret123'; // Authorization Header Content for HTTP POST
// Service Now Parameters
const SERVICENOW_ENABLED = false; // Enable for Service NOW Incident Raise
const SERVICE_NOW_INSTANCE = '#### INSTANCE ####.service-now.com'; // Specify a URL to a service like serviceNow etc.
const SERVICENOW_CREDENTIALS = '#### BASE64 CREDENTIALS ####'; // Basic Auth format is "username:password" base64-encoded.
// Global Parameters
const CALL_DURATION = 10; // Minimum call duration (seconds) before Survey is displayed
const EXCELLENT_DEFAULT = false; // Enable to send Excellent result as default if no user input.

// ----- EDIT BELOW THIS LINE AT OWN RISK ----- //

const webexAuth = `Authorization: Bearer ${BOT_ID}`;
const contentType = 'Content-Type: application/json';
const acceptType = 'Accept: application/json';
const webexMessageUrl = 'https://webexapis.com/v1/messages'; // Message URL
const httpAuth = `Authorization: ${HTTP_AUTHORIZATION}`;
const snowIncidentUrl = `https://${SERVICE_NOW_INSTANCE}/api/now/table/incident`; // Specify a URL to a service like serviceNow etc.
const snowUserUrl = `https://${SERVICE_NOW_INSTANCE}/api/now/table/sys_user`; // Specify a URL to a service like serviceNow etc.
const snowAuth = `Authorization: Basic ${SERVICENOW_CREDENTIALS}`; // SNOW PERMISSIONS NEEDED - sn_incident_write

let callInfo = {};
const systemInfo = {};
let userInfo = {};
let qualityInfo = {};
let showFeedback = true;
let errorResult = false;

// Initialize Variables
function initVariables() {
  qualityInfo = {
    rating: '',
    issue: '',
    feedback: '',
    reporter: '',
    incident: '',
  };
  showFeedback = true;
  errorResult = false;
  userInfo = { sys_id: '' };
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

// Post content to Webex Space
async function postContent() {
  console.debug('Process postContent function');
  let blockquote;
  switch (qualityInfo.rating) {
    case 'Excellent':
      blockquote = '<blockquote class=success>';
      break;
    case 'Average':
      blockquote = '<blockquote class=warning>';
      break;
    case 'Poor':
      blockquote = '<blockquote class=danger>';
      break;
    default:
      console.debug('Unhandled Response');
  }

  let markdown = (`**Call Quality Report - ${qualityInfo.rating}**${blockquote}**System Name:** ${systemInfo.systemName}  \n**Serial Number:** ${systemInfo.serialNumber}  \n**SW Release:** ${systemInfo.softwareVersion}`);
  if (callInfo.RequestedURI !== '') { markdown += `\n**Dial String:** \`${callInfo.RequestedURI}\``; }
  if (callInfo.Duration !== '') { markdown += `  \n**Call Duration:** ${formatTime(callInfo.Duration)}`; }
  if (callInfo.CauseType !== '') { markdown += `  \n**Disconnect Cause:** ${callInfo.CauseType}`; }
  if (qualityInfo.issue !== '') { markdown += `  \n**Quality Issue:** ${qualityInfo.issue}`; }
  if (qualityInfo.feedback !== '') { markdown += `  \n**Quality Feedback:** ${qualityInfo.feedback}`; }
  if (qualityInfo.incident !== '') { markdown += `  \n**Incident Ref:** ${qualityInfo.incident}`; }
  if (userInfo.sys_id !== '') {
    markdown += `  \n**Reporter:**  [${userInfo.name}](webexteams://im?email=${userInfo.email}) (${userInfo.email})`;
  } else if (qualityInfo.reporter !== '') {
    // Include Provided Email if not matched in SNOW
    markdown += `  \n**Provided Email:** ${qualityInfo.reporter}`;
  }
  markdown += '</blockquote>';

  const messageContent = { roomId: ROOM_ID, markdown };

  try {
    const result = await xapi.command('HttpClient Post', { Header: [contentType, acceptType, webexAuth], Url: webexMessageUrl }, JSON.stringify(messageContent));
    if (result.StatusCode !== '200') {
      console.error(`postContent response: ${result}`);
      errorResult = true;
    }
  } catch (error) {
    console.error(`postContent error: ${error.message}`);
    errorResult = true;
  }
}

// Post JSON content to HTTP Server
async function postJSON() {
  console.debug('Process postJSON function');
  const messageContent = {
    timestamp: Date.now(),
    system: systemInfo.systemName,
    serial: systemInfo.serialNumber,
    software: systemInfo.softwareVersion,
    rating: qualityInfo.rating,
    destination: callInfo.RequestedURI,
    duration: callInfo.Duration,
    duration_fmt: formatTime(callInfo.Duration),
    cause: callInfo.CauseType,
    issue: qualityInfo.issue,
    feedback: qualityInfo.feedback,
    reporter: qualityInfo.reporter,
  };

  try {
    const result = await xapi.command('HttpClient Post', { Header: [contentType, acceptType, httpAuth], Url: HTTP_URL }, JSON.stringify(messageContent));
    if (result.StatusCode === '200') {
      console.debug('postJSON message sent.');
      return;
    }
    console.error(`postJSON status: ${result.StatusCode}`);
  } catch (error) {
    console.error(`postJSON error: ${error.message}`);
  }
}

// Raise ticket in Service Now
async function raiseTicket() {
  console.debug('Process raiseTicket function');
  let description = `Call Quality Report - ${qualityInfo.rating}\n\nSystem Name: ${systemInfo.systemName}\nSerial Number: ${systemInfo.serialNumber}\nSW Release: ${systemInfo.softwareVersion}`;
  if (callInfo.RequestedURI !== '') { description += `\n\nDial String: ${callInfo.RequestedURI}`; }
  if (callInfo.Duration !== '') { description += `\nCall Duration:< ${formatTime(callInfo.Duration)}`; }
  if (callInfo.CauseType !== '') { description += `\nDisconnect Cause: ${callInfo.CauseType}`; }
  if (qualityInfo.issue !== '') { description += `\n\nQuality Issue: ${qualityInfo.issue}`; }
  if (qualityInfo.feedback !== '') { description += `\nQuality Feedback: ${qualityInfo.feedback}`; }
  const shortDescription = `${systemInfo.systemName}: ${qualityInfo.rating} Call Quality Report`;
  if (qualityInfo.reporter !== '') {
    try {
      let result = await xapi.command('HttpClient Get', { Header: [contentType, snowAuth], Url: `${snowUserUrl}?sysparm_limit=1&email=${qualityInfo.reporter}` });
      result = result.Body;
      [userInfo] = JSON.parse(result).result;
      // Validate User Data, if invalid set to ''
      if ((userInfo === undefined) || (!Number.isNaN(userInfo.sys_id))) {
        userInfo = { sys_id: '' };
      }
    } catch (error) {
      console.error(`raiseTicket getUser error: ${error.message}`);
      userInfo = { sys_id: '' };
    }
  }
  let messageContent;
  if (userInfo.sys_id !== '') {
    messageContent = {
      caller_id: userInfo.sys_id,
      short_description: shortDescription,
      description,
    };
  } else {
    if (qualityInfo.reporter !== '') {
      description += `\nProvided Email Address: ${qualityInfo.reporter}`;
    }
    messageContent = { short_description: shortDescription, description };
  }

  try {
    let result = await xapi.command('HttpClient Post', { Header: [contentType, snowAuth], Url: snowIncidentUrl }, JSON.stringify(messageContent));
    const incidentUrl = result.Headers.find((x) => x.Key === 'Location').Value;
    result = await xapi.command('HttpClient Get', { Header: [contentType, snowAuth], Url: incidentUrl });
    qualityInfo.incident = JSON.parse(result.Body).result.number;
  } catch (error) {
    console.error(`raiseTicket error: ${JSON.stringify(error)}`);
    errorResult = true;
  }
}

// Initial Survey menu shown after call disconnect
function initialMenu() {
  const excellentText = EXCELLENT_DEFAULT ? 'Excellent (default)' : 'Excellent';
  if (callInfo.Duration > CALL_DURATION) {
    xapi.command('UserInterface Message Prompt Display', {
      Duration: 20,
      Title: 'Call Experience Feedback',
      Text: 'How would you rate your call today?',
      FeedbackId: 'call_rating',
      'Option.1': excellentText,
      'Option.2': 'Average',
      'Option.3': 'Poor',
    });
  } else {
    /*
    xapi.command('UserInterface Message Prompt Display', {
      Title: 'Call Experience Feedback?',
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
  if (HTTP_ENABLED) {
    postJSON();
  }
  if (SERVICENOW_ENABLED && qualityInfo.rating !== 'Excellent') {
    await raiseTicket();
  }
  if (WEBEX_ENABLED) {
    await postContent();
  }
  await sleep(600);
  if (showFeedback) {
    if (errorResult) {
      await xapi.command('UserInterface Message Alert Display', {
        Title: 'Error Encountered',
        Text: 'Sorry we were unable to submit your feedback. Please advise your IT Support team of this error.',
        Duration: 20,
      });
      return;
    }
    let textContent = 'Thanks for your feedback!';
    if (qualityInfo.incident) {
      textContent = `Thanks for your feedback, Incident ${qualityInfo.incident} raised.`;
    }
    await xapi.command('UserInterface Message Alert Display', {
      Title: 'Acknowledgement',
      Text: textContent,
      Duration: 5,
    });
  }
  await sleep(3000);
  console.debug('Init Variables');
  initVariables();
}

// Process Call Disconnect event
xapi.event.on('CallDisconnect', (event) => {
  callInfo = event;
  initialMenu();
});

// Process responses to TextInput prompts
xapi.event.on('UserInterface Message TextInput Response', async (event) => {
  switch (event.FeedbackId) {
    case 'feedback_step2':
      qualityInfo.feedback = event.Text;
      await sleep(200);
      xapi.command('UserInterface Message TextInput Display', {
        Duration: 20,
        FeedbackId: 'feedback_step3',
        InputType: 'SingleLine',
        KeyboardState: 'Open',
        Placeholder: 'Email Address',
        SubmitText: 'Submit',
        Text: 'Please advise your email address (optional)',
        Title: 'Call Experience Feedback',
      });
      break;
    case 'feedback_step3':
      qualityInfo.reporter = event.Text;
      processRequest();
      break;
    default:
      console.debug('Unhandled Response');
  }
});

// Process responses to Message prompts
xapi.event.on('UserInterface Message Prompt Response', async (event) => {
  switch (event.FeedbackId) {
    case 'call_rating':
      switch (event.OptionId) {
        case '1':
          qualityInfo.rating = 'Excellent';
          processRequest();
          return;
        case '2':
          qualityInfo.rating = 'Average';
          break;
        case '3':
          qualityInfo.rating = 'Poor';
          break;
        default:
          console.debug('Unhandled Response');
          return;
      }
      // Send Logs for Average/Poor Ratings
      // qualityInfo.logId = xapi.Command.Logging.SendLogs();
      await sleep(200);
      xapi.command('UserInterface Message Prompt Display', {
        Duration: 20,
        Title: 'Call Experience Feedback',
        Text: `What is the primary issue for your rating of ${qualityInfo.rating}?`,
        FeedbackId: 'feedback_step1',
        'Option.1': 'Audio/Video',
        'Option.2': 'Content/Sharing',
        'Option.3': 'Other',
      });
      break;
    case 'feedback_step1':
      switch (event.OptionId) {
        case '1':
          qualityInfo.issue = 'Audio/Video';
          break;
        case '2':
          qualityInfo.issue = 'Content/Sharing';
          break;
        case '3':
          qualityInfo.issue = 'Other';
          break;
        default:
          console.debug('Unhandled Response');
          return;
      }
      await sleep(200);
      xapi.command('UserInterface Message TextInput Display', {
        Duration: 20,
        FeedbackId: 'feedback_step2',
        InputType: 'SingleLine',
        KeyboardState: 'Open',
        Placeholder: 'Additional details here',
        SubmitText: 'Submit',
        Text: 'Please provide any additional details (optional)',
        Title: 'Call Experience Feedback',
      });
      break;
    default:
      console.debug('Unhandled Response');
  }
});

// Process Clear/Cancel/Closure of prompt dialogues
xapi.event.on('UserInterface Message Prompt Cleared', (event) => {
  showFeedback = false;
  switch (event.FeedbackId) {
    case 'call_rating':
      if (EXCELLENT_DEFAULT) {
        qualityInfo.rating = 'Excellent';
        processRequest();
      }
      return;
    case 'feedback_step1':
      processRequest();
      return;
    default:
      console.debug('Unhandled Response');
  }
});

// Process Clear/Cancel/Closure of TextInput dialogues
xapi.event.on('UserInterface Message TextInput Clear', (event) => {
  showFeedback = false;
  switch (event.FeedbackId) {
    case 'feedback_step2':
    case 'feedback_step3':
      processRequest();
      return;
    default:
      console.debug('Unhandled Response');
  }
});

// Debugging Buttons
xapi.event.on('UserInterface Extensions Panel Clicked', (event) => {
  if (event.PanelId === 'test_services') {
    qualityInfo.rating = 'Poor';
    qualityInfo.reporter = 'aileen.mottern@example.com';
    callInfo.Duration = 15;
    callInfo.RequestedURI = 'spark:123456789@webex.com';
    callInfo.CauseType = 'LocalDisconnect';
    processRequest();
  }
  if (event.PanelId === 'test_survey') {
    callInfo.Duration = 15;
    callInfo.RequestedURI = 'spark:123456789@webex.com';
    callInfo.CauseType = 'LocalDisconnect';
    initialMenu();
  }
});

// Initialize Function
async function init() {
  // Get System Name / Contact Name
  systemInfo.systemName = await xapi.status.get('UserInterface ContactInfo Name');
  // Get System SN
  systemInfo.serialNumber = await xapi.status.get('SystemUnit Hardware Module SerialNumber');
  if (systemInfo.systemName === '') {
    systemInfo.systemName = systemInfo.serialNumber;
  }
  // Get SW Version
  systemInfo.softwareVersion = await xapi.status.get('SystemUnit Software Version');
  // HTTP Client needed for sending outbound requests
  await xapi.config.set('HttpClient Mode', 'On');
  initVariables();
}

init();
