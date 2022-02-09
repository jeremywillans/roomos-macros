/*
# Customer Satisfaction Survey Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.0
#
# USE AT OWN RISK, MACRO NOT FULLY TESTED NOR SUPPLIED WITH ANY GURANTEE
#
# Usage - Shows Survery at end of call which output into Webex Space and/or Serivce Now Incident.
#
# Change History
# 1.0 20210308 Initial Release
# 1.1 20220209 Add Timeout to Issue Prompt
#
*/
const xapi = require('xapi');

const ROOMID = '#### ROOMID ####'; // Specify a Room ID
const BOTID = '#### BOTID ####'; // Specify a Bot ID
const WEBEX_AUTHTOKEN = "Authorization: Bearer " + BOTID
const CONTENT_TYPE = "Content-Type: application/json";
const ACCEPT_TYPE = "Accept: application/json";
const MESSAGE_URL = 'https://webexapis.com/v1/messages'; // Message URL

const SERVICE_NOW_INSTANCE_URL = '#### INSTANCE ####.service-now.com'; // Specify a URL to a service like serviceNow etc.
const INCIDENT_URL = 'https://' + SERVICE_NOW_INSTANCE_URL + '/api/now/table/incident'; // Specify a URL to a service like serviceNow etc.
const USERS_URL = 'https://' + SERVICE_NOW_INSTANCE_URL + '/api/now/table/sys_user'; // Specify a URL to a service like serviceNow etc.
const SERVICENOW_USERNAMEPWD_BASE64 = '#### BASE64_CREDS ####'; // format is "username:password" for basic Authorization. This needs to be base64-encoded. Use e.g. https://www.base64encode.org/ to do this
const SERVICENOW_AUTHTOKEN = "Authorization: Basic " + SERVICENOW_USERNAMEPWD_BASE64; // SNOW PERMISSIONS NEEDED - sn_incident_write

const WEBEXSPACE_ENABLED = false; // Enable for Webex Space Message Logging
const SERVICENOW_ENABLED = false; // Enable for Service NOW Incident Raise

const CLEANUP_TIMEOUT = 3000; // Milliseconds before cleanup variables
const CALL_DURATION = 10; // Mininium call duration (seconds) before Survey is displayed

var callInfo = {}, systemInfo = {}, userInfo = {}, qualityInfo = {};

// Initialize Variable 
function initVariables() {
  qualityInfo = {
      rating : ''
    , issue : ''
    , feedback : ''
    , reporter : ''
    , incident : ''
  };
  userInfo = { sys_id: '' };
}

// Sleep Function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Time Formatting Function
function formatTime(seconds) {
  let d = Math.floor(seconds / 3600 / 24);
  let h = Math.floor(seconds / 3600 % 24);
  let m = Math.floor(seconds % 3600 / 60);
  let s = Math.floor(seconds % 3600 % 60);
  let dDisplay = d > 0 ? d + (d == 1 ? (h >  0 || m > 0 ? " day, " : " day") : (h >  0 || m > 0 ? " days, " : " days")) : "";
  let hDisplay = h > 0 ? h + (h == 1 ? (m >  0 || s > 0 ? " hour, " : " hour") : (m >  0 || s > 0 ? " hours, " : " hours")) : "";
  let mDisplay = m > 0 ? m + (m == 1 ? " minute" : " minutes") : "";
  let sDisplay = s > 0 ? s + (s == 1 ? " second" : " seconds") : "";

  if (m < 1) {
    return dDisplay + hDisplay + mDisplay + sDisplay; 
  }
  else {
    return dDisplay + hDisplay + mDisplay; 
  }
}

// Process Enabled Services
function processRequest() {
  if (SERVICENOW_ENABLED) {
    raiseTicket();
  }
  if ((WEBEXSPACE_ENABLED) && (!SERVICENOW_ENABLED)) {
    postContent();
  }
  sleep(CLEANUP_TIMEOUT).then(() => {
    console.debug('Init Variables');
    initVariables();
  });
}

// Post Content to Webex Space
function postContent(){
  //console.log('Process postContent function');
  let blockquote;
  switch (qualityInfo.rating) {
    case 'Average':
      blockquote = '<blockquote class=warning>';
      break;
    case 'Poor':
      blockquote = '<blockquote class=danger>';
      break;
  }

  var markdown = ('**Call Quality Report - ' + qualityInfo.rating + '**' + blockquote +
    '**System Name:** ' + systemInfo.systemName +
    '  \n**Serial Number:** ' + systemInfo.serialNumber +
    '  \n**SW Release:** ' + systemInfo.softwareVersion)
  if (callInfo.RequestedURI != '') { markdown += ('\n**Dial String:** `' + callInfo.RequestedURI + '`') };
  if (callInfo.Duration != '') { markdown += ('  \n**Call Duration:** ' + formatTime(callInfo.Duration)) };
  if (callInfo.CauseType != '') { markdown += ('  \n**Disconnect Cause:** ' + callInfo.CauseType) };
  if (qualityInfo.issue != '') { markdown += ('  \n**Quality Issue:** ' + qualityInfo.issue) };
  if (qualityInfo.feedback != '') { markdown += ('  \n**Quality Feedback:** ' + qualityInfo.feedback) };
  if (qualityInfo.incident != '') { markdown += ('  \n**Incident Ref:** ' + qualityInfo.incident) };
  if (userInfo.sys_id != '') {
    markdown += ('  \n**Reporter:**  [' + userInfo.name + '](webexteams://im?email=' + userInfo.email + ') (' + userInfo.email + ')') 
  } else if (qualityInfo.reporter != '') { 
    // Include Provided Email if not matched in SNOW
    markdown += ('  \n**Provided Email:** ' + qualityInfo.reporter);
  };
  markdown += '</blockquote>'

  var messagecontent = {roomId: ROOMID, markdown};

  xapi.command('HttpClient Post', {'Header': [CONTENT_TYPE, ACCEPT_TYPE, WEBEX_AUTHTOKEN], 'Url': MESSAGE_URL}, JSON.stringify(messagecontent))
  .then((result) => {
    if (!SERVICENOW_ENABLED) {
      if (result.StatusCode = '200') {
        xapi.command("UserInterface Message Alert Display", {
            Title: 'Acknowledgement'
          , Text: 'Thanks for you feedback!'
          , Duration: 5
        }).catch((error) => { console.error(error); })
      } else {
        console.error(result);
        xapi.command("UserInterface Message Alert Display", {
            Title: 'Error Encountered'
          , Text: 'Sorry we were unable to submit your feedback. Please advise your IT Support team of this error.'
          , Duration: 5
        }).catch((error) => { console.error(error); })
      }
    }
  })
  .catch((error) => { console.error(error); })
}

// Service Now Get Sub-Function to Obtain Incident URL
function getServiceNowIncidentIdFromURL(url) {
    return xapi.command('HttpClient Get', { 'Header': [CONTENT_TYPE, SERVICENOW_AUTHTOKEN] , 'Url': url});
}

// Service Now Get Sub-Function to Obtain User Data
function getServiceNowUserIdFromEmail(email) {
  var URL = USERS_URL + '?sysparm_limit=1&email=' + email
  return xapi.command('HttpClient Get', { 'Header': [CONTENT_TYPE, SERVICENOW_AUTHTOKEN] , 'Url': URL });
}

// Debugging Button
xapi.event.on('UserInterface Extensions Panel Clicked', (event) => {
  if(event.PanelId == 'call_disconnect'){
    qualityInfo.rating = 'Poor';
    qualityInfo.reporter = 'aileen.mottern@example.com';
    callInfo.Duration = 15;
    callInfo.RequestedURI = 'spark:123456789@webex.com'
    callInfo.CauseType = 'LocalDisconnect'
    processRequest();
  }
});

// Raise Ticket in Service Now Instance
async function raiseTicket(){
  //console.log('Process raiseTicket function');
  var description = ('Call Quality Report - ' + qualityInfo.rating +
    '\n\nSystem Name: ' + systemInfo.systemName +
    '\nSerial Number: ' + systemInfo.serialNumber +
    '\nSW Release: ' + systemInfo.softwareVersion)
  if (callInfo.RequestedURI != '') { description += ('\n\nDial String: ' + callInfo.RequestedURI) };
  if (callInfo.Duration != '') { description += ('\nCall Duration:< ' + formatTime(callInfo.Duration)) };
  if (callInfo.CauseType != '') { description += ('\nDisconnect Cause: ' + callInfo.CauseType) };
  if (qualityInfo.issue != '') { description += ('\n\nQuality Issue: ' + qualityInfo.issue) };
  if (qualityInfo.feedback != '') { description += ('\nQuality Feedback: ' + qualityInfo.feedback) };
  var short_description = systemInfo.systemName + ': ' + qualityInfo.rating + ' Call Quality Report'
  if (qualityInfo.reporter != '') {
    await getServiceNowUserIdFromEmail(qualityInfo.reporter).then(
      (result) => {
        var body = result.Body;
        userInfo = JSON.parse(body).result[0]
        // Validate User Data, if invalid set to ''
        if ((userInfo === undefined) || (!isNaN(userInfo.sys_id))) {
          userInfo = {sys_id: ''};
        }
      }
    )
  }
  var messagecontent;
  if (userInfo.sys_id != '') {
    messagecontent = {caller_id: userInfo.sys_id, short_description: short_description, description: description};
  } else {
    if (qualityInfo.reporter != '') {
      description += ('\nProvided Email Address: ' + qualityInfo.reporter);
    }
    messagecontent = {short_description: short_description, description: description};
  }

  //console.log(JSON.stringify(messagecontent));
  xapi.command('HttpClient Post', { 'Header': [CONTENT_TYPE, SERVICENOW_AUTHTOKEN] , 'Url': INCIDENT_URL}, JSON.stringify(messagecontent)).then(
  (result) => {
    const serviceNowIncidentLocation = result.Headers.find(x => x.Key === 'Location');
    var serviceNowIncidentURL = serviceNowIncidentLocation.Value;
    var serviceNowIncidentTicket;
    getServiceNowIncidentIdFromURL(serviceNowIncidentURL).then(
    (result) => {
      var body = result.Body;
      //console.log('Got this from getServiceNowIncidentIdFromURL: ' + JSON.stringify(result));
      serviceNowIncidentTicket =  JSON.parse(body).result.number;
      xapi.command("UserInterface Message Alert Display", {
          Title: 'Acknowledgement'
        , Text:  'Thanks for your feedback, Incident ' + serviceNowIncidentTicket + ' raised.'
        , Duration: 20
      }).catch((error) => { console.error(error); })
      if (WEBEXSPACE_ENABLED) {
        qualityInfo.incident = serviceNowIncidentTicket;
        postContent();
      }
    });
    //console.log('Got this from raiseTicket: ' + JSON.stringify(result));
  });
}

// Process Call Disconnect Event
xapi.event.on('CallDisconnect', (event) => {
  callInfo = event;
  if(event.Duration > CALL_DURATION) {
    xapi.command("UserInterface Message Prompt Display", {
        Duration: 20
      , Title: "Call Experience Feedback"
      , Text: 'How would you rate your call today?'
      , FeedbackId: 'callrating'
      , 'Option.1' : 'Excellent'
      , 'Option.2' : 'Average'
      , 'Option.3' : 'Poor'
      }).catch((error) => { console.error(error); });
  } else {
    /*
    xapi.command("UserInterface Message Prompt Display", {
        Title: "Call Experience Feedback?"
      , Text: 'Call did not complete. What happened?'
      , FeedbackId: 'nocallrating'
      , 'Option.1': 'I dialled the wrong number!'
      , 'Option.2': 'Call did not answer'
      , 'Option.3': 'Oops, wrong button'
    }).catch((error) => { console.error(error); });
    */
  }
});

// Process responses to TextInput Prompts
xapi.event.on('UserInterface Message TextInput Response', (event) => {
  switch(event.FeedbackId){
    case 'feedback_step2':
      qualityInfo.feedback = event.Text;
      sleep(200).then(() => {
        xapi.command("UserInterface Message TextInput Display", {
            Duration: 20
          , FeedbackId: "feedback_step3"
          , InputType: "SingleLine"
          , KeyboardState: "Open"
          , Placeholder: "Email Address"
          , SubmitText: "Submit"
          , Text: "Please advise your email address (optional)"
          , Title: "Call Experience Feedback"
        }).catch((error) => { console.error(error); });
      });
      break;
    case 'feedback_step3':
      qualityInfo.reporter = event.Text;
      processRequest();
  }
});

// Process responses to Message Prompts
xapi.event.on('UserInterface Message Prompt Response', (event) => {
  switch(event.FeedbackId){
    case 'callrating':
      switch(event.OptionId) {
        case '1':
          xapi.command("UserInterface Message Alert Display", {
              Title: 'Acknowledgement'
            , Text: 'Thanks for you feedback! Have an awesome day!'
            , Duration: 5
          }).catch((error) => { console.error(error); })
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
      sleep(200).then(() => {
        xapi.command("UserInterface Message Prompt Display", {
            Duration: 20,
            Title: "Call Experience Feedback"
          , Text: 'What is the primary issue for your rating of ' + qualityInfo.rating + '?'
          , FeedbackId: 'feedback_step1'
          , 'Option.1': 'Audio/Video'
          , 'Option.2': 'Content/Sharing'
          , 'Option.3': 'Other'
          }).catch((error) => { console.error(error);
        });
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
      };
      sleep(200).then(() => {
        xapi.command("UserInterface Message TextInput Display", {
            Duration: 20
          , FeedbackId: "feedback_step2"
          , InputType: "SingleLine"
          , KeyboardState: "Open"
          , Placeholder: "Additional details here"
          , SubmitText: "Submit"
          , Text: "Please provide any additional details (optional)"
          , Title: "Call Experience Feedback"
        }).catch((error) => { console.error(error); });
      });
      break;
    }
});

// Process Clear/Cancel/Closure of Prompt dialogues
xapi.event.on('UserInterface Message Prompt Cleared', (event) => {
  switch(event.FeedbackId) {
    case 'feedback_step1':
      processRequest();
  }
});

// Process Clear/Cancel/Closure of TextInput dialogues
xapi.event.on('UserInterface Message TextInput Clear', (event) => {
  switch(event.FeedbackId) {
    case 'feedback_step2':
    case 'feedback_step3':
      processRequest();
  }
});

// Initialize Function
function init(){
  // Get System Name / Contact Name
  //xapi.config.get('SystemUnit Name').then((value) => {
  xapi.status.get('UserInterface ContactInfo Name').then((value) => {
    if (value === '') {
      xapi.status.get('SystemUnit Hardware Module SerialNumber').then((value) => {
        systemInfo.systemName = value;
      });
    }
    else{
      systemInfo.systemName = value;
    }
  });
  // Get System SN
  xapi.status.get('SystemUnit Hardware Module SerialNumber').then((value) => {
    systemInfo.serialNumber = value;
  });
  // Get SW Version
  xapi.status.get('SystemUnit Software Version').then((value) => {
    systemInfo.softwareVersion = value;
  });
  // HTTP Client needed for sending outbound requests
  xapi.config.set('HttpClient Mode', 'On');
  initVariables();
}

init();