# Room Release

![RoomOS10-Yes](https://img.shields.io/badge/RoomOS%2010-Compatible-green.svg?style=for-the-badge&logo=cisco) ![RoomOS11-Yes](https://img.shields.io/badge/RoomOS%2011-Compatible-green.svg?style=for-the-badge&logo=cisco)

Macro designed to automatically release a room booking based on occupancy metrics from the Cisco codec.

The following metrics can be used for this calculation
- People Count (Head Detection)
- People Presence (Ultrasound, if enabled)
- Room Ultrasound
- Sound Levels
- Active Call
- Presentation Sharing
- UI Interaction

If the room is unable to detect presence this macro will wait 5 minutes before declaring the room unoccupied, and will present a dialog on the Touch Panel to initiate a Check In.
This prompt, along with playing an announcement tone, will display for 60 seconds before the booking will be declined and removed from the device.

Additionally, there is built in functionality to ignore the release of larger bookings (duration adjustable), such as all day events which may not start on time.

Example Screenshots - 
![img1.png](img/touch.png)
![img2.png](img/osd.png)

## Notes
- All default threshold timers are configurable in the parameters.
- By default, once the user has pressed the `Check In` button, room occupancy checks will continue. These can stopped by enabling the `buttonStopChecks` parameter.
- Parameter `occupiedStopChecks` can be enabled to stop room occupancy checks after the `minBeforeOccupied` threshold timer is reached.

## Deployment

1. Download the Macro file and upload to your Webex device.
2. Update the Parameters to align with your environment requirements

## Debugging

The macro contains a variable used to enable debugging output into the console.

## Support

In case you've found a bug, please [open an issue on GitHub](../../../issues).

## Disclaimer

This macro is NOT guaranteed to be bug free and production quality.

## Credits

- [Unbook Empty Room](https://github.com/CiscoDevNet/roomdevices-macros-samples/tree/master/Unbook%20Empty%20Room) macro that this macro is created from
- rudferna@cisco.com, as the original author of the room release macro
