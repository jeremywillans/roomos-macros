/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
/*
# Room Release Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.2
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
# 1.2 20230815 Refactor code and add more commentary
#
*/
// eslint-disable-next-line import/no-unresolved
import xapi from 'xapi';

// Occupancy Detections
const detectSound = false; // Use sound level to consider room occupied (set level below)
const detectUltrasound = false; // Use Ultrasound for presence detection (eg. glass walls)

// Disable Occupancy Checks
// *NOTE* If these are both false, occupancy checks will continue for duration of meeting
const buttonStopChecks = false; // Stop further occupancy checks after touch panel check in
const occupiedStopChecks = false; // Stop further periodic checks after room considered occupied
const consideredOccupied = 15; // (Minutes) minimum duration (in a row) until considered occupied

// Thresholds and Timers
const emptyBeforeRelease = 5; // (Minutes) minimum duration empty until room prompt for release
const initialReleaseDelay = 10; // (Minutes) minimum initial duration before prompt for release
const soundLevel = 50; // (dB) Minimum sound level required to consider occupied
const ignoreLongerThan = 3; // (Hours) meetings longer than this duration will be skipped
const promptDuration = 60; // (Seconds) time to display Check in prompt before room declines invite
const periodicInterval = 2; // (Minutes) duration to perform forced periodic occupancy checks

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
let roomIsEmpty = false;
let lastFullTimestamp = 0;
let lastEmptyTimestamp = 0;
let initialDelay = 0;

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
    console.debug(`Presence: ${metrics.peoplePresence} | Count: ${metrics.peopleCount} | [${detectUltrasound ? 'X' : ' '}] Ultrasound: ${metrics.ultrasound}\
 | [${detectActiveCalls ? 'X' : ' '}] In Call: ${metrics.inCall} | [${detectSound ? 'X' : ' '}] Sound (> ${soundLevel}): ${metrics.presenceSound}\
 | [${detectPresentation ? 'X' : ' '}] Share: ${metrics.sharing}`);
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
  if (debugMode) console.debug('Start countdown initiated');
  promptUser();

  alertDuration = promptDuration;
  alertInterval = setInterval(updateEverySecond, 1000);

  // Process meeting removal
  deleteTimeout = setTimeout(async () => {
    if (debugMode) console.debug('Initiate Booking removal from device.');
    xapi.Command.UserInterface.Message.Prompt.Clear({ FeedbackId: feedbackId });
    xapi.Command.Audio.Sound.Stop();
    xapi.Command.UserInterface.Message.TextLine.Clear({});
    clearInterval(periodicUpdate);

    // We get the updated meetingId to send meeting decline
    let booking;
    let bookingId;
    try {
      bookingId = await xapi.Status.Bookings.Current.Id.get();
      booking = await xapi.Command.Bookings.Get({ Id: bookingId });
      if (debugMode) console.debug(`${bookingId} contains ${booking.Booking.MeetingId}`);
    } catch (error) {
      console.error(`Unable to retrieve meeting info for ${bookingId}`);
      console.debug(error);
    }
    try {
      await xapi.Command.Bookings.Respond({
        Type: 'Decline',
        MeetingId: booking.Booking.MeetingId,
      });
      if (debugMode) console.debug('Booking declined.');
    } catch (error) {
      console.error(`Unable to respond to meeting ${booking.Booking.MeetingId}`);
      console.debug(error);
    }
    bookingIsActive = false;
    lastFullTimestamp = 0;
    lastEmptyTimestamp = 0;
    roomIsEmpty = false;
  }, promptDuration * 1000);
}

// Process occupancy metrics gathered from the Cisco codec.
function processOccupancy() {
  // check is room occupied
  if (isRoomOccupied()) {
    // is room newly occupied
    if (lastFullTimestamp === 0) {
      if (debugMode) console.debug('Room occupancy detected - updating full timestamp...');
      lastFullTimestamp = Date.now();
      lastEmptyTimestamp = 0;
    // has room been occupied longer than consideredOccupied
    } else if (Date.now() > (lastFullTimestamp + (consideredOccupied * 60000))) {
      if (debugMode) console.debug('consideredOccupied reached - room considered occupied');
      roomIsEmpty = false;
      lastFullTimestamp = Date.now();
      if (occupiedStopChecks) {
        // stop further checks as room is considered occupied
        if (debugMode) console.debug('future checks stopped for this booking');
        bookingIsActive = false;
        listenerShouldCheck = false;
        clearInterval(periodicUpdate);
      }
    }
  // is room newly empty
  } else if (lastEmptyTimestamp === 0) {
    if (debugMode) console.debug('Room empty detected - updating empty timestamp...');
    lastEmptyTimestamp = Date.now();
    lastFullTimestamp = 0;
  // has room been empty longer than emptyBeforeRelease
  } else if (Date.now() > (lastEmptyTimestamp + (emptyBeforeRelease * 60000)) && !roomIsEmpty) {
    if (debugMode) console.debug('emptyBeforeRelease reached - room considered empty');
    roomIsEmpty = true;
  }

  if (roomIsEmpty && !alertInterval) {
    if (Date.now() < initialDelay) {
      if (debugMode) console.debug('Booking removal bypassed as meeting has not yet reached initial delay');
      return;
    }
    console.warn('Room is empty start countdown for delete booking');
    startCountdown();
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
    ]);
    try {
      // test for local sharing xapi
      await getData('Conference Presentation LocalInstance Source');
      metrics.sharing = true;
    } catch (error) {
      // no current local sharing
      metrics.sharing = false;
    }
    const numCalls = Number(results[0]);
    const ultrasound = results[1] === 'Yes';
    const presence = results[2] === 'Yes';
    const peopleCount = Number(results[3]);
    const soundResult = Number(results[4]);

    // Process people metrics
    metrics.peopleCount = peopleCount === -1 ? 0 : peopleCount;
    metrics.peoplePresence = presence;
    metrics.ultrasound = ultrasound;

    // Process active calls
    if (numCalls > 0 && detectActiveCalls) {
      metrics.inCall = true;
      // if in call we assume that people are present
      metrics.peoplePresence = true;
    } else {
      metrics.inCall = false;
    }

    // Process sound level
    if ((soundResult > soundLevel) && detectSound) {
      metrics.presenceSound = true;
    } else {
      metrics.presenceSound = false;
    }

    processOccupancy();
  } catch (error) {
    console.log(error);
    console.warn('Unable to process occupancy metrics from Codec');
  }
}

// Process meeting logic
async function processBooking(id) {
  // Validate booking
  const availability = await xapi.Status.Bookings.Availability.Status.get();
  if (availability === 'BookedUntil') {
    const booking = await xapi.Command.Bookings.Get({ Id: id });
    bookingIsActive = true;
    listenerShouldCheck = true;

    // Calculate meeting length
    let duration = 0;
    let startTime;
    try {
      const t = booking.Booking.Time;
      startTime = Date.parse(t.StartTime);
      duration = ((Number(t.SecondsUntilEnd) + Number(t.SecondsSinceStart)) / 3600).toFixed(2);
    } catch (error) {
      console.warn('Unable to parse Meeting Length');
    }
    // do not process meetings if it equals/exceeds defined meeting length
    if (debugMode) console.debug(`calculated meeting length: ${duration}`);
    if (duration >= ignoreLongerThan) {
      if (debugMode) console.debug(`meeting ignored as equal/longer than ${ignoreLongerThan} hours`);
      listenerShouldCheck = false;
      bookingIsActive = false;
      return;
    }

    // define initial delay before attempting release
    initialDelay = startTime + initialReleaseDelay * 60000;

    // get initial occupancy data from the codec
    await updateOccupancy();

    // Update checks to periodically validate room status.
    periodicUpdate = setInterval(() => {
      if (debugMode) console.debug('initiating occupied periodic processing of occupancy metrics');
      updateOccupancy();
    }, (periodicInterval * 60000) + 1000);
  } else {
    initialDelay = 0;
    lastFullTimestamp = 0;
    lastEmptyTimestamp = 0;
    roomIsEmpty = false;
    console.warn('Booking was detected without end time!');
  }
}

// Handle message prompt response
xapi.Event.UserInterface.Message.Prompt.Response.on((event) => {
  if (event.FeedbackId === feedbackId && event.OptionId === '1') {
    if (debugMode) console.debug('Local Check-in performed from Touch Panel');
    clearAlerts();
    lastFullTimestamp = Date.now();
    lastEmptyTimestamp = 0;
    if (buttonStopChecks) {
      if (debugMode) console.debug('future checks stopped for this booking');
      bookingIsActive = false;
      listenerShouldCheck = false;
      clearInterval(periodicUpdate);
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
  clearInterval(periodicUpdate);
  clearAlerts();
  bookingIsActive = false;
  listenerShouldCheck = false;
  initialDelay = 0;
  lastFullTimestamp = 0;
  lastEmptyTimestamp = 0;
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

// Process people count
xapi.Status.RoomAnalytics.PeopleCount.Current.on(async (result) => {
  if (bookingIsActive) {
    if (debugMode) console.debug(`People count: ${result}`);
    const people = Number(result);
    metrics.peopleCount = people === -1 ? 0 : people;

    // People count is only used in debug logs - processing disabled
    // if (people > 0) {
    //   clearAlerts();
    // }
    // if (listenerShouldCheck) {
    //   processOccupancy();
    // }
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
    lastFullTimestamp = Date.now();
    lastEmptyTimestamp = 0;

    if (listenerShouldCheck) {
      processOccupancy();
    }
  }
});

// Init function
async function init() {
  // clear any lingering alerts
  clearAlerts();
  // ensure codec is configured correctly
  await configureCodec();
  // check for current meeting
  const currentId = await xapi.Status.Bookings.Current.Id.get();
  if (currentId) {
    processBooking(currentId);
  }
}

// Commence init once runtime ready
xapi.on('ready', () => setTimeout(init, 1000));
