// Zoom In-Call Controls
import xapi from 'xapi';

const sleep = (timeout) => new Promise((resolve) => {
  setTimeout(resolve, timeout);
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

// Define Zoom URIs
const UriBridge = "(@zm..\.us|@zoomcrc.com)";

// Define Panel Function
function setPanel(panelId, visibility) {
  xapi.Command.UserInterface.Extensions.Panel.Update({PanelId: panelId, Visibility: visibility})
}

// Listen for Calls and check if matches partial Zoom URI
function listenToCalls() {

  // Default Set UI Panel Hidden
  console.debug("Startup hide Zoom Controls");
  setPanel("zoom_controls","hidden");

  xapi.Event.OutgoingCallIndication.on(async () => {
  //xapi.Event.CallSuccessful.on(async () => {
    const call = await xapi.Status.Call.get();
    if (call.length < 1) {
      // No Active Call
      return;
    }
    console.debug(call[0].CallbackNumber);
    if (call[0].CallbackNumber.match(UriBridge)) {
      // Matched Zoom Call, Set UI Panel Auto (In Call from UI Editor)
      console.debug("Add Zoom Controls");
      setPanel("zoom_controls","auto");
    }
  });
  
  xapi.Event.CallDisconnect.on(() => {
    // Call Disconnect detected, set UI Panel Hidden
    console.debug("Remove Zoom Controls");
    setPanel("zoom_controls","hidden");
  });
}

// Initialize Function
listenToCalls();

