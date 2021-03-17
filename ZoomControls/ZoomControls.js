/*
# Zoom Controls Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.1
#
# USE AT OWN RISK, MACRO NOT FULLY TESTED NOR SUPPLIED WITH ANY GURANTEE
#
# Usage - Shows DTMF Controls Menu during Zoom Call and adds Join Zoom button to UI Controller
#
# Change History
# 1.0 20210308 Initial Release
# 1.1 20210317 Add option to remove Join Zoom button
#
*/
import xapi from 'xapi';

const ZOOMDIALPAD_DOMAIN = '@zmau.us'
const ZOOMDIALPAD_ID = 'zoom_dialpad';
const ZOOMJOIN_PANELID = 'zoom_join';
const ZOOMCONTROLS_PANELID = 'zoom_controls';
const ZOOM_MATCHURI = "(@zm..\.us|@zoomcrc.com)";

// Set to False to not add "Join Zoom" button to UI
const ZOOM_ADDJOINBUTTON = true;

const sleep = (timeout) => new Promise((resolve) => {
  setTimeout(resolve, timeout);
});

// Function to show Zoom Dialpad 
function showDialPad(){
         xapi.command("UserInterface Message TextInput Display", {
               InputType: 'Numeric'
             , Placeholder: 'Conference ID'
             , Title: "Zoom Meeting"
             , Text: "Enter the Zoom Meeting Number"
             , SubmitText: "Dial" 
             , FeedbackId: ZOOMDIALPAD_ID
         }).catch((error) => { console.error(error); });
}

// This is the listener for the in-room control panel button that will trigger the dial panel to appear
xapi.event.on('UserInterface Extensions Panel Clicked', (event) => {
    if(event.PanelId === ZOOMJOIN_PANELID){
         showDialPad();
    }
});

// Attempt dial URI appending Zoom Domain
xapi.event.on('UserInterface Message TextInput Response', (event) => {
    switch(event.FeedbackId){
        case ZOOMDIALPAD_ID:
        const myText = String(event.Text)
            const numbertodial = myText + ZOOMDIALPAD_DOMAIN;
            xapi.command("dial", {Number: numbertodial}).catch((error) => { console.error(error); });
            break;
    }
});

// Function to send the DTMF tones during the call.  This receives the DTMF tones from the Event Listenter below.
async function sendDTMF(code, message) {
    console.log(message);

    try {
        const Level = await xapi.Status.Audio.Volume.get();
        await xapi.Command.Audio.Volume.Set({
            Level: "30",
        });
        console.debug("Volume set to 30");

        await sleep(200);
        xapi.Command.Call.DTMFSend({
            DTMFString: code,
        });
        console.debug("DTMF Values Sent")

        await sleep(750);
        await xapi.Command.Audio.Volume.Set({
            Level
        });
        console.debug("Volume Set Back to " + Level)

    } catch (error) {
        console.error(error);
    }
}

// Event Listener - In this listener we are checking against various Widget ID's to see if they are pressed
// If they are we then send the appropriate DTMF tones to the sendDTMF function listed above.  
xapi.Event.UserInterface.Extensions.Widget.Action.on((event) => {
  if (event.Type !== 'pressed'){
    return;
  }
    switch (event.WidgetId) {
      case "changelayout":
        return sendDTMF(11, 'Change Layout was Pressed');
      
      case "audiomute":
        return sendDTMF(12, 'Audio was Pressed');
        
      case "videomute":
        return sendDTMF(14, 'Video Mute was Pressed');
        
      case "record":
        return sendDTMF(15, 'Record was Pressed');
        
      case "videonames":
        return sendDTMF(102, 'Toggle Names was Pressed');
      
      case "participants":
        return sendDTMF(106, 'Show Participants was Pressed');

      case "chat":
        return sendDTMF(107, 'Toggle Chat was Pressed');

      case "captions":
        return sendDTMF(108, 'Toggle Chat was Pressed');

      case "gallerynext":
        return sendDTMF(106, 'Gallery Next was Pressed');

      case "galleryprevious":
        return sendDTMF(104, 'Gallery Previous was Pressed');     
        
      case "exit":
        return sendDTMF("*", 'Exit was Pressed');
        
    }});

async function addZoomJoin() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions) {
    const zoomJoin = config.Extensions.Panel.find((panel) => panel.PanelId === ZOOMJOIN_PANELID);
    if (zoomJoin) {
      console.debug('ZoomJoin already added');
      return;
    }
  }

  console.debug(`Adding ZoomJoin`);
  const xml = `<?xml version="1.0"?>
  <Extensions>
  <Version>1.8</Version>
  <Panel>
    <Order>1</Order>
    <PanelId>${ZOOMJOIN_PANELID}</PanelId>
    <Origin>local</Origin>
    <Type>Home</Type>
    <Icon>Camera</Icon>
    <Color>#07C1E4</Color>
    <Name>Join Zoom</Name>
    <ActivityType>Custom</ActivityType>
  </Panel>
  </Extensions>`;

  await xapi.Command.UserInterface.Extensions.Panel.Save({
    PanelId: ZOOMJOIN_PANELID,
  }, xml);
}

async function addZoomControls() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions) {
    const panelExist = config.Extensions.Panel.find((panel) => panel.PanelId === ZOOMCONTROLS_PANELID);
    if (panelExist) {
      console.debug('ZoomControls already added');
      return;
    }
  }

  console.debug(`Adding ZoomControls`);
  const xml = `<?xml version="1.0"?>
  <Extensions>
  <Version>1.8</Version>
  <Panel>
    <Order>2</Order>
    <PanelId>zoom_controls</PanelId>
    <Origin>local</Origin>
    <Type>InCall</Type>
    <Icon>Sliders</Icon>
    <Color>#A866FF</Color>
    <Name>Zoom Controls</Name>
    <ActivityType>Custom</ActivityType>
    <Page>
      <Name>Zoom In Call Control Panel</Name>
      <Row>
        <Name>Call Controls</Name>
        <Widget>
          <WidgetId>changelayout</WidgetId>
          <Name>Change Layout</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>audiomute</WidgetId>
          <Name>Mute</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
      </Row>
      <Row>
        <Name>Meeting Controls</Name>
        <Widget>
          <WidgetId>videomute</WidgetId>
          <Name>Video Mute</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>record</WidgetId>
          <Name>Record</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>videonames</WidgetId>
          <Name>Toggle Names</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>participants</WidgetId>
          <Name>Show Participants</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>chat</WidgetId>
          <Name>Toggle Chat</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>captions</WidgetId>
          <Name>Toggle Captions</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
      </Row>
      <Row>
        <Name>Gallery View Controls</Name>
        <Widget>
          <WidgetId>gallerynext</WidgetId>
          <Name>Next</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>galleryprevious</WidgetId>
          <Name>Previous</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
      </Row>
      <Row>
        <Name>Exit</Name>
        <Widget>
          <WidgetId>widget_14</WidgetId>
          <Type>Spacer</Type>
          <Options>size=1</Options>
        </Widget>
        <Widget>
          <WidgetId>exit</WidgetId>
          <Name>Menu Exit</Name>
          <Type>Button</Type>
          <Options>size=2</Options>
        </Widget>
        <Widget>
          <WidgetId>widget_12</WidgetId>
          <Type>Spacer</Type>
          <Options>size=1</Options>
        </Widget>
      </Row>
      <Options/>
    </Page>
  </Panel>
  </Extensions>`;

  await xapi.Command.UserInterface.Extensions.Panel.Save({
    PanelId: ZOOMCONTROLS_PANELID,
  }, xml);
}

async function removeZoomControls() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions) {
    const panelExist = config.Extensions.Panel.find((panel) => panel.PanelId === ZOOMCONTROLS_PANELID);
    if (!panelExist) {
      console.debug('ZoomControls does not exist');
      return;
    }
  }

  console.debug(`Removing ZoomControls`);
  await xapi.Command.UserInterface.Extensions.Panel.Close();
  await xapi.Command.UserInterface.Extensions.Panel.Remove({
    PanelId: ZOOMCONTROLS_PANELID,
  });
}

async function removeZoomJoin() {
  const config = await xapi.Command.UserInterface.Extensions.List();
  if (config.Extensions) {
    const panelExist = config.Extensions.Panel.find((panel) => panel.PanelId === ZOOMJOIN_PANELID);
    if (!panelExist) {
      console.debug('ZoomJoin does not exist');
      return;
    }
  }

  console.debug(`Removing ZoomJoin`);
  await xapi.Command.UserInterface.Extensions.Panel.Close();
  await xapi.Command.UserInterface.Extensions.Panel.Remove({
    PanelId: ZOOMJOIN_PANELID,
  });
}

// Init function - Listen for Calls and check if matches partial Zoom URI
function init() {

  // Implement Zoom Join button selection
  if (ZOOM_ADDJOINBUTTON) {
    addZoomJoin();
  } else {
    removeZoomJoin();
  }
  
  // Remove lingering Zoom Controls during init.
  removeZoomControls();

  xapi.Event.OutgoingCallIndication.on(async () => {
  //xapi.Event.CallSuccessful.on(async () => {
    const call = await xapi.Status.Call.get();
    if (call.length < 1) {
      // No Active Call
      return;
    }
    console.debug(call[0].CallbackNumber);
    if (call[0].CallbackNumber.match(ZOOM_MATCHURI)) {
      // Matched Zoom Call, Add Zoom Controls Panel
      console.debug("Invoke Add Zoom Controls");
      addZoomControls();
    }
  });
  
  xapi.Event.CallDisconnect.on(() => {
    // Call Disconnect detected, remove Zoom Panel
    console.debug("Invoke Remove Zoom Controls");
    removeZoomControls();
  });
}

// Initialize Function
init();