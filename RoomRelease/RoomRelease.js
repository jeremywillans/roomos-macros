/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
/*
# Room Release Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.1
#
# USE AT OWN RISK, MACRO NOT FULLY TESTED NOR SUPPLIED WITH ANY GUARANTEE
#
# Usage - Automatically releases a room booking based on occupancy metrics from the Cisco codec
#
# Credit - rudferna@cisco.com, as the original author of the room release macro
#
# Change History
# 1.0 20230811 Initial Release
# 1.1 20230814 Revise Ultrasound detections
#
*/
// eslint-disable-next-line import/no-unresolved
import xapi from 'xapi';

// Occupancy Detections
const detectSound = false; // Use sound level to consider room occupied (set level below)
const detectUltrasound = false; // Use Ultrasound for presence detection (eg. glass walls)

// Disable Occupancy Checks
const buttonStopChecks = false; // Stop further occupancy checks after touch panel check in
const occupiedStopChecks = false; // Stop further periodic checks after room considered occupied

// Thresholds and Timers
const minBeforeRelease = 5; // (Minutes) minimum duration empty until room is considered for release
const minBeforeOccupied = 15; // (Minutes) minimum duration (in a row) until considered occupied
const soundLevel = 50; // (dB) Minimum sound level required to consider occupied
const ignoreLongerThan = 2; // (Hours) meetings longer than this duration will be skipped
const promptDuration = 60; // (Seconds) time to display Check in prompt before room declines invite
const periodicInterval = 2; // (Minutes) duration to perform forced periodic occupancy check

// Other Parameters
const debugMode = true; // Enable debug logging
const playAnnouncement = true; // Play announcement tone when displaying check in prompt

// ----- EDIT BELOW THIS LINE AT OWN RISK ----- //

// Occupancy Parameters (recommend leave enabled)
const detectActiveCalls = true; // active call for detection (inc airplay)
const detectInteraction = true; // UI extensions (panel, button, slider etc) to detect presence.
const detectPresentation = true; // presentation sharing for detection

const feedbackId = 'alertResponse';
let alertDuration;
let alertInterval;
let deleteTimeout;
let periodicUpdate;
let bookingIsActive = false;
let listenerShouldCheck = true;
let bookingId;
let ignoreBooking = false;
let roomIsEmpty = false;
let lastFullTimer = 0;
let lastEmptyTimer = 0;

const metrics = {
  peopleCount: 0,
  peoplePresence: false,
  ultrasound: false,
  inCall: false,
  presenceSound: false,
  sharing: false,
};

// Display check in prompt and play announcement tone
function promptUser() {
  xapi.Command.UserInterface.Message.Prompt.Display({
    Title: 'Unoccupied Room',
    Text: 'Please Check-In below to retain this Room Booking.',
    FeedbackId: feedbackId,
    'Option.1': 'Check-In',
  }).catch((error) => { console.error(error); });

  if (!playAnnouncement) return;
  xapi.Command.Audio.Sound.Play({
    Loop: 'off', Sound: 'Announcement',
  }).catch((error) => { console.error(error); });
}

// OSD countdown message for check in
function updateEverySecond() {
  alertDuration -= 1;
  if (alertDuration <= 0) {
    clearInterval(alertInterval);
    xapi.Command.UserInterface.Message.TextLine.Clear({});
    return;
  }
  xapi.Command.UserInterface.Message.TextLine.Display({
    text: `Unoccupied Room Alert! It will be released in ${alertDuration} seconds.<br>Please use Touch Panel to retain booking.`,
    duration: 0,
  }).catch((error) => { console.error(error); });

  // Forced message display every 5 seconds
  if (alertDuration % 5 === 0) {
    promptUser();
  }
}

// Clear existing alerts
function clearAlerts() {
  xapi.Command.UserInterface.Message.Prompt.Clear({ FeedbackId: feedbackId });
  xapi.Command.UserInterface.Message.TextLine.Clear({});
  clearTimeout(deleteTimeout);
  clearInterval(alertInterval);
  roomIsEmpty = false;
}

// Configure Cisco codec for occupancy metrics
async function configureCodec() {
  console.info('Processing Codec configurations...');
  await xapi.Config.HttpClient.Mode.set('On');
  await xapi.Config.RoomAnalytics.PeopleCountOutOfCall.set('On');
  await xapi.Config.RoomAnalytics.PeoplePresenceDetector.set('On');
}

// Determine if room is occupied based on enabled detections
function isRoomOccupied() {
  if (debugMode) {
    console.debug(`Presence: ${metrics.peoplePresence} | [${detectUltrasound ? 'X' : ' '}] Ultrasound: ${metrics.ultrasound} \
| [${detectActiveCalls ? 'X' : ' '}] In Call: ${metrics.inCall} | [${detectSound ? 'X' : ' '}] Sound (> ${soundLevel}): ${metrics.presenceSound} \
| [${detectPresentation ? 'X' : ' '}] Share: ${metrics.sharing} `);
  }
  const currentStatus = metrics.peoplePresence // People presence
    || (detectActiveCalls && metrics.inCall) // Active call detection
    || (detectSound && metrics.presenceSound) // Sound detection
    || (detectPresentation && metrics.sharing) // Presentation detection
    || (detectUltrasound && metrics.ultrasound); // Ultrasound detection

  if (debugMode) console.debug(`OCCUPIED: ${currentStatus}`);
  return currentStatus;
}

// Countdown timer before meeting decline
function startCountdown() {
  if (ignoreBooking) {
    if (debugMode) console.debug(`Booking removal bypassed as meeting is longer than ${ignoreLongerThan} hours`);
    return;
  }
  if (debugMode) console.debug('Start countdown initiated');
  promptUser();

  alertDuration = promptDuration;
  alertInterval = setInterval(updateEverySecond, 1000);

  // Process Meeting Removal
  deleteTimeout = setTimeout(async () => {
    if (debugMode) console.debug('Initiate Booking removal from device.');
    xapi.Command.UserInterface.Message.Prompt.Clear({ FeedbackId: feedbackId });
    xapi.Command.Audio.Sound.Stop();
    xapi.Command.UserInterface.Message.TextLine.Clear({});
    clearInterval(periodicUpdate);

    // We get the updated meetingId to send meeting decline
    const booking = await xapi.Command.Bookings.Get({ Id: bookingId });
    await xapi.Command.Bookings.Respond({
      Type: 'Decline',
      MeetingId: booking.Booking.MeetingId,
    }).catch((error) => { console.error(error); });
    if (debugMode) console.debug('Booking removed.');

    bookingId = null;
    bookingIsActive = false;
    lastFullTimer = 0;
    lastEmptyTimer = 0;
    roomIsEmpty = false;
  }, promptDuration * 1000);
}

// Process occupancy metrics gathered from the Cisco codec.
function processOccupancy() {
  if (isRoomOccupied()) {
    if (lastFullTimer === 0) {
      if (debugMode) console.debug('Room occupancy detected - starting timer...');
      lastFullTimer = Date.now();
      lastEmptyTimer = 0;
    } else if (Date.now() > (lastFullTimer + (minBeforeOccupied * 60000))) {
      if (debugMode) console.debug('minBeforeOccupied reached - room considered occupied');
      roomIsEmpty = false;
      lastFullTimer = Date.now();
      if (occupiedStopChecks) {
        // stop further checks as room is considered occupied
        if (debugMode) console.debug('future checks stopped for this booking');
        listenerShouldCheck = false;
        clearInterval(periodicUpdate);
      }
    }
  } else if (lastEmptyTimer === 0) {
    if (debugMode) console.debug('Room empty detected - starting timer...');
    lastEmptyTimer = Date.now();
    lastFullTimer = 0;
  } else if (Date.now() > (lastEmptyTimer + (minBeforeRelease * 60000)) && !roomIsEmpty) {
    if (debugMode) console.debug('minBeforeRelease reached - room considered empty');
    roomIsEmpty = true;
  }

  if (roomIsEmpty) {
    if (listenerShouldCheck) {
      listenerShouldCheck = false;
      console.warn('Room is empty start countdown for delete booking');
      startCountdown();
    }
  }
}

// Promise return function
function getData(command) {
  return xapi.status.get(command).catch((error) => {
    console.warning('Unable to perform command:', command, ' Error: ', error);
    return -1;
  });
}

// Poll codec to retrieve occupancy metrics
async function updateOccupancy() {
  try {
    const results = await Promise.all([
      getData('SystemUnit State NumberOfActiveCalls'),
      getData('RoomAnalytics UltrasoundPresence'),
      getData('RoomAnalytics PeoplePresence'),
      getData('RoomAnalytics PeopleCount Current'),
      getData('RoomAnalytics Sound Level A'),
      getData('Conference Presentation Mode'),
    ]);
    const numCalls = Number(results[0]);
    const ultrasound = results[1] === 'Yes';
    const presence = results[2] === 'Yes';
    const peopleCount = Number(results[3]);
    const soundResult = Number(results[4]);
    const presentationMode = results[5] !== 'Off';

    metrics.sharing = presentationMode;
    // Process People Metrics
    metrics.peopleCount = peopleCount === -1 ? 0 : peopleCount;
    metrics.peoplePresence = presence;
    metrics.ultrasound = ultrasound;

    // Process Active Calls
    if (numCalls > 0 && detectActiveCalls) {
      metrics.inCall = true;
      // if in call we assume that people are present
      metrics.peoplePresence = true;
    } else {
      metrics.inCall = false;
    }

    // Process Sound Level
    if ((soundResult > soundLevel) && detectSound) {
      metrics.presenceSound = true;
    } else {
      metrics.presenceSound = false;
    }

    processOccupancy();
  } catch (error) {
    console.warn('Unable to process occupancy metrics from Codec');
  }
}

// Process meeting logic
async function processBooking(id) {
  await updateOccupancy(); // initialize data
  bookingId = id;

  // Validate booking
  const availability = await xapi.Status.Bookings.Availability.Status.get();
  if (availability === 'BookedUntil') {
    const booking = await xapi.Command.Bookings.Get({ Id: id });
    ignoreBooking = false; // ensure set to false
    bookingIsActive = true;
    listenerShouldCheck = true;

    // Calculate meeting length
    let duration = 0;
    try {
      const t = booking.Booking.Time;
      duration = ((Number(t.SecondsUntilEnd) + Number(t.SecondsSinceStart)) / 3600).toFixed(2);
    } catch (error) {
      console.warn('Unable to parse Meeting Length');
    }
    // update ignoreBooking based on meeting length
    if (debugMode) console.debug(`calculated meeting length: ${duration}`);
    if (duration >= ignoreLongerThan) {
      if (debugMode) console.debug(`enabling ignoreBooking as equal/longer than ${ignoreLongerThan} hours`);
      ignoreBooking = true;
    }

    // Update checks to periodically validate room status.
    periodicUpdate = setInterval(() => {
      if (isRoomOccupied()) {
        if ((lastFullTimer !== 0)) {
          if (Date.now() > (lastFullTimer + periodicInterval * 60000)) {
            if (debugMode) console.debug('initiating occupied periodic processing of occupancy metrics');
            processOccupancy();
          }
        }
      } else if (lastEmptyTimer !== 0) {
        // eslint-disable-next-line max-len
        if (Date.now() > (lastEmptyTimer + periodicInterval * 60000) && !roomIsEmpty) {
          if (debugMode) console.debug('initiating empty periodic processing of occupancy metrics');
          processOccupancy();
        }
      } else if ((lastFullTimer !== 0)) {
        if (Date.now() > (lastFullTimer + periodicInterval * 60000)) {
          if (debugMode) console.debug('initiating invalid periodic processing of occupancy metrics');
          processOccupancy();
        }
      }
    }, (60000) + 1000);
  } else {
    bookingId = null;
    ignoreBooking = false;
    lastFullTimer = 0;
    lastEmptyTimer = 0;
    roomIsEmpty = false;
    console.warn('Booking was detected without end time!');
  }
}

// Handle message prompt response
xapi.Event.UserInterface.Message.Prompt.Response.on((event) => {
  if (event.FeedbackId === feedbackId && event.OptionId === '1') {
    if (debugMode) console.debug('Local Check-in performed from Touch Panel');
    clearTimeout(deleteTimeout);
    clearInterval(alertInterval);
    xapi.Command.UserInterface.Message.TextLine.Clear({});
    listenerShouldCheck = true;
    metrics.peoplePresence = true;
    roomIsEmpty = false;
    lastFullTimer = Date.now();
    lastEmptyTimer = 0;
    if (buttonStopChecks) {
      if (debugMode) console.debug('future checks stopped for this booking');
      clearInterval(periodicUpdate);
      listenerShouldCheck = false;
    }
  }
});

// -- Codec Event and Status Subscriptions -- //

// Process booking start
xapi.Event.Bookings.Start.on(async (event) => {
  console.log(`Booking ${event.Id} detected`);
  processBooking(event.Id);
});

// Process booking extension
xapi.Event.Bookings.ExtensionRequested.on(async (event) => {
  console.log(`Booking ${event.OriginalMeetingId} updated, reprocessing...`);
  processBooking(event.OriginalMeetingId);
});

// Process booking end
xapi.Event.Bookings.End.on((event) => {
  xapi.Command.UserInterface.Message.Prompt.Clear({
    FeedbackId: feedbackId,
  });
  xapi.Command.UserInterface.Message.TextLine.Clear({});
  clearInterval(periodicUpdate);
  clearInterval(alertInterval);
  clearTimeout(deleteTimeout);
  bookingIsActive = false;
  listenerShouldCheck = false;
  bookingId = null;
  ignoreBooking = false;
  lastFullTimer = 0;
  lastEmptyTimer = 0;
  roomIsEmpty = false;
  console.log(`Booking ${event.Id} ended Stop Checking`);
});

// Process active call
xapi.Status.SystemUnit.State.NumberOfActiveCalls.on((result) => {
  if (bookingIsActive) {
    if (debugMode) console.debug(`Number of active calls: ${result}`);
    const inCall = Number(result) > 0;
    metrics.inCall = inCall;

    if (detectActiveCalls && inCall) {
      clearAlerts();
    }

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Process presence detection
xapi.Status.RoomAnalytics.PeoplePresence.on((result) => {
  if (bookingIsActive) {
    if (debugMode) console.debug(`Presence: ${result}`);
    const people = result === 'Yes';
    metrics.peoplePresence = people;

    if (people) {
      clearAlerts();
    }

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Process ultrasound detection
xapi.Status.RoomAnalytics.UltrasoundPresence.on((result) => {
  if (bookingIsActive) {
    if (debugMode) console.debug(`Ultrasound: ${result}`);
    const ultrasound = result === 'Yes';
    metrics.ultrasound = ultrasound;

    if (detectUltrasound && ultrasound) {
      clearAlerts();
    }

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Process People Count
xapi.Status.RoomAnalytics.PeopleCount.Current.on((result) => {
  if (bookingIsActive) {
    if (debugMode) console.debug(`People count: ${result}`);
    const people = Number(result);
    metrics.peopleCount = people === -1 ? 0 : people;

    if (people > 0) {
      clearAlerts();
    }

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Process sound level
xapi.Status.RoomAnalytics.Sound.Level.A.on((result) => {
  // Only process when enabled to reduce log noise
  if (bookingIsActive && detectSound) {
    if (debugMode) console.debug(`Sound level: ${result}`);
    const level = Number(result);
    metrics.presenceSound = level > soundLevel;

    if (level > soundLevel) {
      clearAlerts();
    }

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Process presentation preview started
xapi.Event.PresentationPreviewStarted.on((result) => {
  if (bookingIsActive) {
    if (debugMode) console.debug(`Presentation Started: ${result.LocalSource}`);
    metrics.sharing = detectPresentation;

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Process presentation preview stopped
xapi.Event.PresentationPreviewStopped.on((result) => {
  if (bookingIsActive) {
    if (debugMode) console.debug(`Presentation Stopped: ${result.LocalSource}`);
    metrics.sharing = false;

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Process UI interaction
xapi.Event.UserInterface.Extensions.on(() => {
  if (bookingIsActive && detectInteraction) {
    if (debugMode) console.debug('UI interaction detected');

    clearAlerts();
    lastFullTimer = Date.now();
    lastEmptyTimer = 0;

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Init Function
async function init() {
  await configureCodec();
  // check for current meeting
  const currentId = await xapi.Status.Bookings.Current.Id.get();
  if (currentId) {
    processBooking(currentId);
  }
}

init();
