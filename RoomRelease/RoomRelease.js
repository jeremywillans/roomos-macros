/* eslint-disable class-methods-use-this */
/* eslint-disable no-console */
/*
# Room Release Macro
# Written by Jeremy Willans
# https://github.com/jeremywillans/roomos-macros
# Version: 1.3
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
# 1.3 20230824 Refactor as Class module and implement ultrasound requirement
#
*/
// eslint-disable-next-line import/no-unresolved
import xapi from 'xapi';

const rrOptions = {
  // Occupancy Detections
  detectSound: false, // Use sound level to consider room occupied (set level below)
  detectUltrasound: false, // Use Ultrasound for presence detection
  requireUltrasound: false, // Require Ultrasound detection (eg. glass walls)
  detectActiveCalls: true, // Use active call for detection (inc airplay)
  detectInteraction: true, // UI extensions (panel, button, etc) to detect presence.
  detectPresentation: true, // Use presentation sharing for detection

  // Disable Occupancy Checks
  // *NOTE* If these are both false, occupancy checks will continue for duration of meeting
  buttonStopChecks: false, // Stop further occupancy checks after check in
  occupiedStopChecks: false, // Stop periodic checks if room considered occupied
  consideredOccupied: 15, // (Mins) minimum duration until considered occupied

  // Thresholds and Timers
  emptyBeforeRelease: 5, // (Mins) time empty until prompt for release
  initialReleaseDelay: 10, // (Mins) initial delay before prompt for release
  soundLevel: 50, // (dB) Minimum sound level required to consider occupied
  ignoreLongerThan: 5, // (Hrs) meetings longer than this will be skipped
  promptDuration: 60, // (Secs) display prompt time before room declines invite
  periodicInterval: 2, // (Mins) duration to perform periodic occupancy checks

  // Other Parameters
  playAnnouncement: true, // Play announcement tone during check in prompt
  feedbackId: 'alertResponse', // identifier assigned to prompt response
  debugMode: true, // Enable debug logging
};

// ----- EDIT BELOW THIS LINE AT OWN RISK ----- //

// Enable Ultrasound if set to required (and not enabled)
if (rrOptions.requireUltrasound && !rrOptions.detectUltrasound) {
  console.warn('Ultrasound required but disabled, activating...');
  rrOptions.detectUltrasound = true;
}

// Room Release Class
class RoomRelease {
  constructor(id) {
    this.id = id;
    this.o = rrOptions;
    this.moveAlert = false;
    this.feedbackId = rrOptions.feedbackId;
    this.alertDuration = 0;
    this.alertInterval = null;
    this.deleteTimeout = null;
    this.periodicUpdate = null;
    this.bookingIsActive = false;
    this.countdownActive = false;
    this.listenerShouldCheck = true;
    this.roomIsEmpty = false;
    this.lastFullTimestamp = 0;
    this.lastEmptyTimestamp = 0;
    this.initialDelay = 0;
    this.metrics = {
      peopleCount: 0,
      peoplePresence: false,
      ultrasound: false,
      inCall: false,
      presenceSound: false,
      sharing: false,
    };
  }

  // Display check in prompt and play announcement tone
  promptUser() {
    xapi.Command.UserInterface.Message.Prompt.Display({
      Title: 'Unoccupied Room',
      Text: 'Please Check-In below to retain this Room Booking.',
      FeedbackId: this.feedbackId,
      'Option.1': 'Check-In',
    }).catch((error) => { console.error(`${this.id}: ${error.message}`); });

    if (!this.o.playAnnouncement) return;
    xapi.Command.Audio.Sound.Play({
      Loop: 'Off', Sound: 'Announcement',
    }).catch((error) => { console.error(`${this.id}: ${error.message}`); });
  }

  // OSD countdown message for check in
  updateEverySecond() {
    this.alertDuration -= 1;
    if (this.alertDuration <= 0) {
      clearInterval(this.alertInterval);
      xapi.Command.UserInterface.Message.TextLine.Clear();
      return;
    }

    const msgBody = {
      text: `Unoccupied Room Alert! It will be released in ${this.alertDuration} seconds.<br>Please use Touch Panel to retain booking.`,
      duration: 0,
    };
    if (this.moveAlert) {
      msgBody.y = 2000;
      msgBody.x = 5000;
    }
    xapi.Command.UserInterface.Message.TextLine.Display(msgBody)
      .catch((error) => { console.error(`${this.id}: ${error.message}`); });

    // Forced message display every 5 seconds
    if (this.alertDuration % 5 === 0) {
      this.promptUser();
    }
  }

  // Clear existing alerts
  clearAlerts() {
    xapi.Command.UserInterface.Message.Prompt.Clear({ FeedbackId: this.feedbackId });
    xapi.Command.UserInterface.Message.TextLine.Clear();
    clearTimeout(this.deleteTimeout);
    clearInterval(this.alertInterval);
    this.roomIsEmpty = false;
    this.countdownActive = false;
  }

  // Configure Cisco codec for occupancy metrics
  async configureCodec() {
    try {
      // Get codec platform
      const platform = await xapi.Status.SystemUnit.ProductPlatform.get();
      // if matches desk or board series, flag that the on screen alert needs to be moved up
      if (platform.toLowerCase().includes('desk') || platform.toLowerCase().includes('board')) {
        this.moveAlert = true;
      }
      console.info(`${this.id}: Processing Codec configurations...`);
      await xapi.Config.HttpClient.Mode.set('On');
      await xapi.Config.RoomAnalytics.PeopleCountOutOfCall.set('On');
      await xapi.Config.RoomAnalytics.PeoplePresenceDetector.set('On');
    } catch (error) {
      console.warn(error.message);
    }
  }

  // Determine if room is occupied based on enabled detections
  isRoomOccupied() {
    if (this.o.debugMode) {
      let message = `${this.id}: Presence: ${this.metrics.peoplePresence} | Count: ${this.metrics.peopleCount}`;
      // eslint-disable-next-line no-nested-ternary
      message += ` | [${this.o.requireUltrasound ? 'R' : this.o.requireUltrasound ? 'X' : ' '}] Ultrasound: ${this.metrics.ultrasound}`;
      message += ` | [${this.o.detectActiveCalls ? 'X' : ' '}] In Call: ${this.metrics.inCall}`;
      message += ` | [${this.o.detectSound ? 'X' : ' '}] Sound (> ${this.o.soundLevel}): ${this.metrics.presenceSound}`;
      message += ` | [${this.o.detectPresentation ? 'X' : ' '}] Share: ${this.metrics.sharing}`;
      console.debug(message);
    }
    let currentStatus = this.metrics.peoplePresence // People presence
      || (this.o.detectActiveCalls && this.metrics.inCall) // Active call detection
      || (this.o.detectSound && this.metrics.presenceSound) // Sound detection
      || (this.o.detectPresentation && this.metrics.sharing) // Presentation detection
      || (this.o.detectUltrasound && this.metrics.ultrasound); // Ultrasound detection

    // If ultrasound is required, test against people presence status
    if (this.o.requireUltrasound && this.metrics.peoplePresence) {
      currentStatus = this.metrics.peoplePresence && this.metrics.ultrasound;
    }

    if (this.o.debugMode) console.debug(`${this.id}: OCCUPIED: ${currentStatus}`);
    return currentStatus;
  }

  // Countdown timer before meeting decline
  startCountdown() {
    if (this.o.debugMode) console.debug(`${this.id}: Start countdown initiated`);
    this.countdownActive = true;
    this.promptUser();

    this.alertDuration = this.o.promptDuration;
    this.alertInterval = setInterval(this.updateEverySecond.bind(this), 1000);

    // Process meeting removal
    this.deleteTimeout = setTimeout(async () => {
      // absolute final metrics collection
      await this.getMetrics(false);
      // absolute final occupancy check
      if (this.isRoomOccupied()) {
        console.info('absolute final occupancy detected, aborting decline!');
        this.clearAlerts();
        this.processOccupancy();
        return;
      }
      if (this.o.debugMode) console.debug(`${this.id}: Initiate Booking removal from device.`);
      xapi.Command.UserInterface.Message.Prompt.Clear({ FeedbackId: this.feedbackId });
      xapi.Command.Audio.Sound.Stop();
      xapi.Command.UserInterface.Message.TextLine.Clear();
      clearInterval(this.periodicUpdate);

      // We get the updated meetingId to send meeting decline
      let booking;
      let bookingId;
      try {
        // get webex booking id for current booking on codec
        bookingId = await xapi.Status.Bookings.Current.Id.get();
        // use booking id to retrieve booking data, specifically meeting id
        booking = await xapi.Command.Bookings.Get({ Id: bookingId });
        if (this.o.debugMode) console.debug(`${this.id}: ${bookingId} contains ${booking.Booking.MeetingId}`);
      } catch (error) {
        console.error(`${this.id}: Unable to retrieve meeting info for ${bookingId}`);
        console.debug(`${this.id}: ${error.message}`);
        return;
      }
      try {
        // attempt decline meeting to control hub
        await xapi.Command.Bookings.Respond({
          Type: 'Decline',
          MeetingId: booking.Booking.MeetingId,
        });
        if (this.o.debugMode) console.debug(`${this.id}: Booking declined.`);
      } catch (error) {
        console.error(`${this.id}: Unable to respond to meeting ${booking.Booking.MeetingId}`);
        console.debug(`${this.id}: ${error.message}`);
      }
      this.bookingIsActive = false;
      this.lastFullTimestamp = 0;
      this.lastEmptyTimestamp = 0;
      this.roomIsEmpty = false;
    }, this.o.promptDuration * 1000);
  }

  // Promise return function
  getData(command) {
    return xapi.status.get(command).catch((error) => {
      console.warning(`${this.id}: Unable to perform command: ${command}`);
      if (this.o.debugMode) console.debug(`${this.id}: ${error.message}`);
      return -1;
    });
  }

  // Poll codec to retrieve updated metrics
  async getMetrics(processResults = true) {
    try {
      const results = await Promise.all([
        this.getData('SystemUnit.State.NumberOfActiveCalls'),
        this.getData('RoomAnalytics.UltrasoundPresence'),
        this.getData('RoomAnalytics.PeoplePresence'),
        this.getData('RoomAnalytics.PeopleCount.Current'),
        this.getData('RoomAnalytics.Sound.Level.A'),
      ]);
      // process results
      const numCalls = Number(results[0]);
      const ultrasound = results[1] === 'Yes';
      const presence = results[2] === 'Yes';
      const peopleCount = Number(results[3]);
      const soundResult = Number(results[4]);

      // test for local sharing xapi
      const sharing = await this.getData('Conference.Presentation.LocalInstance');
      this.metrics.sharing = sharing.length > 0;

      // Process people metrics
      this.metrics.peopleCount = peopleCount === -1 ? 0 : peopleCount;
      this.metrics.peoplePresence = presence;
      this.metrics.ultrasound = ultrasound;

      // Process active calls
      if (numCalls > 0 && this.o.detectActiveCalls) {
        this.metrics.inCall = true;
        // if in call we assume that people are present
        this.metrics.peoplePresence = true;
      } else {
        this.metrics.inCall = false;
      }

      // Process sound level
      if ((soundResult > this.o.soundLevel) && this.o.detectSound) {
        this.metrics.presenceSound = true;
      } else {
        this.metrics.presenceSound = false;
      }

      if (processResults) this.processOccupancy();
    } catch (error) {
      console.warn(`${this.id}: Unable to process occupancy metrics from Codec`);
      if (this.o.debugMode) console.debug(`${this.id}: ${error.message}`);
    }
  }

  // Process occupancy metrics gathered from the Cisco codec.
  async processOccupancy() {
    // check is room occupied
    if (this.isRoomOccupied()) {
      // is room newly occupied
      if (this.lastFullTimestamp === 0) {
        if (this.o.debugMode) console.debug(`${this.id}: Room occupancy detected - updating full timestamp...`);
        this.lastFullTimestamp = Date.now();
        this.lastEmptyTimestamp = 0;
      // has room been occupied longer than consideredOccupied
      } else if (Date.now() > (this.lastFullTimestamp + (this.o.consideredOccupied * 60000))) {
        if (this.o.debugMode) console.debug(`${this.id}: consideredOccupied reached - room considered occupied`);
        this.roomIsEmpty = false;
        this.lastFullTimestamp = Date.now();
        if (this.o.occupiedStopChecks) {
          // stop further checks as room is considered occupied
          if (this.o.debugMode) console.debug(`${this.id}: future checks stopped for this booking`);
          this.bookingIsActive = false;
          this.listenerShouldCheck = false;
          clearInterval(this.periodicUpdate);
        }
      }
    // is room newly empty
    } else if (this.lastEmptyTimestamp === 0) {
      if (this.o.debugMode) console.debug(`${this.id}: Room empty detected - updating empty timestamp...`);
      this.lastEmptyTimestamp = Date.now();
      this.lastFullTimestamp = 0;
    // has room been empty longer than emptyBeforeRelease
    } else if (Date.now() > (this.lastEmptyTimestamp + (this.o.emptyBeforeRelease * 60000))
      && !this.roomIsEmpty) {
      if (this.o.debugMode) console.debug(`${this.id}: emptyBeforeRelease reached - room considered empty`);
      this.roomIsEmpty = true;
    }

    // if room is considered empty commence countdown (unless already active)
    if (this.roomIsEmpty && !this.countdownActive) {
      // check we have not yet reached the initial delay
      if (Date.now() < this.initialDelay) {
        if (this.o.debugMode) console.debug(`${this.id}: Booking removal bypassed as meeting has not yet reached initial delay`);
        return;
      }
      // pre-countdown metrics collection
      await this.getMetrics(false);
      // pre-countdown occupancy check
      if (this.isRoomOccupied()) return;
      console.warn(`${this.id}: Room is empty start countdown for delete booking`);
      this.startCountdown();
    }
  }

  // Process meeting logic
  async processBooking(id) {
    // Validate booking
    const availability = await xapi.Status.Bookings.Availability.Status.get();
    if (availability === 'BookedUntil') {
      const booking = await xapi.Command.Bookings.Get({ Id: id });
      this.bookingIsActive = true;
      this.listenerShouldCheck = true;

      // Calculate meeting length
      let duration = 0;
      let startTime;
      try {
        const t = booking.Booking.Time;
        startTime = Date.parse(t.StartTime);
        duration = ((Number(t.SecondsUntilEnd) + Number(t.SecondsSinceStart)) / 3600).toFixed(2);
      } catch (error) {
        console.warn(`${this.id}: Unable to parse Meeting Length`);
        if (this.o.debugMode) console.debug(`${this.id}: ${error.message}`);
      }
      // do not process meetings if it equals/exceeds defined meeting length
      if (this.o.debugMode) console.debug(`${this.id}: calculated meeting length: ${duration}`);
      if (duration >= this.o.ignoreLongerThan) {
        if (this.o.debugMode) console.debug(`${this.id}: meeting ignored as equal/longer than ${this.o.ignoreLongerThan} hours`);
        this.listenerShouldCheck = false;
        this.bookingIsActive = false;
        return;
      }

      // define initial delay before attempting release
      this.initialDelay = startTime + this.o.initialReleaseDelay * 60000;

      // get initial occupancy data from the codec
      await this.getMetrics();

      // Update checks to periodically validate room status.
      this.periodicUpdate = setInterval(() => {
        if (this.o.debugMode) console.debug(`${this.id}: initiating periodic processing of occupancy metrics`);
        this.getMetrics();
      }, (this.o.periodicInterval * 60000) + 1000);
    } else {
      this.initialDelay = 0;
      this.lastFullTimestamp = 0;
      this.lastEmptyTimestamp = 0;
      this.roomIsEmpty = false;
      console.warn(`${this.id}: Booking was detected without end time!`);
    }
  }

  // ----- xAPI Handle Functions ----- //

  handlePromptResponse(event) {
    if (event.FeedbackId === this.feedbackId && event.OptionId === '1') {
      if (this.o.debugMode) console.debug(`${this.id}: Local Check-in performed from Touch Panel`);
      this.clearAlerts();
      this.lastFullTimestamp = Date.now();
      this.lastEmptyTimestamp = 0;
      if (this.o.buttonStopChecks) {
        if (this.o.debugMode) console.debug(`${this.id}: future checks stopped for this booking`);
        this.bookingIsActive = false;
        this.listenerShouldCheck = false;
        clearInterval(this.periodicUpdate);
      }
    }
  }

  handleBookingExtension(id) {
    // Only re-process if meeting and listeners are active
    if (this.bookingIsActive && this.listenerShouldCheck) {
      this.processBooking(id);
    }
  }

  handleBookingEnd() {
    clearInterval(this.periodicUpdate);
    this.clearAlerts();
    this.bookingIsActive = false;
    this.listenerShouldCheck = false;
    this.initialDelay = 0;
    this.lastFullTimestamp = 0;
    this.lastEmptyTimestamp = 0;
  }

  handleActiveCall(result) {
    if (this.bookingIsActive) {
      if (this.o.debugMode) console.debug(`${this.id}: Number of active calls: ${result}`);
      const inCall = Number(result) > 0;
      this.metrics.inCall = inCall;

      if (this.o.detectActiveCalls && inCall) {
        this.clearAlerts();
      }
      if (this.listenerShouldCheck) {
        this.processOccupancy();
      }
    }
  }

  handlePeoplePresence(result) {
    if (this.bookingIsActive) {
      if (this.o.debugMode) console.debug(`${this.id}: Presence: ${result}`);
      const people = result === 'Yes';
      this.metrics.peoplePresence = people;

      if (people) {
        this.clearAlerts();
      }
      if (this.listenerShouldCheck) {
        this.processOccupancy();
      }
    }
  }

  handleUltrasoundPresence(result) {
    if (this.bookingIsActive) {
      if (this.o.debugMode) console.debug(`${this.id}: Ultrasound: ${result}`);
      const ultrasound = result === 'Yes';
      this.metrics.ultrasound = ultrasound;

      if (this.o.detectUltrasound && ultrasound) {
        this.clearAlerts();
      }
      if (this.listenerShouldCheck) {
        this.processOccupancy();
      }
    }
  }

  handlePeopleCount(result) {
    if (this.bookingIsActive) {
      if (this.o.debugMode) console.debug(`${this.id}: People count: ${result}`);
      const people = Number(result);
      this.metrics.peopleCount = people === -1 ? 0 : people;

      if (people > 0) {
        this.clearAlerts();
      }
      if (this.listenerShouldCheck) {
        this.processOccupancy();
      }
    }
  }

  handleSoundDetection(result) {
    // Only process when enabled to reduce log noise
    if (this.bookingIsActive && this.o.detectSound) {
      if (this.o.debugMode) console.debug(`${this.id}: Sound level: ${result}`);
      const level = Number(result);
      this.metrics.presenceSound = level > this.o.soundLevel;

      if (level > this.o.soundLevel) {
        this.clearAlerts();
      }
      if (this.listenerShouldCheck) {
        this.processOccupancy();
      }
    }
  }

  handlePresentationLocalInstance(result) {
    if (this.bookingIsActive) {
      if (result.ghost && result.ghost === 'True') {
        if (this.o.debugMode) console.debug(`${this.id}: Presentation Stopped: ${result.id}`);
        this.metrics.sharing = false;
      } else {
        if (this.o.debugMode) console.debug(`${this.id}: Presentation Started: ${result.id}`);
        this.metrics.sharing = true;
      }

      if (this.o.detectPresentation) {
        this.clearAlerts();
      }
      if (this.listenerShouldCheck) {
        this.processOccupancy();
      }
    }
  }

  handleInteraction() {
    if (this.bookingIsActive && this.o.detectInteraction) {
      if (this.o.debugMode) console.debug(`${this.id}: UI interaction detected`);

      this.clearAlerts();
      this.lastFullTimestamp = Date.now();
      this.lastEmptyTimestamp = 0;

      if (this.listenerShouldCheck) {
        this.processOccupancy();
      }
    }
  }
}

// Init function
async function init() {
  // Declare Class
  const rr = new RoomRelease('RR');
  // clear any lingering alerts
  rr.clearAlerts();
  // ensure codec is configured correctly
  await rr.configureCodec();
  // check for current meeting
  const currentId = await xapi.Status.Bookings.Current.Id.get();
  if (currentId) {
    rr.processBooking(currentId);
  }

  console.info('--- Processing Room Resource Subscriptions');
  // Process booking start
  xapi.Event.Bookings.Start.on((event) => {
    console.log(`${rr.id}: Booking ${event.Id} detected`);
    rr.processBooking(event.Id);
  });
  // Process booking extension
  xapi.Event.Bookings.ExtensionRequested.on((event) => {
    console.log(`${rr.id}: Booking ${event.OriginalMeetingId} updated.`);
    rr.handleBookingExtension(event.OriginalMeetingId);
  });
  // Process booking end
  xapi.Event.Bookings.End.on((event) => {
    console.log(`${rr.id}: Booking ${event.Id} ended Stop Checking`);
    rr.handleBookingEnd();
  });
  // Process UI interaction
  xapi.Event.UserInterface.Extensions.on(() => {
    rr.handleInteraction();
  });
  // Handle message prompt response
  xapi.Event.UserInterface.Message.Prompt.Response.on((event) => {
    rr.handlePromptResponse(event);
  });
  // Process active call
  xapi.Status.SystemUnit.State.NumberOfActiveCalls.on((result) => {
    rr.handleActiveCall(result);
  });
  // Process presence detection
  xapi.Status.RoomAnalytics.PeoplePresence.on((result) => {
    rr.handlePeoplePresence(result);
  });
  // Process ultrasound detection
  xapi.Status.RoomAnalytics.UltrasoundPresence.on((result) => {
    rr.handleUltrasoundPresence(result);
  });
  // Process presentation detection
  xapi.Status.Conference.Presentation.LocalInstance['*'].on((result) => {
    rr.handlePresentationLocalInstance(result);
  });
  // Process people count
  xapi.Status.RoomAnalytics.PeopleCount.Current.on((result) => {
    rr.handlePeopleCount(result);
  });
  // Process sound level
  xapi.Status.RoomAnalytics.Sound.Level.A.on((result) => {
    rr.handleSoundDetection(result);
  });
}

init();
